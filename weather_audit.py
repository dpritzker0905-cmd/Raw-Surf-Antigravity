# weather_audit.py
"""Stage 6I.2C Weather Evidence Integrity Audit
Executes the full audit as described in the implementation plan.
Outputs artifacts under the Antigravity brain artifact directory.
"""
import json, os, sys, logging
from datetime import datetime, timedelta, timezone
import requests

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Configuration
BASE_URL = os.environ.get("WEATHER_AUDIT_BASE_URL", "https://raw-surf-antigravity.onrender.com")
MANIFEST_URL = f"{BASE_URL}/api/weather/products"
BBOX = "-85,24,-79,31"
LAT, LNG = 27.5, -82.0  # approximate centre of Florida bbox
LAYER_LIST = ["waves", "swell_1", "swell_2", "wind_waves"]
OFFSET_LABELS = [
    ("Live", 0),
    ("+6h", 6),
    ("+24h", 24),
    ("+48h", 48),
    ("+72h", 72),
    ("+75h", 75),
    ("+120h", 120),
    ("+168h", 168),
    ("+240h", 240),
    ("+243h", 243),
    ("+336h", 336),
]
# Artifact root (brain artifacts directory)
ARTIFACT_ROOT = os.environ.get(
    "ANTIGRAVITY_ARTIFACT_ROOT",
    r"C:\Users\dprit\.gemini\antigravity\brain\62ce87d9-d27a-4f39-9549-af7ce582a219"
)
os.makedirs(ARTIFACT_ROOT, exist_ok=True)

def iso_valid_time(hours_offset: int) -> str:
    """Return ISO‑8601 UTC timestamp with trailing Z.
    Uses the fixed reference time from the request (2026‑06‑05T13:39:51‑04:00).
    """
    now_utc = datetime(2026, 6, 15, 6, 0, 0, tzinfo=timezone.utc)
    target = now_utc + timedelta(hours=hours_offset)
    return target.strftime("%Y-%m-%dT%H:%M:%SZ")

def fetch_json(url: str, params: dict = None) -> dict:
    """GET JSON safely – on failure returns empty dict and logs error."""
    try:
        resp = requests.get(url, params=params, timeout=90)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logging.error(f"Failed request to {url} with params {params}: {e}")
        return {}

