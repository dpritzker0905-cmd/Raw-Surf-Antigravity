"""ens_wind_extension.py - the HARD hand-off of ICON 180->336 h and EURO 240->336 h wind to the ECMWF ENS member mean.

Owner 2026-11-15 15:19 EST "Looping is unacceptable. We need real science."; 16:14 EST "Yes to all, hard hand-off".
Gate (pre-registered): docs/weather-program/log/2026-11-15-wind-long-range.md. Label: "Days 8-14: ECMWF ensemble mean
(estimate)", basis `ens_mean_extension`. No taper, no per-cell offset at the seam (the owner ruled; the gate measures
the jump). It replaces the EURO GFS clones and the ICON loop whenever a fresh reduced ENS field covers the whole
tail; otherwise today's tail serves unchanged (EURO: GFS clones; ICON: the legacy loop). Owner 2026-11-15 19:27 EST:
"I dont want icon wind past 7.5 days switched to gfs, we need a scientific estimation" - so ICON never falls to GFS.

Producer: scripts/ens_wind_extension_ci.py in its OWN workflow (wind-ens-extension.yml; not the pilots job) reads the
51 members on a GitHub runner and writes ONE reduced file to the bucket: `ens_wind/latest.npz` (+ `.json`). This
module only READS it (the ingest runner), samples the 1-degree fields at the coarse points, interpolates 6 h -> 3 h
inside the ENS run, and saves through the same normalize_and_save_loop as every wind tail. Never on Render.
Kill switch: ENS_WIND_EXTENSION=0 (GUARDED).
"""
import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

import numpy as np

from services.weather_pipeline import ens_wind_core as ec

logger = logging.getLogger(__name__)

KEY_NPZ = "ens_wind/latest.npz"
KEY_META = "ens_wind/latest.json"
FIELDS = ("u", "v", "speed", "gust", "gust_p90", "spread")     # m/s; gust = member median of 10fg, p90 = risk cue
GUST_LABEL = "max gust in the 6 h to this time"
GRID_1DEG = {"ni": 360, "nj": 181, "lat_south": -90.0, "lat_north": 90.0, "lon_west": 0.0, "dlat": 1.0, "dlon": 1.0}
MAX_ENS_AGE_H = 48          # amendment 3 (director 2026-11-16): a lagged ENS run up to 48 h old still serves
OLDER_RUN_AFTER_H = 24      # older than this, the label says so
CEILING_H = 336
STEP_H = 3


def ens_extension_on() -> bool:
    from services import runtime_flags  # env > manifest > code default; never read around it (test_runtime_flags)
    return runtime_flags.on("ENS_WIND_EXTENSION")


# ---------------------------------------------------------------------------------------------- reduced-field file
def pack(run: datetime, steps: List[int], fields_by_step: dict, speed_factor_by_bin: Optional[dict] = None) -> Tuple[bytes, dict]:
    """(npz bytes, meta) for the bucket. fields_by_step[step][name] = [181, 360] float arrays (1 deg, rows S->N)."""
    arrays = {f"{name}_{s}": np.asarray(fields_by_step[s][name], dtype=np.float32) for s in steps for name in FIELDS}
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    meta = {"run": run.astimezone(timezone.utc).isoformat(), "steps": list(map(int, steps)), "grid": GRID_1DEG,
            "members": ec.MEMBERS_EXPECTED, "basis": ec.BASIS_TYPE, "label": ec.LABEL,
            "speed_factor_by_bin": speed_factor_by_bin or {}, "written_at": datetime.now(timezone.utc).isoformat()}
    return buf.getvalue(), meta


def unpack(npz_bytes: bytes) -> dict:
    with np.load(io.BytesIO(npz_bytes)) as z:
        return {k: z[k] for k in z.files}


def load_latest(store) -> Optional[Tuple[dict, dict]]:
    """(meta, arrays) from the local cache, else the bucket. None when absent or unreadable."""
    local = os.path.join(str(getattr(store, "cache_dir", "") or "."), "ens_wind")
    npz_p, meta_p = os.path.join(local, "latest.npz"), os.path.join(local, "latest.json")
    try:
        if not (os.path.exists(npz_p) and os.path.exists(meta_p)):
            from services.weather_pipeline.store import WEATHER_BUCKET, _get_supabase_storage
            sb = _get_supabase_storage()
            if sb is None:
                return None
            meta_b = sb.storage.from_(WEATHER_BUCKET).download(KEY_META)
            npz_b = sb.storage.from_(WEATHER_BUCKET).download(KEY_NPZ)
            os.makedirs(local, exist_ok=True)
            open(meta_p, "wb").write(meta_b)
            open(npz_p, "wb").write(npz_b)
        meta = json.load(open(meta_p, encoding="utf-8"))
        return meta, unpack(open(npz_p, "rb").read())
    except Exception as e:  # noqa: BLE001 - absent file = no ENS extension this cycle (the caller falls back)
        logger.warning(f"[ENS wind] reduced field unavailable: {e}")
        return None


