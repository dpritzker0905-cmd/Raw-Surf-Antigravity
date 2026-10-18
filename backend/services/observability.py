"""Logfire tracing for Pydantic AI agents (opt-in, no-op without LOGFIRE_TOKEN)."""
import logging
import os

logger = logging.getLogger(__name__)
_configured = False


def setup_agent_tracing() -> bool:
    """Configure Logfire and instrument Pydantic AI once. Returns True if traces will be sent."""
    global _configured
    if _configured:
        return True
    if not os.environ.get("LOGFIRE_TOKEN"):
        return False
    try:
        import logfire

        logfire.configure(service_name="raw-surf-backend", send_to_logfire="if-token-present", console=False)
        logfire.instrument_pydantic_ai()
        _configured = True
    except Exception:
        logger.warning("Logfire tracing setup failed; continuing without traces")
    return _configured
