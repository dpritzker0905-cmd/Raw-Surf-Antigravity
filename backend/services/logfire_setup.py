"""Opt-in backend tracing and host metrics; never enable export implicitly.

Telemetry must never stop the API from booting. On 2026-10-21 Render had LOGFIRE_ENABLED=1 without a
LOGFIRE_TOKEN; logfire.configure raised LogfireConfigError inside server.py's import and the deploy
failed (dep-dbcb9eg473hc73fn0hdg, update_failed; the previous deploy stayed live). A missing credential or
a missing package now logs one warning and leaves the app uninstrumented.
"""
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def configure_logfire(app, *, local_only=False):
    """Configure once at app creation, before Starlette builds its middleware.

    Returns True only when tracing is configured; False when it is off (LOGFIRE_ENABLED is not "1") or when
    it cannot be configured (no credential, package missing). Never raises for those cases.
    """
    if os.environ.get("LOGFIRE_ENABLED") != "1":
        return False

    try:
        import logfire
        from logfire.exceptions import LogfireConfigError
    except ImportError as exc:
        logger.warning("[Logfire] LOGFIRE_ENABLED=1 but the logfire package is unavailable (%s); tracing stays off",
                       type(exc).__name__)
        return False

    try:
        logfire.configure(
            service_name="raw-surf-api",
            service_version=os.environ.get("RENDER_GIT_COMMIT"),
            environment=os.environ.get("LOGFIRE_ENVIRONMENT", "local"),
            data_dir=Path(__file__).resolve().parents[2] / ".logfire",
            send_to_logfire=not local_only,
            console=False,
            inspect_arguments=False,
        )
        # Do not capture endpoint arguments or headers (payment/chat/auth routes).
        # SDK scrubbing remains enabled for standard OpenTelemetry attributes.
        logfire.instrument_fastapi(
            app,
            capture_headers=False,
            request_attributes_mapper=lambda request, attributes: {},
        )
        logfire.instrument_system_metrics(base="basic")
    except LogfireConfigError:
        # The credential is a write token (LOGFIRE_TOKEN) or a local `logfire auth` file; neither was found.
        logger.warning("[Logfire] LOGFIRE_ENABLED=1 but no Logfire credential was found (set LOGFIRE_TOKEN); "
                       "tracing stays off and the API starts normally")
        return False
    except Exception as exc:  # noqa: BLE001  telemetry is optional; boot is not
        # Seen 2026-10-21 on a machine with a user-level `logfire auth` file and no project credential: configure
        # tried an interactive project lookup and raised requests' SSLError, not LogfireConfigError.
        logger.warning("[Logfire] setup failed (%s); tracing stays off and the API starts normally",
                       type(exc).__name__)
        return False
    return True