# ---------------------------------------------------------------------------------------------- the tail
def tail_valid_times(run_time: datetime, native_max: datetime) -> List[datetime]:
    """3-hourly UTC lattice in (native_max, run_time + 336 h]."""
    end = run_time + timedelta(hours=CEILING_H)
    t = native_max.replace(minute=0, second=0, microsecond=0)
    t += timedelta(hours=STEP_H - (t.hour % STEP_H) if t.hour % STEP_H else STEP_H)
    out = []
    while t <= end:
        out.append(t)
        t += timedelta(hours=STEP_H)
    return out


def build_points(meta: dict, arrays: dict, run_time: datetime, native_max: datetime, lats: List[float],
                 lons: List[float]) -> Optional[list]:
    """Open-Meteo-shaped points (lat outer, lon inner) for the tail, or None when the ENS run is more than 48 h old
    or does not reach the first tail hour. A LAGGED run (amendment 3) covers valid times only up to its own last step
    (+360 h): later hours get no tail, never filled. Never the loop, never GFS for ICON."""
    ens_run = datetime.fromisoformat(meta["run"])
    if ens_run.tzinfo is None:
        ens_run = ens_run.replace(tzinfo=timezone.utc)
    if (run_time - ens_run).total_seconds() / 3600.0 > MAX_ENS_AGE_H:
        logger.info(f"[ENS wind] ENS run {ens_run.isoformat()} older than {MAX_ENS_AGE_H} h vs {run_time.isoformat()}")
        return None
    steps = sorted(int(s) for s in meta["steps"])
    vts = tail_valid_times(run_time, native_max)
    if not vts:
        return None
    leads = [(vt - ens_run).total_seconds() / 3600.0 for vt in vts]
    if leads[0] < steps[0]:
        logger.info(f"[ENS wind] ENS steps start at {steps[0]} h, after the first tail lead {leads[0]:.0f} h")
        return None
    keep = [n for n, ld in enumerate(leads) if ld <= steps[-1]]
    if len(keep) < len(leads):
        logger.info(f"[ENS wind] lagged ENS run {ens_run.isoformat()}: tail ends at its +{steps[-1]} h "
                    f"({len(leads) - len(keep)} later hours get no tail)")
    vts, leads = [vts[n] for n in keep], [leads[n] for n in keep]
    if not vts:
        return None
    k_by_bin = meta.get("speed_factor_by_bin") or {}
    grid_lat = np.repeat(np.asarray(lats, dtype=float), len(lons))
    grid_lon = np.tile(np.asarray(lons, dtype=float), len(lats))
    sampled = {}

    def at(step):
        if step not in sampled:
            sampled[step] = {n: ec.bilinear(arrays[f"{n}_{step}"], GRID_1DEG, grid_lat, grid_lon) for n in FIELDS}
        return sampled[step]
    spd_rows, dir_rows, gust_rows, p90_rows, spread_rows = [], [], [], [], []
    for lead in leads:
        L = int(round(lead))
        lo, hi = ec.native_bracket(L, steps)
        f = at(lo) if lo == hi else ec.interp_step(at(lo), at(hi), lo, hi, L)
        k = _factor_for(L, k_by_bin)
        if k != 1.0:
            f = ec.apply_speed_factor(f, k)
        s, d = ec.to_speed_dir(f["u"], f["v"])
        spd_rows.append(s)
        dir_rows.append(d)
        gust_rows.append(np.maximum(f["gust"], s))      # a gust is never below the wind of the same composition
        p90_rows.append(np.maximum(f["gust_p90"], s))
        spread_rows.append(f["spread"])
    times = [vt.strftime("%Y-%m-%dT%H:%M") for vt in vts]
    points = []
    for n in range(len(grid_lat)):
        points.append({
            "latitude": float(grid_lat[n]), "longitude": float(grid_lon[n]),
            "__provider": "ecmwf_ens", "__model_run_time": ens_run.isoformat(),
            "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
            "hourly": {"time": list(times),
                       "wind_speed_10m": [round(float(r[n]), 3) for r in spd_rows],
                       "wind_direction_10m": [round(float(r[n]), 2) for r in dir_rows],
                       "wind_gusts_10m": [round(float(r[n]), 3) for r in gust_rows],
                       "wind_gusts_p90_10m": [round(float(r[n]), 3) for r in p90_rows],
                       "ens_speed_spread": [round(float(r[n]), 3) for r in spread_rows]},
        })
    return points


