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
# REGIONAL 0.25-deg TILES (2026-10-19). Production also stores per-region regional_tile products (the pilots' boxes in
# backend/services/weather_pipeline/pilot_regions.py, read from there so the fixture cannot drift from the ingest). Without them
# every frame here carried world bounds and the client's land mask was always REUSED, which hid the per-switch 4096 x 2048 mask
# rebuilds the owner's console showed (`--regions florida_east_coast,us_southeast_midatlantic`, or `flagship` / `all`).
REGIONAL_RES = 0.25


def regional_tiers(region_ids):
    """(region_id, bounds, resolution, stem) for each named pilot region, bounds and resolution taken from pilot_regions."""
    if not region_ids:
        return ()
    sys.path.insert(0, str(BACKEND))
    from services.weather_pipeline.pilot_regions import REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS
    known = {**REGIONAL_CONFIGS, **WORLDWIDE_COASTAL_REGIONS}
    if region_ids == ("all",):
        region_ids = tuple(known)
    elif region_ids == ("flagship",):
        region_ids = tuple(REGIONAL_CONFIGS)
    out = []
    for rid in region_ids:
        if rid not in known:
            raise SystemExit("unknown region %r (pilot_regions has %s)" % (rid, ", ".join(sorted(known))))
        cfg = known[rid]
        bounds = {k: float(cfg[k]) for k in ("west", "south", "east", "north")}
        out.append((rid, bounds, float(cfg.get("resolution", REGIONAL_RES)), "_%s_" % rid))
    return tuple(out)


# The synthetic hurricane: where it truly is at hour h after the first frame (degrees). Tests read this back.
VORTEX_LAT0, VORTEX_LNG0, VORTEX_DLAT, VORTEX_DLNG = 14.0, -106.0, 0.05, -0.08
# The vortex's added height at its eye (m). --vortex-peak raises it (the wave palette A/B uses 11, so the eye crosses 10 m).
VORTEX_PEAK = 6.5
# LAND MASK (2026-10-22, `--land-mask 1`): a synthetic store with NO masked cells hides every serve-time transform that only touches
# masked cells. /grid runs coarse_gulf_fill on EURO/ICON world-span grids and rewrites masked (land) cells with GFS values; #453's
# parity passed over an all-ocean store while real world frames carry ~4,850 masked cells of 15,023. With the mask on, every marine
# product marks these continent boxes as land the way real stored products do (speed 0, is_valid false), so offline parity sees the
# fill. Wind products stay unmasked (wind is valid everywhere).
LAND_MASK = False
LAND_BOXES = ((-125.0, 25.0, -70.0, 60.0), (-75.0, -50.0, -40.0, 5.0), (-10.0, 0.0, 40.0, 60.0), (60.0, 20.0, 130.0, 60.0),
              (115.0, -35.0, 150.0, -20.0))


# WAVE LAKES (2026-10-23, `--wave-lakes 1`; the client's waveLakes.js): #497 makes EURO (ECMWF WAM) carry its own values on the
# Great Lakes, Winnipeg and Victoria while GFS and ICON have none there. With the flag, a node whose cell touches one of these lake
# boxes is LAND (is_valid false) for every model but EURO, and VALID for EURO; Victoria's region (outside the Africa box) is land too.
WAVE_LAKES = False
WAVE_LAKE_BOXES = ((-92.2, 46.4, -84.3, 49.0), (-88.1, 41.6, -84.7, 46.1), (-84.8, 43.0, -79.7, 46.4), (-83.5, 41.4, -78.8, 42.9),
                   (-79.9, 43.2, -76.0, 44.3), (-99.3, 50.3, -96.2, 53.9), (31.5, -3.1, 34.9, 0.5))
WAVE_LAKE_LAND = ((28.0, -12.0, 42.0, 0.0),)   # East Africa around Victoria (the Africa land box stops at the equator)


def on_wave_lake(lat, lng, res):
    h = res / 2.0
    return WAVE_LAKES and any(lng + h >= w and lng - h <= e and lat + h >= s and lat - h <= n for (w, s, e, n) in WAVE_LAKE_BOXES)


def lake_land(lat, lng, res, model):
    """None: the wave-lakes fixture has no say; True / False: this node is land / water under it."""
    if not WAVE_LAKES:
        return None
    if on_wave_lake(lat, lng, res):
        return model != "EURO"
    if any(w <= lng <= e and s <= lat <= n for (w, s, e, n) in WAVE_LAKE_LAND):
        return True
    return None


def is_land(lat, lng, res=2.0):
    # A coarse (10-deg) cell is valid wherever it holds any ocean, so only deep-interior land is masked there; that is what makes the
    # live Gulf fill rewrite thousands of coastal 2-deg land cells (live 2026-10-22, world /grid coarse_fill: EURO 2,465 of 4,689
    # masked cells, ICON 1,708 of 3,788). A coarse tier with the full boxes would leave no donor near any coast and hide the fill.
    m = 6.0 if res >= 5.0 else 0.0
    return LAND_MASK and any(w + m <= lng <= e - m and s + m <= lat <= n - m for (w, s, e, n) in LAND_BOXES)


def vortex_center(hours_since_start):
    return (VORTEX_LAT0 + VORTEX_DLAT * hours_since_start, VORTEX_LNG0 + VORTEX_DLNG * hours_since_start)


