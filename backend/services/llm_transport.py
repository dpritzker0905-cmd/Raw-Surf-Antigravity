"""OpenAI-compatible application routing; credential values never appear in repr."""
from dataclasses import dataclass, field
import os

GATEWAY_ENDPOINT = "https://gateway-us.pydantic.dev/proxy/openai"


@dataclass(frozen=True)
class OpenAIConnection:
    api_key: str = field(repr=False)
    base_url: str
    via_gateway: bool


def openai_connection():
    gateway_key = os.environ.get("PYDANTIC_AI_GATEWAY_API_KEY", "").strip()
    if gateway_key:
        endpoint = os.environ.get("PYDANTIC_AI_GATEWAY_BASE_URL", GATEWAY_ENDPOINT).rstrip("/")
        provider = os.environ.get("PYDANTIC_AI_GATEWAY_PROVIDER", "openai")
        if endpoint != GATEWAY_ENDPOINT or provider != "openai":
            raise ValueError("Gateway must use the confirmed US endpoint and OpenAI transport")
        return OpenAIConnection(gateway_key, endpoint, True)
    return OpenAIConnection(os.environ.get("OPENAI_API_KEY", "").strip(), "https://api.openai.com/v1", False)