def sample_step(meta: dict, arrays: dict, step: int, lats, lons) -> dict:
    """The served composition at ONE archived ENS step, vectorised (for raster frame sets: ~1 M nodes per call is
    fine). Plain bilinear on the 1-degree grid (rows S->N, longitude wraps), the gate's de-bias factor on (u, v,
    speed) when one is recorded, and gust / gust_p90 clipped >= speed. Returns m/s arrays: u, v, speed, direction,
    gust, gust_p90, spread, plus `clipped` (bool, where a gust was raised to the wind). build_points uses the same
    sampling and factor, so a frame built from this is the same composition as the stored product."""
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    f = {n: ec.bilinear(arrays[f"{n}_{int(step)}"], GRID_1DEG, lats, lons) for n in FIELDS}
    k = _factor_for(int(step), meta.get("speed_factor_by_bin") or {})
    if k != 1.0:
        f = ec.apply_speed_factor(f, k)
    s, d = ec.to_speed_dir(f["u"], f["v"])
    clipped = f["gust"] < s
    return {"u": f["u"], "v": f["v"], "speed": s, "direction": d, "gust": np.maximum(f["gust"], s),
            "gust_p90": np.maximum(f["gust_p90"], s), "spread": f["spread"], "clipped": clipped}


def _factor_for(lead_h: int, k_by_bin: dict) -> float:
    """k of the gate's lead bin. Bins are ENS leads (the hindcast fits by ENS lead); an ENS run up to 36 h older than
    the deterministic run serves leads past 336 h, which take the last bin's factor."""
    lead_h = min(int(lead_h), CEILING_H)
    for name, k in (k_by_bin or {}).items():
        try:
            lo, hi = (int(x) for x in name.split("_")[1:3])
        except (ValueError, IndexError):
            continue
        if lo < lead_h <= hi:
            return float(k)
    return 1.0


def estimate_basis(meta: dict, native_h: Optional[int], run_time: Optional[datetime] = None) -> dict:
    age_h = None
    if run_time is not None:
        ens_run = datetime.fromisoformat(meta["run"])
        if ens_run.tzinfo is None:
            ens_run = ens_run.replace(tzinfo=timezone.utc)
        age_h = int(round((run_time - ens_run).total_seconds() / 3600.0))
    older = age_h is not None and age_h > OLDER_RUN_AFTER_H
    label = ec.LABEL if not older else ec.LABEL.replace("(estimate)", f"(estimate, older run, {age_h} h)")
    return {"type": ec.BASIS_TYPE, "method": "ecmwf_ens_member_mean_hard_handoff", "source_model": "ecmwf_ens",
            "members": int(meta.get("members", ec.MEMBERS_EXPECTED)), "ens_run": meta.get("run"),
            "ens_run_age_h": age_h, "older_run": bool(older),
            "label": label, "gust_label": GUST_LABEL, "native_horizon_hours": native_h}


async def extend_wind_tail(scheduler, model: str, run_time: datetime, native_max: datetime, bbox: dict,
                           resolution: float, is_test_env: bool) -> Optional[int]:
    """ENS first, else today's tail: EURO's GFS clones; for ICON, None (the caller keeps its legacy loop). Never GFS
    for ICON (owner 2026-11-15 19:27 EST)."""
    from services.weather_pipeline import euro_wind_extension as gx
    if ens_extension_on() and native_max and run_time:
        try:
            got = load_latest(scheduler.store)
            if got:
                meta, arrays = got
                from services._fetch_common import coarse_axis
                lats = coarse_axis(bbox["south"], bbox["north"], resolution)
                lons = coarse_axis(bbox["west"], bbox["east"], resolution)
                points = build_points(meta, arrays, run_time, native_max, lats, lons)
                if points:
                    from services.weather_pipeline.scheduler_helpers import normalize_and_save_loop
                    native_h = int((native_max - run_time).total_seconds() // 3600)
                    n = await normalize_and_save_loop(
                        scheduler.normalizer, scheduler.store, points,
                        model=model, provider="open-meteo", domain="wind", layer="wind",
                        bbox=bbox, resolution=resolution, run_time=run_time,
                        region_id="global_coarse", coverage_mode="global_tile",
                        is_test_env=is_test_env, step=1,
                        log_prefix=f"[Pipeline Scheduler] {model} wind (ENS member-mean tail) global_coarse",
                        estimated_after_index=0, estimate_basis=estimate_basis(meta, native_h, run_time))
                    if n:
                        logger.info(f"[ENS wind] {model}: {n} tail products from ENS run {meta.get('run')}")
                        return n
        except Exception as e:  # noqa: BLE001 - today's tail below still serves
            logger.error(f"[ENS wind] {model} ENS tail failed, keeping today's tail: {e}")
    if model == "ICON":
        return None          # the caller keeps ICON's legacy tail; never GFS (owner 2026-11-15 19:27 EST)
    return await gx.extend_euro_wind_from_gfs(scheduler, run_time, native_max)
