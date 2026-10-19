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


# Provider fields MIRROR PRODUCTION (read from the real manifest 2026-10-16). They are load-bearing: WebGLMarineLayer drops a frame
# whose grid provider is not whitelisted and silently keeps the previous hour. The first cut said "noaa" for GFS and produced a
# scrub that never rendered, which looked like an app bug and was this fixture (ledger 1297).
#   GFS waves   : provider "open-meteo", upstream_provider "noaa", source_dataset "ncep_gfswave025"
#   ICON waves  : provider "open-meteo", upstream_provider "dwd",  source_dataset "dwd_gwam"        (native, to hour 168)
#   ICON beyond : provider "estimated", upstream_provider None, source_dataset "estimated_blend", is_estimated True,
#                 is_forecast_authoritative False, model_run_time None / status "conflicting", estimate_basis
#                 {"type": "icon_persistence_gfs_blend", "native_limit_hours": 168, ...}   (hours 171 to 336)
ICON_NATIVE_HOURS = 168
EURO_NATIVE_HOURS = 240
EURO_WAVES_6H_AFTER = 144        # ECMWF WAM open data is 6-hourly past 144 h: the stored lattice has gaps there
SCALE = {"GFS": 1.0, "ICON": 0.92, "EURO": 1.06}
LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")


def tiers_for(model, layer):
    """Stored tiers per (model, layer), mirroring the production manifest (read 2026-10-19): GFS has every layer at
    global_mid + global_coarse; ICON has no swell_2 product (the client blends GFS/EURO); EURO waves (ECMWF WAM) has
    both tiers while swell_1 / swell_2 / wind_waves are Copernicus CMEMS at global_coarse ONLY."""
    if model == "ICON" and layer == "swell_2":
        return ()
    if model == "EURO" and layer != "waves":
        return tuple(t for t in TIERS if t[0] == "global_coarse")
    return TIERS


ICON_WIND_NATIVE_HOURS = 180


def wind_field(lat, lng, h):
    """Synthetic 10 m wind (knots, meteorological FROM direction): trades/westerlies by latitude plus a cyclonic vortex
    on the SAME known track as the wave storm (vortex_center), so the lab has a truth for both field and particle motion."""
    zonal = -12.0 * math.cos(math.radians(lat * 3.0))            # east wind (negative u) in the trades, west wind in mid-latitudes
    u_kn, v_kn = zonal, 2.0 * math.sin(math.radians(lng))
    clat, clng = vortex_center(h)
    dlat, dlng = lat - clat, ((lng - clng + 180.0) % 360.0 - 180.0) * math.cos(math.radians(lat))
    r = math.hypot(dlat, dlng)
    if r > 1e-6:
        vt = 60.0 * (r / 1.5) * math.exp(1.0 - r / 1.5) if r < 12.0 else 0.0   # Rankine-like profile, 60 kn at 1.5 deg
        sign = 1.0 if lat >= 0 else -1.0                             # counter-clockwise in the northern hemisphere
        u_kn += -sign * vt * dlat / r
        v_kn += sign * vt * dlng / r
    speed = math.hypot(u_kn, v_kn)
    direction = (math.degrees(math.atan2(-u_kn, -v_kn)) + 360.0) % 360.0   # FROM, as the normalizer writes it
    return round(speed, 3), round(direction, 1), round(u_kn, 4), round(v_kn, 4)


def wind_provider_fields(model, estimated):
    """Mirrors the production manifest (read 2026-10-19)."""
    if model == "ICON":
        return {"provider": "open-meteo", "upstream_provider": "dwd",
                "source_dataset": "icon_loop_extrapolation" if estimated else "dwd_icon"}
    if model == "EURO":
        if estimated:
            return {"provider": "estimated", "upstream_provider": None, "source_dataset": "estimated_interpolation"}
        return {"provider": "open-meteo", "upstream_provider": "ecmwf", "source_dataset": "ecmwf_ifs"}
    return {"provider": "open-meteo", "upstream_provider": "noaa", "source_dataset": "gfs_seamless"}


def wind_product_dict(run_time, valid_time, h, filename, region_id, bounds, res, model, estimated):
    rows = int(round((bounds["north"] - bounds["south"]) / res)) + 1
    cols = int(round((bounds["east"] - bounds["west"]) / res)) + 1
    vectors = []
    for r in range(rows):
        lat = round(bounds["south"] + r * res, 4)
        for c in range(cols):
            lng = round(bounds["west"] + c * res, 4)
            speed, direction, u, v = wind_field(lat, lng, h)
            vectors.append({"lat": lat, "lng": lng, "speed": speed, "direction": direction, "u": u, "v": v, "is_valid": True})
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    body = {
        "model": model, "domain": "wind", "layer": "wind",
        "run_time": iso(run_time), "model_run_time": iso(run_time), "model_run_time_status": "known",
        "ingested_at": iso(run_time + timedelta(hours=4)), "valid_time": iso(valid_time),
        "is_forecast_authoritative": not estimated, "is_estimated": estimated, "estimate_basis": None,
        "coverage": COVERAGE,
        "grid": {"bounds": dict(bounds), "cols": cols, "rows": rows, "vectors": vectors, "diagnostics": {"source": "stored"}},
        "value_kind": "wind_speed", "value_unit": "kn", "display_unit_hint": "kn",
        "product_id": filename, "source_variables": ["wind_speed_10m", "wind_direction_10m"], "freshness_sec": 3600,
        "region_id": region_id, "coverage_mode": "global_tile", "resolution": None,
    }
    body.update(wind_provider_fields(model, estimated))
    return body


