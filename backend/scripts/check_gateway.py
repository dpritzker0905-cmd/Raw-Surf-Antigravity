"""One synthetic request through the configured application Gateway (no retries)."""
import asyncio
import json
import os
from pathlib import Path
import sys

import httpx
from dotenv import dotenv_values
import truststore

truststore.inject_into_ssl()
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
from services.llm_transport import openai_connection


async def main():
    # Copy only Gateway variables; never print dotenv contents or configuration repr.
    for name, value in dotenv_values(root / "backend" / ".env").items():
        if name.startswith("PYDANTIC_AI_GATEWAY_") and value:
            os.environ[name] = value
    connection = openai_connection()
    if not connection.via_gateway:
        raise RuntimeError("Gateway credential is not configured")
    model = os.environ.get("PYDANTIC_AI_GATEWAY_MODEL", "gpt-6-luna")
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.post(connection.base_url + "/chat/completions",
                                     headers={"Authorization": "Bearer " + connection.api_key},
                                     json={"model": model, "messages": [{"role": "user", "content":
                                           "Reply with exactly: Raw Surf Gateway test OK."}],
                                           "max_completion_tokens": 128})
    result = {"http_status": response.status_code, "model": model,
              "provider": "openai", "endpoint": connection.base_url}
    if response.status_code == 200:
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        if connection.api_key in str(content):
            raise RuntimeError("Refusing to display provider output containing a credential")
        result.update({"response": content, "request_id": body.get("id"), "usage": body.get("usage")})
    else:
        # Provider error bodies may echo credentials: never print them.
        result["error"] = "Gateway request rejected; inspect provider configuration privately"
    print(json.dumps(result))
    if response.status_code != 200:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