def field(lat, lng, h):
    """Significant wave height (m), direction (deg), period (s) at a point; h = hours since the first frame."""
    storm_track = 2.4 * math.exp(-((abs(lat) - 50.0) / 12.0) ** 2)
    swell = 1.1 + 0.6 * math.sin(math.radians(lng * 2.0)) * math.cos(math.radians(lat)) + storm_track
    clat, clng = vortex_center(h)
    dlat, dlng = lat - clat, (lng - clng + 180.0) % 360.0 - 180.0
    r2 = dlat * dlat + (dlng * math.cos(math.radians(lat))) ** 2
    vort = VORTEX_PEAK * math.exp(-r2 / (2.0 * 3.2 ** 2))
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


def tiers_for(model, layer, regions=()):
    """Stored tiers per (model, layer), mirroring the production manifest (read 2026-10-19): GFS has every layer at
    global_mid + global_coarse; ICON has no swell_2 product (the client blends GFS/EURO); EURO waves (ECMWF WAM) has
    both tiers while swell_1 / swell_2 / wind_waves are Copernicus CMEMS at global_coarse ONLY. Regional tiles (when asked
    for) follow the same per-layer availability: every GFS layer, ICON without swell_2, EURO waves only."""
    if model == "ICON" and layer == "swell_2":
        return ()
    if model == "EURO" and layer != "waves":
        return tuple(t for t in TIERS if t[0] == "global_coarse")
    return TIERS + tuple(regions)


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
    # The normalizer's own rounding (normalizer.py): speed 4 dp, direction 2 dp, u / v from the UNROUNDED values at 4 dp (it was
    # 3 dp / 0.1 deg here, which a static wind frame's parity gate rightly refuses: 2,174 of 15,023 nodes, 2026-10-22).
    return round(speed, 4), round(direction, 2), round(u_kn, 4), round(v_kn, 4)


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
            ll = lake_land(lat, lng, res, model)
            if ll is True or (ll is None and is_land(lat, lng, res)):
                vectors.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": None,
                                "is_valid": False})
                continue
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
        "coverage": COVERAGE if bounds["east"] - bounds["west"] >= 350.0 else dict(bounds),
        "grid": {"bounds": dict(bounds), "cols": cols, "rows": rows, "vectors": vectors, "diagnostics": {"source": "stored"}},
        "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
        "product_id": filename, "source_variables": ["wave_height"], "freshness_sec": 1800 if estimated else 3600,
        "region_id": region_id, "resolution": None,
        "coverage_mode": "global_tile" if bounds["east"] - bounds["west"] >= 350.0 else "regional_tile",
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


