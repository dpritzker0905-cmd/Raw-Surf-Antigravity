"""Headers that authenticate a Supabase project API key (stdlib only).

Supabase's new secret keys (``sb_secret_...``) are NOT JWTs: the platform accepts them only on the
``apikey`` header, and a copy on ``Authorization: Bearer`` is parsed as a JWT and rejected (the
2026-11-19 ingest outage, when the legacy JWT keys were disabled). Legacy JWT keys (``eyJ...``)
keep their Bearer copy so behaviour is unchanged for them.

Scripts run by path with ``-I -S`` cannot import this package; they inline the same rule as a local
``_supabase_headers`` (guard: ``tests/test_supabase_key_headers.py``).
"""


def is_legacy_jwt_key(key) -> bool:
    """True when ``key`` is a legacy JWT API key (anon / service_role)."""
    return isinstance(key, str) and key.startswith("eyJ")


def supabase_headers(key, extra=None) -> dict:
    """``{"apikey": key}``, plus ``Authorization: Bearer key`` only for a legacy JWT key."""
    headers = {"apikey": key}
    if is_legacy_jwt_key(key):
        headers["Authorization"] = "Bearer " + key
    if extra:
        headers.update(extra)
    return headers
