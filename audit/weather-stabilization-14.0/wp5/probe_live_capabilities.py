"""Bounded public, read-only EURO capability/serving probe (no credentials)."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://raw-surf-antigravity.onrender.com"
HERE = Path(__file__).resolve().parent
FIELDS = (
    "model", "domain", "layer", "product_id", "provider", "upstream_provider",
    "upstream_model", "source_dataset", "resolution", "coverage_scope", "coverage_mode",
    "partial_coverage", "served_bbox", "requested_bbox", "valid_time", "run_time",
    "model_run_time", "model_run_time_status", "ingested_at", "is_estimated",
    "is_forecast_authoritative", "stale", "staleReason", "fallbackReason",
)


def get(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=35) as response:
            raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                raise ValueError("bounded probe response exceeded one MB")
            data = json.loads(raw)
            return data, {"url": url, "status": response.status,
                          "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                          "seconds": round(time.monotonic() - started, 3)}
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return None, {"url": url, "error": type(exc).__name__,
                      "seconds": round(time.monotonic() - started, 3)}


def main():
    now = datetime.now(timezone.utc)
    target = now.replace(hour=now.hour // 3 * 3, minute=0, second=0, microsecond=0)
    health, health_receipt = get("/api/health")
    capabilities, capability_receipt = get("/api/weather/capabilities")
    result = {"captured_at": now.isoformat(), "target": target.isoformat(),
              "health": {"version": (health or {}).get("version"), **health_receipt},
              "capabilities": capabilities, "capability_request": capability_receipt,
              "grids": []}
    for layer in ("waves", "swell_1", "swell_2", "wind_waves"):
        data, receipt = get("/api/weather/grid", {
            "model": "EURO", "domain": "marine", "layer": layer,
            "valid_time": target.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bbox": "-81,26,-79,28",
        })
        grid = (data or {}).get("grid") or {}
        receipt.update({key: (data or {}).get(key) for key in FIELDS})
        receipt["requested_layer"] = layer
        receipt["grid_summary"] = {"cols": grid.get("cols"), "rows": grid.get("rows"),
                                   "vectors": len(grid.get("vectors") or [])}
        result["grids"].append(receipt)
        print(json.dumps(receipt), flush=True)
    (HERE / "live-capabilities-before.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