def synthetic_upstream_points(lats, lons, first, forecast_days, layer_keys=True):
    """Open-Meteo-shaped raw points (one dict per coordinate, hourly arrays from the store's first frame) for the DYNAMIC
    viewport lane. Production answers a narrow viewport (< 15 deg) by fetching THAT viewport from Open-Meteo at an adaptive
    resolution (viewport_service.fetch_viewport_grid_upstream), so every zoom / pan commits a grid with its own bounds. Offline
    that fetch is blocked and the resolver fell back to a 2-deg clip the client short-circuits, which hid every regional mask
    rebuild. The same synthetic field() answers it here, so the lane's own normalizer, cache keys and bounds run unchanged."""
    hours = max(24, int(forecast_days) * 24)
    times = [(first + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(hours)]
    units = {k: u for base in ("wave", "swell_wave", "wind_wave", "secondary_swell_wave")
             for k, u in ((base + "_height", "m"), (base + "_direction", "deg"), (base + "_period", "s"))}
    out = []
    for lat, lng in zip(lats, lons):
        hourly = {"time": times}
        for key in units:
            hourly[key] = []
        for h in range(hours):
            hs, direction, period = field(lat, lng, h)
            for prefix, layer in (("wave", "waves"), ("swell_wave", "swell_1"), ("wind_wave", "wind_waves"),
                                  ("secondary_swell_wave", "swell_2")):
                lh, ld, lp = layer_field(layer, hs, direction, period, lat, lng, h)
                hourly[prefix + "_height"].append(lh)
                hourly[prefix + "_direction"].append(ld)
                hourly[prefix + "_period"].append(lp)
        out.append({"latitude": lat, "longitude": lng, "hourly_units": dict(units), "hourly": hourly})
    return out


# REAL WIND (2026-10-22, the wind instant scrub): `--real-wind <dir>` replaces the synthetic GFS wind tiers (global_mid and
# global_coarse) with a REAL NOAA GFS run built by the production fetcher + normalizer (<dir>/products: the product files and
# manifest_entries.json), and `--real-wind-lane <file>` installs a real HRRR lane object (wind_lane.Lane) in the server, as the
# box loads one from L2, so /grid blends HRRR into GFS wind exactly as live. With `--dynamic 1` the dynamic wind lane (the
# close-zoom sharpen, Open-Meteo upstream in production) is answered from the SAME real run, bilinear in space and linear in time
# onto the asked lattice: a lab stand-in for a finer product (it adds no detail), so fine overlays arrive as they do live.
REAL_WIND = {}


def real_wind_products(real_dir):
    """[(filename, body, resolution)] for the real GFS wind tiers in `real_dir`/products."""
    root = Path(real_dir) / "products"
    entries = json.loads((root / "manifest_entries.json").read_text(encoding="utf-8"))
    out = []
    for e in entries:
        if e.get("model") != "GFS" or e.get("domain") != "wind":
            continue
        body = json.loads((root / e["filename"]).read_text(encoding="utf-8"))
        out.append((e["filename"], body, e.get("resolution")))
    return out


def load_real_wind_field(store_dir):
    """The real global_mid run as numpy arrays (times, U, V on the 2-deg lattice), for the dynamic wind lane stand-in."""
    import numpy as np
    files = sorted(Path(store_dir).glob("gfs_wind_wind_global_mid_*.json"))
    times, us, vs = [], [], []
    lat0 = None
    for f in files:
        body = json.loads(f.read_text(encoding="utf-8"))
        g = body["grid"]
        cols, rows = g["cols"], g["rows"]
        us.append(np.array([x["u"] for x in g["vectors"]], dtype=float).reshape(rows, cols))
        vs.append(np.array([x["v"] for x in g["vectors"]], dtype=float).reshape(rows, cols))
        lat0 = min(x["lat"] for x in g["vectors"][:cols])
        times.append(datetime.strptime(body["valid_time"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    if files:
        REAL_WIND.update(times=np.array(times), U=np.stack(us), V=np.stack(vs), lat0=float(lat0), lon0=-180.0, res=RES)


def real_wind_points(lats, lons, first, forecast_days):
    """Open-Meteo-shaped wind points (knots, FROM direction) sampled from the real run."""
    import numpy as np
    W = REAL_WIND
    hours = max(24, int(forecast_days) * 24)
    t = np.array([(first + timedelta(hours=h)).timestamp() for h in range(hours)])
    k = np.clip(np.searchsorted(W["times"], t) - 1, 0, len(W["times"]) - 2)
    ft = np.clip((t - W["times"][k]) / (W["times"][k + 1] - W["times"][k]), 0.0, 1.0)
    lat = np.asarray(lats, dtype=float)
    lon = ((np.asarray(lons, dtype=float) + 180.0) % 360.0) - 180.0
    nr, nc = W["U"].shape[1], W["U"].shape[2]
    fi = np.clip((lat - W["lat0"]) / W["res"], 0, nr - 1.000001)
    fj = np.clip((lon - W["lon0"]) / W["res"], 0, nc - 1.000001)
    i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
    di, dj = fi - i0, fj - j0

    def sample(A):            # (frames, n): bilinear at every point for every frame
        return (A[:, i0, j0] * (1 - di) * (1 - dj) + A[:, i0 + 1, j0] * di * (1 - dj)
                + A[:, i0, j0 + 1] * (1 - di) * dj + A[:, i0 + 1, j0 + 1] * di * dj)
    Us, Vs = sample(W["U"]), sample(W["V"])
    u = Us[k] * (1 - ft[:, None]) + Us[k + 1] * ft[:, None]
    v = Vs[k] * (1 - ft[:, None]) + Vs[k + 1] * ft[:, None]
    spd = np.hypot(u, v)
    drc = (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0
    times = [(first + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(hours)]
    units = {"time": "iso8601", "wind_speed_10m": "kn", "wind_direction_10m": "degree"}
    return [{"latitude": float(a), "longitude": float(b), "hourly_units": dict(units),
             "hourly": {"time": times, "wind_speed_10m": [round(float(x), 2) for x in spd[:, n]],
                        "wind_direction_10m": [round(float(x)) for x in drc[:, n]]}} for n, (a, b) in enumerate(zip(lats, lons))]


def install_synthetic_upstream(first):
    """Route the dynamic lane's marine fetches (Open-Meteo for GFS / ICON, Copernicus for EURO) to synthetic_upstream_points.
    Wind and anything else keep failing fast on the blocked name lookup, as before."""
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
    om_fetch = OpenMeteoProvider.fetch_grid

    async def om_fetch_grid(self, model, domain, layer, bbox, resolution=0.25, forecast_days=2, precomputed_coords=None, **kw):
        if str(domain).lower() == "wind" and REAL_WIND and str(model).upper() == "GFS":
            lats, lons = precomputed_coords or OpenMeteoProvider.generate_grid_coords(bbox, resolution)
            wf = datetime.fromtimestamp(float(REAL_WIND["times"][0]), timezone.utc)
            return real_wind_points(lats, lons, wf, min(int(forecast_days or 2), 16))
        if str(domain).lower() != "marine":
            return await om_fetch(self, model, domain, layer, bbox, resolution, forecast_days, precomputed_coords, **kw)
        lats, lons = precomputed_coords or OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        return synthetic_upstream_points(lats, lons, first, min(forecast_days, 7 if str(model).upper() != "GFS" else 16))

    async def cop_fetch_grid(self, layer, bbox, resolution=0.25, forecast_days=3, precomputed_coords=None, valid_time=None):
        lats, lons = precomputed_coords or OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        return synthetic_upstream_points(lats, lons, first, forecast_days)
    OpenMeteoProvider.fetch_grid = om_fetch_grid
    CopernicusProvider.fetch_grid = cop_fetch_grid


# STALE WINDOW (2026-10-21, the client's SWR_BACKOFF ladder): production answers a viewport whose fine grid is still being built
# with an instant coarse preview labelled stale ("swr_revalidation_pending": grid_resolver Step 3.5 / 3.7, mid_res_tier), and only
# the CLIENT's re-ask pulls the sharpened grid once the background revalidation lands. The synthetic store never answered stale, so
# that loop could not be replayed. With a window armed, every matching /grid reply (never a /grid_series frame) is the resolver's
# own product made stale and coarse (every `stride`-th latitude and longitude, so the fresh reply is told apart by its cols) until
# the window ends; then the same request is answered fresh. Arm it per step over HTTP (the lab does), or from the command line:
#   GET /__lab/stale?seconds=N&scope=world|regional|any&model=GFS&layer=waves&stride=3   (re)arms NOW for N s and clears the log
#   GET /__lab/stale/status                                                              the window and every matching /grid
#   --stale-seconds N [--stale-scope ... --stale-model ... --stale-layer ... --stale-stride ...]   arms at the first matching /grid
# scope: world = a /grid whose bbox spans >= 340 deg of longitude (or no bbox), regional = narrower, any = both.
STALE = {"armed_at": None, "until": None, "seconds": 0.0, "scope": "any", "model": None, "layer": None, "stride": 3,
         "arm_on_first": False, "log": []}


def _lng_span(bbox):
    try:
        w, _s, e, _n = (float(x) for x in str(bbox).split(","))
    except (TypeError, ValueError):
        return 360.0
    return e - w if e > w else e + 360.0 - w


def stale_window_matches(model, domain, layer, bbox, cfg=None):
    """Does a /grid request fall under the configured window's filter (marine only)?"""
    cfg = cfg or STALE
    if str(domain).lower() != "marine" or not cfg["seconds"]:
        return False
    if cfg["model"] and str(model).upper() != cfg["model"].upper():
        return False
    if cfg["layer"] and str(layer) != cfg["layer"]:
        return False
    world = bbox is None or _lng_span(bbox) >= 340.0
    return cfg["scope"] == "any" or (cfg["scope"] == "world") == world


def coarsen_stale(product, stride):
    """A copy of `product` as production's SWR preview looks: stale, staleReason swr_revalidation_pending, on every `stride`-th
    latitude and longitude of the served lattice (bounds from the kept cells). None when there is no grid to coarsen."""
    grid = getattr(product, "grid", None)
    vectors = list(getattr(grid, "vectors", None) or [])
    if not vectors:
        return None
    keep_lat = set(sorted({v.lat for v in vectors})[::stride])
    keep_lng = set(sorted({v.lng for v in vectors})[::stride])
    kept = [v for v in vectors if v.lat in keep_lat and v.lng in keep_lng]
    bounds = type(grid.bounds)(west=min(keep_lng), south=min(keep_lat), east=max(keep_lng), north=max(keep_lat))
    new_grid = grid.model_copy(update={
        "vectors": kept, "cols": len(keep_lng), "rows": len(keep_lat), "bounds": bounds,
        "diagnostics": {**(grid.diagnostics or {}), "source": "lab_stale_window", "lab_stride": stride}})
    return product.model_copy(update={
        "grid": new_grid, "stale": True, "staleReason": "swr_revalidation_pending", "cache_hit": "lab_stale_window",
        "served_bbox": f"{bounds.west:.4f},{bounds.south:.4f},{bounds.east:.4f},{bounds.north:.4f}"})


def arm_stale_window(seconds, scope="any", model=None, layer=None, stride=3, now=None):
    """(Re)arm the window from `now` (epoch s) for `seconds`, with an empty log. Returns the state."""
    import time
    now = time.time() if now is None else now
    if scope not in ("world", "regional", "any"):
        raise ValueError("scope must be world, regional or any")
    STALE.update({"armed_at": now, "until": now + float(seconds), "seconds": float(seconds), "scope": scope,
                  "model": model or None, "layer": layer or None, "stride": max(2, int(stride)), "arm_on_first": False,
                  "log": []})
    return stale_status()


def stale_status():
    return {k: STALE[k] for k in ("armed_at", "until", "seconds", "scope", "model", "layer", "stride", "arm_on_first")} | {
        "log": list(STALE["log"])}


def install_stale_window(app):
    """Wrap grid_resolver.resolve_grid (the /grid route imports it per call) and add the /__lab/stale control routes."""
    import time
    from fastapi.responses import JSONResponse
    from services.weather_pipeline import grid_resolver
    original = grid_resolver.resolve_grid

    async def resolve_grid(store, viewport_service, **kw):
        t_in = time.time()
        product = await original(store, viewport_service, **kw)
        request = kw.get("request")
        path = getattr(getattr(request, "url", None), "path", "") or ""
        if not path.endswith("/weather/grid") or not stale_window_matches(kw.get("model"), kw.get("domain"), kw.get("layer"),
                                                                          kw.get("bbox")):
            return product
        if STALE["arm_on_first"]:
            arm_stale_window(STALE["seconds"], STALE["scope"], STALE["model"], STALE["layer"], STALE["stride"], now=t_in)
        cols = getattr(getattr(product, "grid", None), "cols", None)
        stale = STALE["until"] is not None and t_in < STALE["until"]
        served = coarsen_stale(product, STALE["stride"]) if stale else None
        STALE["log"].append({"t_in_ms": round(t_in * 1000), "t_out_ms": round(time.time() * 1000), "stale": served is not None,
                             "valid_time": kw.get("valid_time"), "bbox": kw.get("bbox"), "fresh_cols": cols,
                             "served_cols": served.grid.cols if served is not None else cols,
                             "resolver_stale": bool(getattr(product, "stale", False))})
        return served if served is not None else product
    grid_resolver.resolve_grid = resolve_grid

    async def lab_stale(seconds: float = 0.0, scope: str = "any", model: str = "", layer: str = "", stride: int = 3):
        try:
            return JSONResponse(arm_stale_window(seconds, scope, model, layer, stride))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def lab_stale_status():
        return JSONResponse(stale_status())
    app.add_api_route("/__lab/stale", lab_stale, methods=["GET"])
    app.add_api_route("/__lab/stale/status", lab_stale_status, methods=["GET"])


# REAL FRAMES (2026-10-22, the mid-zoom instant scrub): `--real-frames <dir>` replaces the synthetic GFS waves global_mid
# products with the REAL published field, decoded from a local copy of the public weather-frames bucket (v1/latest.json, the run
# index it points at, and every frame the index lists). /grid and /grid_series then clip the same numbers the CDN frames carry,
# so a frame cropped in the browser can be compared node by node with the resolver's own clip, and the probe's product ids are
# the real ones. Values are written exactly as the client codec rebuilds them (staticFrameCodec.buildVectors: height 4 dp,
# direction and period 2 dp, confidence 4 dp, u = -h sin d and v = -h cos d at 4 dp for uv convention 0). The 10-deg
# global_coarse is every 5th node of the same field (a lab stand-in, not production's block mean; diagnostics say so).
# Models and layers other than GFS waves stay synthetic.
def _real_vectors(dec, stride=1, north_cap=None):
    """The client codec's node values (staticFrameCodec.buildVectors) for a decoded RSWF frame, every `stride`-th node."""
    cols, rows = dec["cols"], dec["rows"]
    west, south, east, north = dec["bounds"]
    sign = 1.0 if dec["uv_convention"] == 1 else -1.0
    H, D, P, C = (dec["fields"].get(k) for k in (0, 1, 2, 3))
    r2, r4 = (lambda x: round(x + 0.0, 2)), (lambda x: round(x + 0.0, 4))
    vectors = []
    for r in range(0, rows, stride):
        lat = round(south + r * (north - south) / (rows - 1), 6)
        if north_cap is not None and lat > north_cap:
            continue
        for c in range(0, cols, stride):
            i = r * cols + c
            lng = round(west + c * (east - west) / (cols - 1), 6)
            h = H[i]
            d = r2(D[i]) if D and D[i] is not None else 0.0
            p = r2(P[i]) if P and P[i] is not None else None
            q = r4(C[i]) if C and C[i] is not None else None
            if h is None:
                vectors.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": d, "u": 0.0, "v": 0.0, "period": p,
                                "is_valid": False, "dir_confidence": q})
                continue
            s = r4(h)
            rad = math.radians(d)
            vectors.append({"lat": lat, "lng": lng, "speed": s, "direction": d, "u": r4(sign * s * math.sin(rad)),
                            "v": r4(sign * s * math.cos(rad)), "period": p, "is_valid": True, "dir_confidence": q})
    return vectors


def real_regional_products(frames_dir, region_ids):
    """[(region_id, filename, body, resolution)] for every GFS waves REGIONAL set in `frames_dir`'s latest.json whose bundle is on disk
    and whose region is in `region_ids` (2026-10-24, the regional z7-9 instant scrub): each frame is the REAL stored tile, sliced from
    the published bundle (a gzip member, byte for byte the per-frame object) and written as the product the resolver's Step 3 clips,
    so a bundle frame cropped in the browser can be compared node by node with the resolver's own tile clip."""
    sys.path.insert(0, str(BACKEND))
    from services.frame_binary import decode_frame
    root = Path(frames_dir)
    latest = json.loads((root / "v1" / "latest.json").read_text(encoding="utf-8"))
    out = []
    for key, entry in sorted(latest.get("sets", {}).items()):
        parts = key.split("/")
        if len(parts) != 4 or parts[:3] != ["GFS", "marine", "waves"] or parts[3].startswith("global_") or parts[3] not in region_ids:
            continue
        if not entry.get("bundle") or not (root / entry["bundle"]["path"]).exists() or not (root / entry["index"]).exists():
            continue
        index = json.loads((root / entry["index"]).read_text(encoding="utf-8"))
        bundle = (root / entry["bundle"]["path"]).read_bytes()
        common = index.get("common_meta") or {}
        cov = index["grid"]["bounds"]
        for fr in index["frames"]:
            if fr.get("offset") is None:
                continue
            dec = decode_frame(bundle[fr["offset"]:fr["offset"] + fr["length"]])
            meta = {**common, **(fr.get("meta") or {})}
            vectors = _real_vectors(dec)
            lats = sorted({v["lat"] for v in vectors}); lngs = sorted({v["lng"] for v in vectors})
            filename = meta["product_id"]
            body = {
                "model": "GFS", "domain": "marine", "layer": "waves", "run_time": meta.get("run_time"),
                "model_run_time": meta.get("model_run_time"), "model_run_time_status": meta.get("model_run_time_status") or "known",
                "ingested_at": meta.get("ingested_at"), "valid_time": fr["valid_time"],
                "is_forecast_authoritative": bool(meta.get("is_forecast_authoritative", True)), "is_estimated": bool(fr.get("is_estimated")),
                "estimate_basis": meta.get("estimate_basis"), "coverage": dict(cov),
                "grid": {"bounds": {"west": lngs[0], "south": lats[0], "east": lngs[-1], "north": lats[-1]}, "cols": len(lngs),
                         "rows": len(lats), "vectors": vectors, "diagnostics": {"source": "stored"}},
                "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "product_id": filename,
                "source_variables": meta.get("source_variables") or ["wave_height"], "freshness_sec": meta.get("freshness_sec") or 3600,
                "region_id": parts[3], "resolution": None, "coverage_mode": "regional_tile",
                "provider": meta.get("provider") or "open-meteo", "upstream_provider": meta.get("upstream_provider") or "noaa",
                "source_dataset": meta.get("source_dataset") or "ncep_gfswave025",
            }
            out.append((parts[3], filename, body, REGIONAL_RES))
    return out


def real_frame_products(frames_dir):
    """[(filename, body, resolution)] for the GFS waves global_mid run in `frames_dir` and its derived global_coarse."""
    sys.path.insert(0, str(BACKEND))
    from services.frame_binary import decode_frame
    root = Path(frames_dir)
    latest = json.loads((root / "v1" / "latest.json").read_text(encoding="utf-8"))
    index = json.loads((root / latest["sets"]["GFS/marine/waves/global_mid"]["index"]).read_text(encoding="utf-8"))
    common = index.get("common_meta") or {}
    r2, r4 = (lambda x: round(x + 0.0, 2)), (lambda x: round(x + 0.0, 4))
    out = []
    for fr in index["frames"]:
        if not fr.get("path"):
            continue
        dec = decode_frame((root / fr["path"]).read_bytes())
        cols, rows = dec["cols"], dec["rows"]
        west, south, east, north = dec["bounds"]
        sign = 1.0 if dec["uv_convention"] == 1 else -1.0
        H, D, P, C = (dec["fields"].get(k) for k in (0, 1, 2, 3))
        meta = {**common, **(fr.get("meta") or {})}
        for region_id, stride, res in (("global_mid", 1, RES), ("global_coarse", 5, COARSE_RES)):
            vectors = []
            for r in range(0, rows, stride):
                lat = round(south + r * (north - south) / (rows - 1), 6)
                if region_id == "global_coarse" and lat > COARSE["north"]:
                    continue
                for c in range(0, cols, stride):
                    i = r * cols + c
                    lng = round(west + c * (east - west) / (cols - 1), 6)
                    h = H[i]
                    d = r2(D[i]) if D and D[i] is not None else 0.0
                    p = r2(P[i]) if P and P[i] is not None else None
                    q = r4(C[i]) if C and C[i] is not None else None
                    if h is None:
                        vectors.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": d, "u": 0.0, "v": 0.0, "period": p,
                                        "is_valid": False, "dir_confidence": q})
                        continue
                    s = r4(h)
                    rad = math.radians(d)
                    vectors.append({"lat": lat, "lng": lng, "speed": s, "direction": d, "u": r4(sign * s * math.sin(rad)),
                                    "v": r4(sign * s * math.cos(rad)), "period": p, "is_valid": True, "dir_confidence": q})
            lats = sorted({v["lat"] for v in vectors})
            lngs = sorted({v["lng"] for v in vectors})
            bounds = {"west": lngs[0], "south": lats[0], "east": lngs[-1], "north": lats[-1]}
            stamp = fr["valid_time"].replace("-", "").replace(":", "")
            filename = (meta.get("product_id") if region_id == "global_mid"
                        else f"gfs_marine_waves_global_coarse_{stamp}.json")
            body = {
                "model": "GFS", "domain": "marine", "layer": "waves", "run_time": meta.get("run_time"),
                "model_run_time": meta.get("model_run_time"), "model_run_time_status": meta.get("model_run_time_status") or "known",
                "ingested_at": meta.get("ingested_at"), "valid_time": fr["valid_time"],
                "is_forecast_authoritative": bool(meta.get("is_forecast_authoritative", True)),
                "is_estimated": bool(fr.get("is_estimated")), "estimate_basis": meta.get("estimate_basis"),
                "coverage": COVERAGE,
                "grid": {"bounds": bounds, "cols": len(lngs), "rows": len(lats), "vectors": vectors,
                         "diagnostics": {"source": "stored" if region_id == "global_mid" else "lab_every_5th_real_node"}},
                "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "product_id": filename,
                "source_variables": meta.get("source_variables") or ["wave_height"], "freshness_sec": meta.get("freshness_sec") or 3600,
                "region_id": region_id, "resolution": None, "coverage_mode": "global_tile",
                "provider": meta.get("provider") or "open-meteo", "upstream_provider": meta.get("upstream_provider") or "noaa",
                "source_dataset": meta.get("source_dataset") or "ncep_gfswave025",
            }
            out.append((filename, body, res))
    return out, index


def build_store(directory, horizon_hours, step_hours, now=None, models=("GFS", "ICON"), layers=("waves",), regions=(),
                real_frames=None, real_wind=None):
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
                for region_id, bounds, res, _stem in tiers_for(model, layer, regions):
                    suffix = "_estimated" if estimated else ""
                    filename = f"{model.lower()}_marine_{layer}_{region_id}_{stamp}{suffix}.json"
                    body = product_dict(run_time, vt, i * step_hours, filename, region_id, bounds, res, model, estimated, layer)
                    (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
                    entries.append(manifest_entry(body, filename, res))
    real = None
    if real_frames:
        # The real GFS waves run REPLACES the synthetic GFS waves world tiers (regional tiles, other models and layers stay).
        products, index = real_frame_products(real_frames)
        drop = {"global_mid", "global_coarse"}
        for e in [e for e in entries if e["model"] == "GFS" and e["layer"] == "waves" and e["region_id"] in drop]:
            entries.remove(e)
            (directory / e["filename"]).unlink(missing_ok=True)
        for filename, body, res in products:
            (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
            entries.append(manifest_entry(body, filename, res))
        real = {"index": index.get("path"), "run": index.get("run"), "frames": sum(1 for f in index["frames"] if f.get("path"))}
        # The REAL stored tiles of the regional sets the copy carries a bundle for (only regions the store was asked for: --regions).
        asked = {r[0] for r in regions}
        reg = real_regional_products(real_frames, asked)
        for rid in sorted({r[0] for r in reg}):
            for e in [e for e in entries if e["model"] == "GFS" and e["layer"] == "waves" and e["region_id"] == rid]:
                entries.remove(e)
                (directory / e["filename"]).unlink(missing_ok=True)
        for rid, filename, body, res in reg:
            (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
            entries.append(manifest_entry(body, filename, res))
        real["regional"] = sorted({r[0] for r in reg})
    if real_wind:
        # The real GFS wind run REPLACES the synthetic GFS wind world tiers (the other models stay synthetic).
        drop = [e for e in entries if e["model"] == "GFS" and e["domain"] == "wind" and e["region_id"] in ("global_mid", "global_coarse")]
        for e in drop:
            entries.remove(e)
            (directory / e["filename"]).unlink(missing_ok=True)
        rw = real_wind_products(real_wind)
        for filename, body, res in rw:
            (directory / filename).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
            entries.append(manifest_entry(body, filename, res))
        real = dict(real or {}, wind_products=len(rw))
    (directory / "store_meta.json").write_text(json.dumps({"first_valid": first.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                           "real_frames": real, "land_mask": LAND_MASK}), encoding="utf-8")
    (directory / "manifest.json").write_text(
        json.dumps({"last_manifest_update": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "products": entries}),
        encoding="utf-8")
    return {"first_valid": first.strftime("%Y-%m-%dT%H:%M:%SZ"), "frames": n, "models": list(models), "layers": list(layers),
            "regions": [r[0] for r in regions], "run_time": run_time.strftime("%Y-%m-%dT%H:%M:%SZ"), "real_frames": real}


CHILD_SITECUSTOMIZE = '''"""Generated by serve_synthetic.py: a child process of the offline harness cannot resolve a non-local host."""
import socket
_real_getaddrinfo = socket.getaddrinfo


def _local_only_getaddrinfo(host, *a, **k):
    if host in (None, "", "127.0.0.1", "localhost", "::1"):
        return _real_getaddrinfo(host, *a, **k)
    raise socket.gaierror(socket.EAI_NONAME, "offline harness child: outbound name lookup blocked (%s)" % (host,))


socket.getaddrinfo = _local_only_getaddrinfo
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, default=4100)
    ap.add_argument("--thin-bounds", choices=["0", "1"], default="0")
    ap.add_argument("--horizon", type=int, default=336)
    ap.add_argument("--step", type=int, default=3)
    ap.add_argument("--models", default="GFS,ICON")
    ap.add_argument("--layers", default="waves", help="comma list of waves,swell_1,swell_2,wind_waves,wind")
    ap.add_argument("--regions", default="", help="comma list of pilot_regions ids (0.25-deg regional tiles), or flagship / all")
    ap.add_argument("--dynamic", choices=["0", "1"], default="0",
                    help="1 = answer the dynamic viewport lane (narrow zooms) with the synthetic field instead of failing it")
    ap.add_argument("--vortex-peak", type=float, default=6.5, help="the vortex's added height at its eye, m (6.5: an ~8 m storm)")
    ap.add_argument("--stale-seconds", type=float, default=0.0,
                    help="answer matching marine /grid requests STALE (coarse, swr_revalidation_pending) for N s from the first one, "
                         "then fresh; the lab arms its own windows over GET /__lab/stale (see STALE above)")
    ap.add_argument("--stale-scope", choices=["world", "regional", "any"], default="any")
    ap.add_argument("--stale-model", default="", help="only this model (default every model)")
    ap.add_argument("--stale-layer", default="", help="only this layer (default every layer)")
    ap.add_argument("--stale-stride", type=int, default=3, help="the stale grid keeps every Nth latitude and longitude")
    ap.add_argument("--real-frames", default="",
                    help="a local copy of the weather-frames bucket: GFS waves global_mid (and its coarse stand-in) become the real "
                         "published run (see REAL FRAMES above)")
    ap.add_argument("--real-wind", default="", help="a real GFS wind run (<dir>/products; see REAL WIND above)")
    ap.add_argument("--real-wind-lane", default="", help="a real HRRR wind lane object JSON, installed as the box's lane")
    ap.add_argument("--land-mask", choices=["0", "1"], default="0",
                    help="mark continent boxes as land (is_valid false, speed 0) in every marine product, as real stored products "
                         "carry it; serve-time transforms of masked cells (the EURO/ICON world Gulf fill) then run offline")
    ap.add_argument("--wave-lakes", choices=["0", "1"], default="0",
                    help="EURO carries the Great Lakes, Winnipeg and Victoria (#497); every other model has them as land (WAVE LAKES above)")
    ap.add_argument("--build-only", action="store_true")
    args = ap.parse_args()
    global VORTEX_PEAK, LAND_MASK, WAVE_LAKES
    VORTEX_PEAK = args.vortex_peak
    LAND_MASK = args.land_mask == "1"
    WAVE_LAKES = args.wave_lakes == "1"

    # NOT NODE_ENV=test / TESTING=1: grid_resolver skips the mid-res tier in a test environment, and the mid tier is the very
    # path under study. L2 is off because no Supabase variable is set (store._get_supabase_storage returns None without a URL
    # and key), so nothing can reach a real bucket or database from this process.
    for var in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
                "GITHUB_RUN_ID", "NODE_ENV", "TESTING", "PYTEST_CURRENT_TEST"):
        os.environ.pop(var, None)
    os.environ["SERIES_THIN_NODE_BOUNDS"] = args.thin_bounds
    # NO SURF-SPOT TABLE OFFLINE (2026-10-21, CI moved onto this server): /spot-ratings' precomputed read needs a bucket and its
    # live path queries the spots table, so here it answered 500, which the zoomlab verdict counts as a transport gap (REFUSE).
    # The route's own kill switch answers 200 with no spots (source "disabled"). Export SPOT_RATINGS_V2=1 to get the 500 back.
    os.environ.setdefault("SPOT_RATINGS_V2", "0")
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
    # ...AND IN EVERY CHILD PROCESS (2026-10-21). The backend runs its provider fetchers as child Python processes
    # (services/_fetch_common.run_fetcher_subprocess, the Copernicus and NOAA services), and the patch above lives in THIS
    # process only. Measured: the dynamic wind lane spawned the DWD ICON wind fetcher from here; locally it died on a missing
    # GRIB decoder, but with the full requirements (CI) it would have downloaded from DWD. Each child now imports a
    # generated sitecustomize from PYTHONPATH that installs the same block before any of its own code runs.
    import tempfile
    site_dir = Path(tempfile.mkdtemp(prefix="offline_harness_site_"))
    (site_dir / "sitecustomize.py").write_text(CHILD_SITECUSTOMIZE, encoding="utf-8")
    os.environ["PYTHONPATH"] = os.pathsep.join([str(site_dir)] + ([os.environ["PYTHONPATH"]] if os.environ.get("PYTHONPATH") else []))
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)

    meta = {"reused": True}
    if not (Path(args.dir) / "manifest.json").exists():
        meta = build_store(args.dir, args.horizon, args.step, models=tuple(m.strip().upper() for m in args.models.split(',')),
                           layers=tuple(x.strip() for x in args.layers.split(',') if x.strip()),
                           regions=regional_tiers(tuple(x.strip() for x in args.regions.split(',') if x.strip())),
                           real_frames=args.real_frames or None, real_wind=args.real_wind or None)
    print(json.dumps({"store": meta, "thin_bounds": args.thin_bounds}), flush=True)
    if args.build_only:
        return

    from server import app                                   # noqa: E402
    from routes import weather                               # noqa: E402
    from services.weather_pipeline.store import ProductStore  # noqa: E402
    weather.store = ProductStore(cache_dir=Path(args.dir))
    if args.dynamic == "1":
        first = datetime.strptime(json.loads((Path(args.dir) / "store_meta.json").read_text(encoding="utf-8"))["first_valid"],
                                  "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        install_synthetic_upstream(first)
    if args.real_wind_lane:
        from services.weather_pipeline import wind_lane as _wl
        _obj = json.loads(Path(args.real_wind_lane).read_text(encoding="utf-8"))
        _wl.install(_wl.Lane(_obj, key="wind_lane/" + Path(args.real_wind_lane).name))
        print(json.dumps({"wind_lane": {"cycle": _obj.get("cycle"), "horizon": _obj.get("horizon")}}), flush=True)
    if args.dynamic == "1" and args.real_wind:
        load_real_wind_field(args.dir)
    install_stale_window(app)
    if args.stale_seconds > 0:
        STALE.update({"seconds": args.stale_seconds, "scope": args.stale_scope, "model": args.stale_model or None,
                      "layer": args.stale_layer or None, "stride": max(2, args.stale_stride), "arm_on_first": True})
    import uvicorn                                           # noqa: E402
    uvicorn.run(app, host="127.0.0.1", port=args.port, lifespan="off", log_level="warning")


if __name__ == "__main__":
    main()
