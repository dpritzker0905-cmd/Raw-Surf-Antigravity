"""Bounded local FastAPI smoke check; never starts backend jobs or migrations.

Run: .venv/Scripts/python backend/scripts/check_logfire_setup.py --local-only
Omitting --local-only sends synthetic tracing and basic host metrics to Logfire.
This validates the shared setup seam, not full backend startup or deployment.
"""
import asyncio
import argparse
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

import truststore

truststore.inject_into_ssl()  # Windows system roots; HTTPS verification stays on.
os.environ.pop("LOGFIRE_TOKEN", None)  # Verify the selected local credential.
os.environ["OTEL_METRIC_EXPORT_INTERVAL"] = "1000"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import logfire
from fastapi import FastAPI
from services.logfire_setup import configure_logfire


async def main(local_only):
    app = FastAPI()
    os.environ.pop("LOGFIRE_ENABLED", None)
    assert configure_logfire(app) is False
    os.environ["LOGFIRE_ENABLED"] = "1"
    assert configure_logfire(app, local_only=local_only) is True
    run_id = str(uuid4())

    @app.get("/__logfire_setup__")
    async def smoke():
        logfire.info("Logfire setup smoke {setup_run_id}", setup_run_id=run_id)
        return {"ok": True}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://localhost"
    ) as client:
        response = await client.get("/__logfire_setup__")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
    await asyncio.sleep(3)  # Bounded metrics collection, no backend startup jobs.
    assert logfire.force_flush(timeout_millis=10000)
    print(json.dumps({"setup_run_id": run_id, "status": response.status_code,
                      "service_name": "raw-surf-api", "flush_completed": True,
                      "local_only": local_only}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true", help="Disable network export")
    asyncio.run(main(parser.parse_args().local_only))
