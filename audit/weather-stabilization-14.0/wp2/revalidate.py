"""Read-only grid selection probe; controlled latitude, audit Sebastian longitudes."""
import json
import urllib.request
import urllib.parse
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://raw-surf-antigravity.onrender.com"
VT = "2026-09-20T18:00:00Z"
BOXES = {
    "sebastian_audit_longitudes": [-81.93, 26.5, -78.97, 29.2],
    "edge_inside": [-81.9601, 26.5, -79.0001, 29.2],
    "edge_outside": [-81.9599, 26.5, -78.9999, 29.2],
    "healthy_inside": [-81.19, 27.2, -79.71, 28.5],
}
BROWSER = "--browser" in sys.argv
if BROWSER:
    VT = "2026-09-20T21:00:00Z"
    BOXES = {
        "actual_z8_viewport": [-81.93315429687473, 26.761836762966084, -78.96684570312489, 28.947149606276398],
        "actual_padded_series_request": [-82.4332, 26.2618, -78.4668, 29.4471],
    }


def fetch(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    with urllib.request.urlopen(url, timeout=90) as response:
        return json.loads(response.read())


result = {"at": datetime.now(timezone.utc).isoformat(), "valid_time": VT,
          "latitude_note": "Root browser capture at 20:31:49Z, 1280x900, Sebastian z8; replay uses /grid, not /grid_series."
          if BROWSER else "Controlled latitude; audit omitted actual browser latitude.",
          "health_version": fetch("/api/health").get("version"), "cases": []}
for name, coords in BOXES.items():
    bbox = ",".join(map(str, coords))
    item = fetch("/api/weather/grid", {"model": "GFS", "domain": "marine", "layer": "waves",
                                     "valid_time": VT, "bbox": bbox})
    longitudes = sorted({v["lng"] for v in item.get("grid", {}).get("vectors", [])})
    spacing = sorted({round(b - a, 8) for a, b in zip(longitudes, longitudes[1:])})
    result["cases"].append({"case": name, "requested_bbox": bbox,
                            **{k: item.get(k) for k in ("product_id", "resolution", "partial_coverage",
                                                       "coverage_scope", "served_bbox", "stale",
                                                       "model_run_time", "ingested_at")},
                            "native_longitude_spacing": spacing,
                            "vector_count": len(item.get("grid", {}).get("vectors", []))})
Path(__file__).with_name("live-exact-browser.json" if BROWSER else "live-before.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
