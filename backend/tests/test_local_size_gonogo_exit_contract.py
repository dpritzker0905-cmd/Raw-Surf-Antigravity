"""C4-SC-04 -- infrastructure can never masquerade as a calibration verdict.

⛔ THE DEFECT. `local_size_gonogo.py` raised `SystemExit("<string>")` at five infrastructure sites.
Python exits **1** when SystemExit carries a string, which is the SAME code `main()` returns for a
genuine NO-GO. A run that could not authenticate, or that hit a Render 502, reported "the ORDERING
claim failed" -- sending a reader after a physics bug that did not exist. The `except SystemExit:
raise` at the bottom preserved it deliberately, so the exit-2 path could never catch these.

★ THE RULE: a check that cannot tell "not sampled" from "broken" must REFUSE.

    0  evaluated, acceptable   1  evaluated, FAILED (verdict)   2  could not evaluate

These tests are site-specific on purpose. A single "infra raises InfrastructureError" test would
pass while four of the five sites still exited 1 -- the census defect shape this repo keeps hitting.
"""
import importlib.util
import os
import re
import sys

import pytest

_SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "scripts", "local_size_gonogo.py")


@pytest.fixture(scope="module")
def gonogo():
    """Import the script by path. It chdir()s to backend/ on import; restore cwd afterwards."""
    cwd = os.getcwd()
    spec = importlib.util.spec_from_file_location("local_size_gonogo_under_test", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    finally:
        os.chdir(cwd)
    return mod


class _Resp:
    def __init__(self, status_code, text="boom", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload if payload is not None else []

    def json(self):
        return self._payload


class _Session:
    def __init__(self, resp):
        self._resp = resp

    def get(self, *_a, **_kw):
        return self._resp


# --------------------------------------------------------------------------- the five sites

def test_site_no_credentials_is_infrastructure(gonogo, monkeypatch):
    """:99 -- no SUPABASE_* and no RENDER_API_KEY. Cannot reach production at all."""
    monkeypatch.setattr(os, "environ", {})
    monkeypatch.setattr(gonogo, "_render_api_key", lambda: "")
    with pytest.raises(gonogo.InfrastructureError):
        gonogo._prod_credentials(_Session(_Resp(200)))


def test_site_render_api_non_200_is_infrastructure(gonogo, monkeypatch):
    """:105 -- Render API refused. Says nothing about the calibration."""
    monkeypatch.setattr(os, "environ", {})
    monkeypatch.setattr(gonogo, "_render_api_key", lambda: "rnd_" + "x" * 24)
    with pytest.raises(gonogo.InfrastructureError):
        gonogo._prod_credentials(_Session(_Resp(502, "bad gateway")))


def test_site_render_env_missing_keys_is_infrastructure(gonogo, monkeypatch):
    """:113 -- Render answered, but without the two values we came for."""
    monkeypatch.setattr(os, "environ", {})
    monkeypatch.setattr(gonogo, "_render_api_key", lambda: "rnd_" + "x" * 24)
    resp = _Resp(200, payload=[{"envVar": {"key": "SOMETHING_ELSE", "value": "1"}}])
    with pytest.raises(gonogo.InfrastructureError):
        gonogo._prod_credentials(_Session(resp))


def test_site_object_fetch_non_200_is_infrastructure(gonogo):
    """:121 -- the climatology/ratings object did not come back."""
    with pytest.raises(gonogo.InfrastructureError):
        gonogo._get_json(_Session(_Resp(404, "not found")), "https://x/y", "svc", "climatology blob")


def test_site_missing_requests_is_infrastructure(gonogo, monkeypatch):
    """:158 -- the dependency is absent. Nothing was measured.

    A `None` entry in sys.modules makes `import requests` raise ImportError (documented CPython
    behaviour), which is enough to reach the site. Deliberately NOT monkeypatching
    `builtins.__import__`: that is fragile across interpreters and would be a fresh way for this
    lane to go red for a reason unrelated to what is under test.
    """
    monkeypatch.setitem(sys.modules, "requests", None)
    with pytest.raises(gonogo.InfrastructureError):
        gonogo.main()


# --------------------------------------------------------------------------- the contract

def test_infrastructure_error_is_not_a_systemexit(gonogo):
    """The whole defect in one assertion.

    `SystemExit` is what routed infrastructure to exit 1. If InfrastructureError ever becomes a
    SystemExit subclass again, `cli()`'s `except SystemExit: raise` would re-raise it and the exit
    code would silently return to 1.
    """
    assert issubclass(gonogo.InfrastructureError, Exception)
    assert not issubclass(gonogo.InfrastructureError, SystemExit)


def test_cli_maps_infrastructure_to_2_not_1(gonogo, monkeypatch):
    monkeypatch.setattr(gonogo, "main", lambda: (_ for _ in ()).throw(
        gonogo.InfrastructureError("no credentials")))
    assert gonogo.cli() == 2


def test_cli_maps_unexpected_exception_to_2(gonogo, monkeypatch):
    monkeypatch.setattr(gonogo, "main", lambda: (_ for _ in ()).throw(ValueError("surprise")))
    assert gonogo.cli() == 2


@pytest.mark.parametrize("verdict_code", [0, 1])
def test_cli_passes_real_verdicts_through_untouched(gonogo, monkeypatch, verdict_code):
    """0 and 1 are VERDICTS and must survive exactly -- the fix must not swallow a real NO-GO."""
    monkeypatch.setattr(gonogo, "main", lambda: verdict_code)
    assert gonogo.cli() == verdict_code


def test_cli_refuses_a_non_int_return(gonogo, monkeypatch):
    """A bare `return` in main() would exit 0 and report a PASS for a run that judged nothing."""
    monkeypatch.setattr(gonogo, "main", lambda: None)
    assert gonogo.cli() == 2


def test_cli_still_honours_an_explicit_systemexit(gonogo, monkeypatch):
    """`main()` returning an int is the only legitimate 0/1 source, but an explicit SystemExit
    raised deeper must not be rewritten into 2 -- that would hide a deliberate abort."""
    monkeypatch.setattr(gonogo, "main", lambda: (_ for _ in ()).throw(SystemExit(3)))
    with pytest.raises(SystemExit) as exc:
        gonogo.cli()
    assert exc.value.code == 3


def test_no_string_valued_systemexit_remains_in_the_script():
    """NON-VACUITY / regression guard.

    The defect was `raise SystemExit("...")` specifically -- a string payload exits 1. Reintroducing
    one anywhere in this script restores the bug, so assert the shape is gone from the source.
    """
    with open(_SCRIPT, encoding="utf-8") as fh:
        code = [ln.strip() for ln in fh if not ln.lstrip().startswith("#")]
    # Any `raise SystemExit(` whose argument is not a bare int restores the exit-1 behaviour.
    offenders = [ln for ln in code
                 if "raise SystemExit(" in ln and not re.search(r"raise SystemExit\(\s*\d+\s*\)", ln)]
    assert offenders == [], f"string-valued SystemExit reintroduced: {offenders}"


def test_infrastructure_messages_are_scrubbed(gonogo, monkeypatch):
    """Secret hygiene is part of this script's design; the new path must not leak what the old
    one scrubbed. A Render key in an error body must never reach the terminal."""
    secret = "rnd_" + "S" * 30
    monkeypatch.setattr(os, "environ", {})
    monkeypatch.setattr(gonogo, "_render_api_key", lambda: secret)
    gonogo._SECRETS.clear()
    with pytest.raises(gonogo.InfrastructureError) as exc:
        gonogo._prod_credentials(_Session(_Resp(500, f"token {secret} rejected")))
    assert secret not in str(exc.value)