def layer_field(layer, hs, direction, period, lat, lng, h):
    """Distinct synthetic partitions so a wrong-layer frame is detectable on screen (heights in m)."""
    if layer == "swell_1":
        return round(max(0.1, 0.8 * hs), 3), direction, round(period + 2.0, 2)
    if layer == "swell_2":
        return round(0.25 + 0.35 * (1.0 + math.sin(math.radians(lat * 3.0 + h * 2.0))), 3), (direction + 70.0) % 360.0, 9.0
    if layer == "wind_waves":
        return round(max(0.1, 0.25 * hs + 0.2 * math.cos(math.radians(lng * 4.0))), 3), (direction + 25.0) % 360.0, 4.5
    return hs, direction, period


def provider_fields(model, estimated, layer="waves"):
    if model == "EURO":
        if layer != "waves":
            if estimated:
                return {"provider": "copernicus", "upstream_provider": "noaa", "source_dataset": "gfs_estimated_fallback"}
            return {"provider": "copernicus", "upstream_provider": "copernicus",
                    "source_dataset": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"}
        if estimated:
            return {"provider": "open-meteo", "upstream_provider": "noaa", "source_dataset": "gfs_estimated_fallback"}
        return {"provider": "open-meteo", "upstream_provider": "ecmwf", "source_dataset": "ecmwf_wam025"}
    if estimated:
        return {"provider": "estimated", "upstream_provider": None, "source_dataset": "estimated_blend"}
    if model == "ICON":
        return {"provider": "open-meteo", "upstream_provider": "dwd", "source_dataset": "dwd_gwam"}
    return {"provider": "open-meteo", "upstream_provider": "noaa", "source_dataset": "ncep_gfswave025"}


def estimate_basis(valid_time, region_id, run_time):
    stamp = valid_time.strftime("%Y%m%dT%H%M%SZ")
    return {
        "type": "icon_persistence_gfs_blend", "target_valid_time": valid_time.isoformat(), "layer": "waves",
        "region_id": region_id, "tile_id": region_id, "native_limit_hours": ICON_NATIVE_HOURS,
        "gfs_anchor_product_id": f"gfs_marine_waves_{region_id}_{stamp}.json", "gfs_target_product_id": f"gfs_marine_waves_{region_id}_{stamp}.json",
        "icon_anchor_product_id": None, "icon_target_product_id": None,
        "persistence_anchor_product_id": f"icon_marine_waves_{region_id}_{(run_time + timedelta(hours=168)).strftime('%Y%m%dT%H%M%SZ')}.json",
        "persistence_anchor_valid_time": (run_time + timedelta(hours=168)).isoformat(),
        "weights": {"persistence": 0.6625, "gfs": 0.3375, "icon": 0.0}, "confidence": 0.98,
        "anchor_delta_hours": 0.0, "target_delta_hours": 0.0, "cycle_semantics": "shared_contributor_cycle", "cycle_sources": [],
    }


def product_dict(run_time, valid_time, h, filename, region_id="global_mid", bounds=WORLD, res=RES, model="GFS", estimated=False,
                 layer="waves"):
    rows = int(round((bounds["north"] - bounds["south"]) / res)) + 1
    cols = int(round((bounds["east"] - bounds["west"]) / res)) + 1
    scale = SCALE[model]
    vectors = []
    for r in range(rows):
        lat = round(bounds["south"] + r * res, 4)
        for c in range(cols):
            lng = round(bounds["west"] + c * res, 4)
            hs, direction, period = field(lat, lng, h)
            hs, direction, period = layer_field(layer, hs, direction, period, lat, lng, h)
            hs = round(max(0.1, hs * scale), 3)
            rad = math.radians(direction)
            vectors.append({"lat": lat, "lng": lng, "speed": hs, "direction": direction,
                            "u": round(hs * math.sin(rad), 4), "v": round(hs * math.cos(rad), 4),
                            "period": period, "is_valid": True})
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    body = {
        "model": model, "domain": "marine", "layer": layer,
        "run_time": iso(run_time + timedelta(hours=4)) if estimated else iso(run_time),
        "model_run_time": None if estimated else iso(run_time), "model_run_time_status": "conflicting" if estimated else "known",
        "ingested_at": None if estimated else iso(run_time + timedelta(hours=4)), "valid_time": iso(valid_time),
        "is_forecast_authoritative": not estimated, "is_estimated": estimated,
        "estimate_basis": (estimate_basis(valid_time, region_id, run_time) if model == "ICON" else
                           {"type": "gfs_estimated_fallback", "layer": layer}) if estimated else None,
        "coverage": COVERAGE,
        "grid": {"bounds": dict(bounds), "cols": cols, "rows": rows, "vectors": vectors, "diagnostics": {"source": "stored"}},
        "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
        "product_id": filename, "source_variables": ["wave_height"], "freshness_sec": 1800 if estimated else 3600,
        "region_id": region_id, "coverage_mode": "global_tile", "resolution": None,
    }
    body.update(provider_fields(model, estimated, layer))
    return body


def manifest_entry(body, filename, res, bounds_unused=None):
    keys = ("model", "provider", "domain", "layer", "run_time", "model_run_time", "model_run_time_status", "ingested_at",
            "freshness_sec", "is_forecast_authoritative", "coverage", "is_estimated", "estimate_basis", "region_id",
            "coverage_mode", "upstream_provider", "source_dataset")
    entry = {k: body[k] for k in keys}
    entry.update({"valid_time_start": body["valid_time"], "valid_time_end": body["valid_time"], "resolution": res,
                  "filename": filename, "product_id": filename})
    return entry


def build_store(directory, horizon_hours, step_hours, now=None, models=("GFS", "ICON"), layers=("waves",)):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    first = (now - timedelta(hours=now.hour % step_hours, minutes=now.minute, seconds=now.second, microseconds=now.microsecond)
             - timedelta(hours=6))
    run_time = first - timedelta(hours=first.hour % 6)
    entries = []
    n = int(horizon_hours // step_hours) + 3
    for i in range(n):
        vt = first + timedelta(hours=i * step_hours)
        stamp = vt.strftime("%Y%m%dT%H%M%SZ")
        lead = vt - run_time
        for model in models:
            estimated = ((model == "ICON" and lead > timedelta(hours=ICON_NATIVE_HOURS))
                         or (model == "EURO" and lead > timedelta(hours=EURO_NATIVE_HOURS)))
            if "wind" in layers:
                w_est = ((model == "ICON" and lead > timedelta(hours=ICON_WIND_NATIVE_HOURS))
                         or (model == "EURO" and lead > timedelta(hours=EURO_NATIVE_HOURS)))
                for region_id, bounds, res, _stem in TIERS:
                    suffix = "_estimated" if w_est else ""
                    filename = f"{model.lower()}_wind_wind_{region_id}_{stamp}{suffix}.json"
                    body = wind_product_dict(run_time, vt, i * step_hours, filename, region_id, bounds, res, model, w_est)
                    (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
                    entries.append(manifest_entry(body, filename, res))
            for layer in (x for x in layers if x != "wind"):
                if (model == "EURO" and layer == "waves" and not estimated
                        and lead > timedelta(hours=EURO_WAVES_6H_AFTER) and (lead.total_seconds() / 3600) % 6):
                    continue      # the 6-hourly WAM band: no stored frame at this 3-h slot (production fills it server-side)
                for region_id, bounds, res, _stem in tiers_for(model, layer):
                    suffix = "_estimated" if estimated else ""
                    filename = f"{model.lower()}_marine_{layer}_{region_id}_{stamp}{suffix}.json"
                    body = product_dict(run_time, vt, i * step_hours, filename, region_id, bounds, res, model, estimated, layer)
                    (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
                    entries.append(manifest_entry(body, filename, res))
    (directory / "manifest.json").write_text(
        json.dumps({"last_manifest_update": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "products": entries}),
        encoding="utf-8")
    return {"first_valid": first.strftime("%Y-%m-%dT%H:%M:%SZ"), "frames": n, "models": list(models), "layers": list(layers),
            "run_time": run_time.strftime("%Y-%m-%dT%H:%M:%SZ")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, default=4100)
    ap.add_argument("--thin-bounds", choices=["0", "1"], default="0")
    ap.add_argument("--horizon", type=int, default=336)
    ap.add_argument("--step", type=int, default=3)
    ap.add_argument("--models", default="GFS,ICON")
    ap.add_argument("--layers", default="waves", help="comma list of waves,swell_1,swell_2,wind_waves,wind")
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

    meta = build_store(args.dir, args.horizon, args.step, models=tuple(m.strip().upper() for m in args.models.split(',')),
                       layers=tuple(x.strip() for x in args.layers.split(',') if x.strip())) if not (Path(args.dir) / "manifest.json").exists() else {"reused": True}
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
