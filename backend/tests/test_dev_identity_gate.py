"""
The development-identity gate must FAIL CLOSED.

⚠️ THIS FILE EXISTS BECAUSE THE OLD GUARD WAS LIVE IN PRODUCTION. It read
    if os.getenv("ENV") != "production" and os.getenv("IS_PROD") != "true":
which asks "have we been TOLD this is production?" — and neither variable is set on Render, so it
answered "no" and handed out an authenticated identity. Measured against the live backend on
2026-08-06 with no credentials:
    GET /api/streak/dev-mock-user-id                        -> 401
    ... with `Authorization: Bearer not-a-real-token-xyz`   -> 401   (control)
    ... with `Authorization: Bearer dev-mock-user-token`    -> 200
The same condition guarded the mock-profile seeding, so production also held a seeded
`dev-mock-user-id` with is_admin=True and withdrawable credits.

★ EVERY TEST BELOW IS PHRASED AS "SAYING NOTHING MUST MEAN NO". A gate like this cannot be
  covered by testing the happy path — the defect was entirely in what happened when the
  environment was SILENT, which is the case no one thinks to write down.
"""
import pytest

from core import security
from core.security import dev_identity_allowed, get_current_user_id
from routes.live.websocket import verify_websocket_auth

# Everything that can influence the gate. Cleared before each case so the test states the whole
# environment rather than inheriting conftest's TESTING=1 by accident.
_ALL_VARS = ("ENV", "ENVIRONMENT", "NODE_ENV", "IS_PROD", "TESTING", "ALLOW_DEV_MOCK_AUTH",
             "RENDER", "DYNO", "K_SERVICE", "FLY_APP_NAME", "WEBSITE_INSTANCE_ID",
             "KUBERNETES_SERVICE_HOST", "AWS_EXECUTION_ENV", "VERCEL")


@pytest.fixture
def clean_env(monkeypatch):
    for var in _ALL_VARS:
        monkeypatch.delenv(var, raising=False)
    security._warned_refusal = False
    return monkeypatch


# ── The gate itself ───────────────────────────────────────────────────────────

def test_silent_environment_is_treated_as_production(clean_env):
    """THE REGRESSION. No variable set at all — the exact shape the old guard let through."""
    assert dev_identity_allowed() is False


@pytest.mark.parametrize("marker", ["RENDER", "DYNO", "K_SERVICE", "FLY_APP_NAME",
                                    "WEBSITE_INSTANCE_ID", "KUBERNETES_SERVICE_HOST",
                                    "AWS_EXECUTION_ENV", "VERCEL"])
def test_any_deployment_marker_closes_the_gate(clean_env, marker):
    """Render sets RENDER=true and nothing else — that alone must be decisive."""
    clean_env.setenv(marker, "true")
    assert dev_identity_allowed() is False


@pytest.mark.parametrize("var,value", [("ENV", "production"), ("IS_PROD", "true")])
def test_explicit_production_closes_the_gate(clean_env, var, value):
    clean_env.setenv(var, value)
    assert dev_identity_allowed() is False


def test_a_deployment_marker_beats_a_local_claim(clean_env):
    """A deployed process that also says TESTING=1 is still deployed. Deny must win."""
    clean_env.setenv("RENDER", "true")
    clean_env.setenv("TESTING", "1")
    clean_env.setenv("ENV", "development")
    assert dev_identity_allowed() is False


@pytest.mark.parametrize("var,value", [
    ("TESTING", "1"),
    ("ALLOW_DEV_MOCK_AUTH", "true"),
    ("ENV", "development"),
    ("ENV", "local"),
    ("NODE_ENV", "development"),
    ("ENVIRONMENT", "test"),
])
def test_an_explicit_local_signal_opens_the_gate(clean_env, var, value):
    """The shortcut must still work where it is meant to, or developers will route around it."""
    clean_env.setenv(var, value)
    assert dev_identity_allowed() is True


def test_an_unrecognised_env_value_does_not_open_the_gate(clean_env):
    """`ENV=staging` is not production by name, but it is certainly not a local workstation."""
    clean_env.setenv("ENV", "staging")
    assert dev_identity_allowed() is False


# ── What the gate protects ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mock_token_is_rejected_when_the_gate_is_closed(clean_env):
    clean_env.setenv("RENDER", "true")
    with pytest.raises(Exception) as excinfo:
        await get_current_user_id(authorization="Bearer dev-mock-user-token")
    assert getattr(excinfo.value, "status_code", None) == 401


@pytest.mark.asyncio
async def test_mock_token_still_works_locally(clean_env):
    clean_env.setenv("TESTING", "1")
    assert await get_current_user_id(authorization="Bearer dev-mock-user-token") == "dev-mock-user-id"


class _RecordingWebSocket:
    """Mirrors tests/test_websocket_auth.py — records the close so a refusal is observable."""

    def __init__(self):
        self.query_params = {}
        self.closed_with = None
        self.accepted = False

    async def accept(self, *a, **kw):
        self.accepted = True

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed_with = (code, reason)


@pytest.mark.parametrize("user_id", ["dev-mock-user-id", "test-surfer-id", "admin-user-id"])
@pytest.mark.asyncio
async def test_websocket_bypass_ids_are_refused_when_deployed(clean_env, user_id):
    """
    All 12 combinations of these ids x {earnings,user,presence,call} opened against the LIVE
    backend with no token before this gate existed.
    """
    clean_env.setenv("RENDER", "true")
    ws = _RecordingWebSocket()
    assert await verify_websocket_auth(ws, user_id) is False
    assert ws.closed_with is not None and ws.closed_with[0] == 1008
    assert not ws.accepted


@pytest.mark.parametrize("user_id", ["dev-mock-user-id", "test-surfer-id", "admin-user-id"])
@pytest.mark.asyncio
async def test_websocket_bypass_ids_still_work_locally(clean_env, user_id):
    clean_env.setenv("TESTING", "1")
    ws = _RecordingWebSocket()
    assert await verify_websocket_auth(ws, user_id) is True
    assert ws.closed_with is None


@pytest.mark.asyncio
async def test_a_normal_user_id_is_never_bypassed(clean_env):
    """The CONTROL that made the live measurement readable: a non-listed id is always refused."""
    clean_env.setenv("TESTING", "1")
    ws = _RecordingWebSocket()
    assert await verify_websocket_auth(ws, "not-a-bypass-id-999") is False
    assert ws.closed_with[0] == 1008
