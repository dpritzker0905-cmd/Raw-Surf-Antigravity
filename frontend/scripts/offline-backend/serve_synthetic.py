"""The REAL backend app served over SYNTHETIC stored products: no network, no database, no secrets, no live traffic.

WHY. Replaying the browser against the live 1-CPU Render box is a load test of the production site (2026-10-01: the dev site
toasted "Couldn't load surf spots"); the older hand-written mock reproduced response SHAPES from recordings that are now
gone. This serves the real FastAPI routes (`/api/weather/capabilities`, `/products`, `/grid`, `/grid_series`) from a local
`ProductStore` filled with synthetic global_mid GFS wave frames, so the thinning, the mid-res tier, the bounds rewrite
(`SERIES_THIN_NODE_BOUNDS`) and the response schemas are the production code, not a model of it.

The field is invented, not forecast: a smooth swell climate plus a hurricane-like vortex off Mexico that drifts north-west,
so a drawn position can be measured against a KNOWN true position. Nothing here is a number the product serves.

Usage (from the repo root; the interpreter must have the backend's requirements):
  python frontend/scripts/offline-backend/serve_synthetic.py --dir <empty scratch dir> --port 4100 --thin-bounds 0|1
`--thin-bounds` sets SERIES_THIN_NODE_BOUNDS for this process only (run two processes for an A/B). Every outbound name lookup
to a non-local host fails at once, so no request can reach a real provider, database or bucket.
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"

WORLD = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 84.0}      # global_mid, 2 deg: 181 x 83
COARSE = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 80.0}     # global_coarse, 10 deg: 37 x 17 = 629 cells
COVERAGE = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
RES = 2.0
COARSE_RES = 10.0
# (region_id, bounds, resolution, filename stem). A world request needs the coarse product to exist: without a manifest
# product the resolver takes the DYNAMIC-VIEWPORT path, which asks Open-Meteo upstream (and stalls on a dead proxy).
TIERS = (("global_mid", WORLD, RES, "gfs_marine_waves_global_mid_"),
         ("global_coarse", COARSE, COARSE_RES, "gfs_marine_waves_global_coarse_"))
# The synthetic hurricane: where it truly is at hour h after the first frame (degrees). Tests read this back.
VORTEX_LAT0, VORTEX_LNG0, VORTEX_DLAT, VORTEX_DLNG = 14.0, -106.0, 0.05, -0.08


def vortex_center(hours_since_start):
    return (VORTEX_LAT0 + VORTEX_DLAT * hours_since_start, VORTEX_LNG0 + VORTEX_DLNG * hours_since_start)


def field(lat, lng, h):
    """Significant wave height (m), direction (deg), period (s) at a point; h = hours since the first frame."""
    storm_track = 2.4 * math.exp(-((abs(lat) - 50.0) / 12.0) ** 2)
    swell = 1.1 + 0.6 * math.sin(math.radians(lng * 2.0)) * math.cos(math.radians(lat)) + storm_track
    clat, clng = vortex_center(h)
    dlat, dlng = lat - clat, (lng - clng + 180.0) % 360.0 - 180.0
    r2 = dlat * dlat + (dlng * math.cos(math.radians(lat))) ** 2
    vort = 6.5 * math.exp(-r2 / (2.0 * 3.2 ** 2))
    hs = max(0.15, swell + vort)
    direction = (math.degrees(math.atan2(dlng, dlat)) + 90.0) % 360.0 if vort > 1.0 else (250.0 + 30.0 * math.sin(math.radians(lat))) % 360.0
    return round(hs, 3), round(direction, 1), round(6.5 + 1.1 * hs, 2)


def product_dict(run_time, valid_time, h, filename, region_id="global_mid", bounds=WORLD, res=RES):
    rows = int(round((bounds["north"] - bounds["south"]) / res)) + 1
    cols = int(round((bounds["east"] - bounds["west"]) / res)) + 1
    vectors = []
    for r in range(rows):
        lat = round(bounds["south"] + r * res, 4)
        for c in range(cols):
            lng = round(bounds["west"] + c * res, 4)
            hs, direction, period = field(lat, lng, h)
            rad = math.radians(direction)
            vectors.append({"lat": lat, "lng": lng, "speed": hs, "direction": direction,
                            "u": round(hs * math.sin(rad), 4), "v": round(hs * math.cos(rad), 4),
                            "period": period, "is_valid": True})
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    return {
        "model": "GFS", "provider": "noaa", "domain": "marine", "layer": "waves",
        "run_time": iso(run_time), "model_run_time": iso(run_time), "model_run_time_status": "known",
        "ingested_at": iso(run_time + timedelta(hours=4)), "valid_time": iso(valid_time),
        "is_forecast_authoritative": True, "is_estimated": False,
        "coverage": COVERAGE,
        "grid": {"bounds": dict(bounds), "cols": cols, "rows": rows, "vectors": vectors, "diagnostics": {"source": "stored"}},
        "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
        "product_id": filename, "source_variables": ["wave_height"], "freshness_sec": 3600,
        "region_id": region_id, "coverage_mode": "global_tile", "resolution": None,
        "upstream_provider": "noaa", "source_dataset": "synthetic",
    }


def build_store(directory, horizon_hours, step_hours, now=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    first = (now - timedelta(hours=now.hour % step_hours, minutes=now.minute, seconds=now.second, microseconds=now.microsecond)
             - timedelta(hours=6))
    run_time = first - timedelta(hours=first.hour % 6)
    entries = []
    n = int(horizon_hours // step_hours) + 3
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    for i in range(n):
        vt = first + timedelta(hours=i * step_hours)
        stamp = vt.strftime("%Y%m%dT%H%M%SZ")
        for region_id, bounds, res, stem in TIERS:
            filename = f"{stem}{stamp}.json"
            body = product_dict(run_time, vt, i * step_hours, filename, region_id, bounds, res)
            (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
            entries.append({
                "model": "GFS", "provider": "noaa", "domain": "marine", "layer": "waves", "run_time": iso(run_time),
                "model_run_time": iso(run_time), "model_run_time_status": "known", "ingested_at": iso(run_time + timedelta(hours=4)),
                "valid_time_start": iso(vt), "valid_time_end": iso(vt), "resolution": res, "freshness_sec": 3600,
                "is_forecast_authoritative": True, "coverage": COVERAGE, "filename": filename, "product_id": filename,
                "region_id": region_id, "coverage_mode": "global_tile", "upstream_provider": "noaa", "source_dataset": "synthetic",
            })
    (directory / "manifest.json").write_text(
        json.dumps({"last_manifest_update": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "products": entries}),
        encoding="utf-8")
    return {"first_valid": first.strftime("%Y-%m-%dT%H:%M:%SZ"), "frames": n, "run_time": run_time.strftime("%Y-%m-%dT%H:%M:%SZ")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, default=4100)
    ap.add_argument("--thin-bounds", choices=["0", "1"], default="0")
    ap.add_argument("--horizon", type=int, default=336)
    ap.add_argument("--step", type=int, default=3)
    ap.add_argument("--build-only", action="store_true")
    args = ap.parse_args()

    # NOT NODE_ENV=test / TESTING=1: grid_resolver skips the mid-res tier in a test environment, and the mid tier is the very
    # path under study. L2 is off because no Supabase variable is set (store._get_supabase_storage returns None without a URL
    # and key), so nothing can reach a real bucket or database from this process.
    for var in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
                "GITHUB_RUN_ID", "NODE_ENV", "TESTING", "PYTEST_CURRENT_TEST"):
        os.environ.pop(var, None)
    os.environ["SERIES_THIN_NODE_BOUNDS"] = args.thin_bounds
    # NO OUTBOUND TRAFFIC, by construction: every name lookup for a non-local host fails at once, whatever HTTP library asks
    # (requests, httpx and aiohttp all resolve through socket.getaddrinfo). A dead proxy was not enough: the resolver's
    # dynamic-viewport path retried a refused upstream for ~20 s per hour. Failing fast makes it fall back to the stored tiers.
    import socket
    real_getaddrinfo = socket.getaddrinfo

    def local_only_getaddrinfo(host, *a, **k):
        if host in (None, "", "127.0.0.1", "localhost", "::1"):
            return real_getaddrinfo(host, *a, **k)
        raise socket.gaierror(socket.EAI_NONAME, "offline harness: outbound name lookup blocked (%s)" % (host,))
    socket.getaddrinfo = local_only_getaddrinfo
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)

    meta = build_store(args.dir, args.horizon, args.step) if not (Path(args.dir) / "manifest.json").exists() else {"reused": True}
    print(json.dumps({"store": meta, "thin_bounds": args.thin_bounds}), flush=True)
    if args.build_only:
        return

    from server import app                                   # noqa: E402
    from routes import weather                               # noqa: E402
    from services.weather_pipeline.store import ProductStore  # noqa: E402
    weather.store = ProductStore(cache_dir=Path(args.dir))
    import uvicorn                                           # noqa: E402
    uvicorn.run(app, host="127.0.0.1", port=args.port, lifespan="off", log_level="warning")


if __name__ == "__main__":
    main()