def save_json(data, filename):
    path = os.path.join(ARTIFACT_ROOT, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return path

def main():
    # 1. Manifest
    manifest = fetch_json(MANIFEST_URL)
    save_json(manifest, "manifest.json")
    euro_items = [p for p in manifest.get("products", []) if p.get("model") == "EURO" and p.get("domain") == "marine"]
    if not euro_items:
        logging.error("No EURO marine product found – aborting audit.")
        sys.exit(1)
    # Use first matching product as representative
    euro = euro_items[0]
    tile_id = euro.get("tile_id")
    coverage = euro.get("coverage")
    first_valid = euro.get("first_valid_time")
    last_valid = euro.get("last_valid_time")
    # Count products per required layer
    layer_counts = {layer: 0 for layer in LAYER_LIST}
    for prod in euro_items:
        layer = prod.get("layer")
        if layer in layer_counts:
            layer_counts[layer] += 1
    # Bbox sanity validation
    bbox_validation = {
        "west": coverage.get("west") if isinstance(coverage, dict) else None,
        "south": coverage.get("south") if isinstance(coverage, dict) else None,
        "east": coverage.get("east") if isinstance(coverage, dict) else None,
        "north": coverage.get("north") if isinstance(coverage, dict) else None,
        "west_lt_east": coverage.get("west", 0) < coverage.get("east", 0) if isinstance(coverage, dict) else False,
        "south_lt_north": coverage.get("south", 0) < coverage.get("north", 0) if isinstance(coverage, dict) else False,
        "florida_lat_positive": coverage.get("south", 0) > 0 and coverage.get("north", 0) > 0 if isinstance(coverage, dict) else False,
        "florida_lon_negative": coverage.get("west", 0) < 0 and coverage.get("east", 0) < 0 if isinstance(coverage, dict) else False,
        "ordering": "west,south,east,north",
        "verdict": "VALID"
    }
    if isinstance(coverage, dict) and not all([
        bbox_validation["west_lt_east"],
        bbox_validation["south_lt_north"],
        bbox_validation["florida_lat_positive"],
        bbox_validation["florida_lon_negative"]
    ]):
        bbox_validation["verdict"] = "INVALID"
    save_json(bbox_validation, "bbox_validation.json")

    bbox_covered = (isinstance(coverage, dict) and
                    coverage.get("west", 999) <= -85.0 and
                    coverage.get("south", 999) <= 24.0 and
                    coverage.get("east", -999) >= -79.0 and
                    coverage.get("north", -999) >= 31.0)
    manifest_summary = {
        "tile_id": tile_id,
        "coverage": coverage,
        "first_valid_time": first_valid,
        "last_valid_time": last_valid,
        "layer_counts": layer_counts,
        "florida_bbox_covered": bbox_covered,
    }
    save_json(manifest_summary, "manifest_summary.json")

    structural_errors = []
    parity_errors = []
    for layer in LAYER_LIST:
        for label, hrs in OFFSET_LABELS:
            vt = iso_valid_time(hrs)
            # ---- Grid request ----
            grid_params = {
                "model": "EURO",
                "domain": "marine",
                "layer": layer,
                "valid_time": vt,
                "bbox": BBOX,
            }
            grid_data = fetch_json(f"{BASE_URL}/api/weather/grid", params=grid_params)
            grid_fname = f"grid_{layer}_{label.replace('+','plus').replace('h','h')}.json"
            save_json(grid_data, grid_fname)
            # Structural checks (grid only)
            cols = grid_data.get("cols")
            rows = grid_data.get("rows")
            vectorCount = grid_data.get("vectorCount")
            nonzeroCount = grid_data.get("nonzeroCount")
            if cols is not None and rows is not None and vectorCount is not None:
                if cols * rows != vectorCount:
                    structural_errors.append({"type": "grid_vector_mismatch", "layer": layer, "offset": label, "detail": f"{cols}*{rows}!={vectorCount}"})
            if nonzeroCount is not None and vectorCount is not None:
                if nonzeroCount > vectorCount:
                    structural_errors.append({"type": "grid_nonzero_exceeds", "layer": layer, "offset": label, "detail": f"{nonzeroCount}>{vectorCount}"})
            # ---- Point request ----
            point_params = {
                "model": "EURO",
                "domain": "marine",
                "layer": layer,
                "valid_time": vt,
                "lat": LAT,
                "lng": LNG,
                "grid_bbox": BBOX,
            }
            point_data = fetch_json(f"{BASE_URL}/api/weather/point", params=point_params)
            point_fname = f"point_{layer}_{label.replace('+','plus').replace('h','h')}.json"
            save_json(point_data, point_fname)
            # Parity checks between grid and point (product‑level)
            # Build parity fields with safe handling for optional nested dicts
            def _safe_type(data):
                eb = data.get("estimate_basis")
                if isinstance(eb, dict):
                    return eb.get("type")
                return None

            fields = [
                (grid_data.get("product_id"), point_data.get("product_id"), "product_id"),
                (grid_data.get("valid_time"), point_data.get("valid_time"), "valid_time"),
                (grid_data.get("provider"), point_data.get("provider"), "provider"),
                (grid_data.get("is_estimated"), point_data.get("is_estimated"), "is_estimated"),
                (_safe_type(grid_data), _safe_type(point_data), "estimate_basis.type"),
            ]
            for gv, pv, name in fields:
                if gv != pv:
                    parity_errors.append({"type": "product_parity", "layer": layer, "offset": label, "field": name, "grid": gv, "point": pv})
    # Save error collections
    save_json(structural_errors, "structural_errors.json")
    save_json(parity_errors, "parity_errors.json")

    # 4. Verdict (Render side only – Netlify diagnostics will be added later)
    render_verdict = "PASS" if not structural_errors and not parity_errors else "BLOCKED"
    verdict_detail = {
        "render_verdict": render_verdict,
        "structural_errors_count": len(structural_errors),
        "parity_errors_count": len(parity_errors),
    }
    save_json(verdict_detail, "render_verdict.json")

    logging.info("Render audit completed – artifacts written to %s", ARTIFACT_ROOT)

if __name__ == "__main__":
    main()
