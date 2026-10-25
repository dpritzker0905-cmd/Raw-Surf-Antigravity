"""RFC 6238 one-time passwords and the MFA secret helpers: pure functions, no database, no network.

The RFC's own test vectors pin the algorithm (SHA-1 secret "12345678901234567890"); the rest pin the properties
the login flow depends on: the +/-1 step window, step replay refusal, malformed input, key rotation, and that a
recovery code or secret is never stored in a recoverable plain form.
"""
import base64
import hashlib

import pytest
from cryptography.fernet import Fernet

from core import mfa_policy, mfa_secrets, totp

RFC_SECRET = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
# (unix time, 8-digit TOTP) from RFC 6238 appendix B, SHA-1 column.
RFC_VECTORS = [
    (59, "94287082"),
    (1111111109, "07081804"),
    (1111111111, "14050471"),
    (1234567890, "89005924"),
    (2000000000, "69279037"),
    (20000000000, "65353130"),
]


@pytest.mark.parametrize("when,expected", RFC_VECTORS)
def test_rfc6238_sha1_vectors(when, expected):
    assert totp.hotp(RFC_SECRET, totp.step_for(when), digits=8) == expected


def test_six_digit_value_is_the_tail_of_the_eight_digit_value():
    assert totp.totp_at(RFC_SECRET, 59) == "287082"


def test_verify_accepts_current_and_adjacent_steps_only():
    now = 1_700_000_010.0
    current = totp.step_for(now)
    for offset, accepted in ((-2, False), (-1, True), (0, True), (1, True), (2, False)):
        code = totp.hotp(RFC_SECRET, current + offset)
        assert totp.verify(RFC_SECRET, code, now=now) == ((current + offset) if accepted else None)


def test_verify_never_returns_a_step_already_used():
    now = 1_700_000_010.0
    current = totp.step_for(now)
    code = totp.hotp(RFC_SECRET, current)
    assert totp.verify(RFC_SECRET, code, now=now, last_used_step=current - 1) == current
    assert totp.verify(RFC_SECRET, code, now=now, last_used_step=current) is None
    assert totp.verify(RFC_SECRET, code, now=now, last_used_step=current + 1) is None


@pytest.mark.parametrize("bad", ["", "12345", "1234567", "abcdef", "12 34 5x", "١٢٣٤٥٦", None])
def test_verify_rejects_malformed_codes(bad):
    assert totp.verify(RFC_SECRET, bad, now=59) is None


def test_verify_tolerates_spaces_in_a_pasted_code():
    now = 1_700_000_010.0
    code = totp.totp_at(RFC_SECRET, now)
    assert totp.verify(RFC_SECRET, f"{code[:3]} {code[3:]}", now=now) == totp.step_for(now)


def test_generated_secret_is_160_bits_of_base32():
    secret = totp.generate_secret()
    assert len(base64.b32decode(secret + "=" * (-len(secret) % 8))) == 20
    assert totp.generate_secret() != secret


def test_provisioning_uri_escapes_the_label_and_names_the_parameters():
    uri = totp.provisioning_uri("ABC234", "a+b@example.invalid", issuer="Raw Surf")
    assert uri.startswith("otpauth://totp/Raw%20Surf:a%2Bb%40example.invalid?")
    assert "secret=ABC234" in uri and "issuer=Raw%20Surf" in uri
    assert "digits=6" in uri and "period=30" in uri and "algorithm=SHA1" in uri


# ── secrets and recovery codes ────────────────────────────────────────────────

@pytest.fixture
def key(monkeypatch):
    value = Fernet.generate_key().decode()
    monkeypatch.setenv(mfa_secrets.ENV_NAME, value)
    return value


def test_unset_key_means_not_configured_and_refuses_to_encrypt(monkeypatch):
    monkeypatch.delenv(mfa_secrets.ENV_NAME, raising=False)
    assert mfa_secrets.mfa_configured() is False
    with pytest.raises(mfa_secrets.MfaKeyError):
        mfa_secrets.encrypt_secret("JBSWY3DPEHPK3PXP")


def test_malformed_key_is_not_configured(monkeypatch):
    monkeypatch.setenv(mfa_secrets.ENV_NAME, "not-a-fernet-key")
    assert mfa_secrets.mfa_configured() is False


