"""Opt-in backend tracing and host metrics; never enable export implicitly."""
import os
from pathlib import Path


def configure_logfire(app, *, local_only=False):
    """Configure once at app creation, before Starlette builds its middleware."""
    if os.environ.get("LOGFIRE_ENABLED") != "1":
        return False

    import logfire

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
    return True