def test_secret_round_trips_and_is_not_stored_in_the_clear(key):
    token = mfa_secrets.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DPEHPK3PXP" not in token
    assert mfa_secrets.decrypt_secret(token) == "JBSWY3DPEHPK3PXP"


def test_a_different_key_cannot_open_the_secret(key, monkeypatch):
    token = mfa_secrets.encrypt_secret("JBSWY3DPEHPK3PXP")
    monkeypatch.setenv(mfa_secrets.ENV_NAME, Fernet.generate_key().decode())
    with pytest.raises(mfa_secrets.MfaKeyError):
        mfa_secrets.decrypt_secret(token)


def test_key_rotation_keeps_old_secrets_and_old_recovery_codes_valid(key, monkeypatch):
    token = mfa_secrets.encrypt_secret("JBSWY3DPEHPK3PXP")
    code = mfa_secrets.generate_recovery_codes(1)[0]
    stored = mfa_secrets.hash_recovery_code(code)
    new_key = Fernet.generate_key().decode()
    monkeypatch.setenv(mfa_secrets.ENV_NAME, f"{new_key},{key}")  # first key encrypts, all decrypt
    assert mfa_secrets.decrypt_secret(token) == "JBSWY3DPEHPK3PXP"
    assert mfa_secrets.recovery_code_matches(code, stored)
    assert mfa_secrets.hash_recovery_code(code) != stored  # new codes hash under the new first key


def test_recovery_codes_are_ten_distinct_50_bit_codes_in_a_typeable_alphabet(key):
    codes = mfa_secrets.generate_recovery_codes()
    assert len(codes) == 10 and len(set(codes)) == 10
    for code in codes:
        left, right = code.split("-")
        assert len(left) == len(right) == 5
        assert set(left + right) <= set("23456789ABCDEFGHJKLMNPQRSTUVWXYZ")


def test_recovery_code_hash_is_keyed_and_forgiving_about_case_and_spacing(key, monkeypatch):
    code = "ABCDE-FGH23"
    stored = mfa_secrets.hash_recovery_code(code)
    assert stored != hashlib.sha256(b"ABCDEFGH23").hexdigest()  # not an unkeyed hash an attacker could precompute
    assert mfa_secrets.recovery_code_matches("abcde fgh23", stored)
    assert not mfa_secrets.recovery_code_matches("ABCDE-FGH24", stored)
    monkeypatch.setenv(mfa_secrets.ENV_NAME, Fernet.generate_key().decode())
    assert not mfa_secrets.recovery_code_matches(code, stored)  # a different key does not verify it


def test_opaque_tokens_are_long_and_stored_only_as_a_digest():
    token = mfa_secrets.new_opaque_token()
    assert len(token) >= 43 and mfa_secrets.new_opaque_token() != token
    assert mfa_secrets.token_digest(token) == hashlib.sha256(token.encode()).hexdigest()
    assert token not in mfa_secrets.token_digest(token)


# ── enforcement policy ────────────────────────────────────────────────────────

class _Profile:
    def __init__(self, role, is_admin=False):
        self.role = type("R", (), {"value": role})()
        self.is_admin = is_admin


@pytest.mark.parametrize("flag", [None, "", " , ,"])
def test_policy_is_off_when_unset_or_empty(monkeypatch, flag):
    monkeypatch.delenv(mfa_policy.ENV_NAME, raising=False)
    if flag is not None:
        monkeypatch.setenv(mfa_policy.ENV_NAME, flag)
    for profile in (_Profile("Photographer"), _Profile("Surfer", is_admin=True), _Profile("Admin")):
        assert mfa_policy.profile_requires_mfa(profile) is False


def test_policy_names_roles_case_and_separator_insensitively(monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "Photographer, approved_pro ,ADMIN")
    assert mfa_policy.profile_requires_mfa(_Profile("Photographer"))
    assert mfa_policy.profile_requires_mfa(_Profile("Approved Pro"))
    assert mfa_policy.profile_requires_mfa(_Profile("Surfer", is_admin=True))
    assert mfa_policy.profile_requires_mfa(_Profile("Admin"))
    assert not mfa_policy.profile_requires_mfa(_Profile("Surfer"))
    assert not mfa_policy.profile_requires_mfa(_Profile("Hobbyist"))


def test_policy_all_covers_everyone(monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "all")
    assert mfa_policy.profile_requires_mfa(_Profile("Grom"))
