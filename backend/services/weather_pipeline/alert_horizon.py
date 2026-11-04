"""alert_horizon.py: the served rating frames over the next 72 h, for the spots that have an active alert.

DARK (ALERTS_FORECAST_WINDOWS, default '0'): with the flag off `run_alert_horizon_precompute` returns at once
and nothing is computed, uploaded or read.

WHY A PRECOMPUTED OBJECT, NOT A LIVE LOOP. The alert scheduler runs inside the Render web process, which is ONE
CPU serving production. Rating a spot hour by hour there means one `resolve_point` per (hour, domain), and each
new hour is a different grid product: a JSON parse into the 128-product / 5-minute cache the map's own reads
depend on (`ProductStore._PRODUCT_CACHE_LIMIT`). Over 72 h that is ~2 x 72 product loads per region per model per
run, evicting what map users are reading, every 15 minutes. The measured numbers are in
docs/weather-program/log/2026-11-03-claude-alerts-forecast-windows.md. So the rating runs where the glyph rating
already runs, on the GitHub runner in precompute.yml, and the box reads one small object.

★ ONE FORECAST COMPOSITION. This calls `spot_ratings_precompute.precompute_spot_ratings` (hence
`spot_ratings.rate_one_spot`, the reference implementation) for the same models, then applies the same
observation gate the glyph frames get. It adds no physics: only a spot filter, more hour offsets and a slimmer
entry. ⚠️ The gate needs every model's frames to find agreement, which is why all of
SPOT_RATINGS_PRECOMPUTE_MODELS are rated even though alerts read one lane: a one-model object would cap every
good/epic hour for want of a peer and disagree with the glyph.

Key `spot_ratings/alert_horizon.json` (namespaced, so the designated-writer gate lets the precompute lane write
it; not the client-downloaded `latest.json`, so its size taxes no browser).
"""
from services import runtime_flags as _rf  # D-065: guarded flags read env > manifest > code default
import asyncio
import contextlib
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

ALERT_HORIZON_L2_KEY = "spot_ratings/alert_horizon.json"
ALERT_HORIZON_SCHEMA_VERSION = 1
_KEEP = ("spot_id", "score", "level", "raw_score", "confirmed", "surf_height_m", "period_s", "tide",
         "confidence")
_KEEP_INPUTS = ("wind_ms", "wind_from_deg", "shore_normal_deg")


def _env_int(name, default, lo, hi):
    try:
        v = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return v if lo <= v <= hi else default


def horizon_models() -> List[str]:
    """The models the glyph precompute rates, in its order (the first is the served default lane). Unset = none:
    this lane never guesses a model, it follows the lane config precompute.yml declares."""
    raw = os.environ.get("ALERTS_HORIZON_MODELS") or os.environ.get("SPOT_RATINGS_PRECOMPUTE_MODELS", "")
    return [m.strip().upper() for m in raw.split(",") if m.strip()]


def horizon_offsets() -> List[int]:
    """0..H every step hours. HOURLY by default, MEASURED: with a perfect forecast (replay --sigma 0) 3-hourly
    frames announce windows that never happen, precision 0.58-0.86 across three alert types, because one frame
    held for +/-1.5 h paints a 1-hour sea-breeze gap as a 3-hour window; hourly frames score 1.000. The glyph
    lane's 3 h spacing serves a map hour, not a session boundary. scripts/alert_window_replay.py --step."""
    from services.surf_alert_windows import configured_horizon_h
    step = _env_int("ALERTS_HORIZON_STEP_H", 1, 1, 6)
    return list(range(0, configured_horizon_h() + 1, step))


def slim_entry(entry: dict) -> dict:
    """The fields the alert decision reads; the rest of the glyph payload stays in latest.json."""
    out = {k: entry.get(k) for k in _KEEP if entry.get(k) is not None}
    inputs = entry.get("inputs") or {}
    kept = {k: inputs[k] for k in _KEEP_INPUTS if inputs.get(k) is not None}
    if kept:
        out["inputs"] = kept
    return out


@contextlib.contextmanager
def _all_inputs():
    """rate_one_spot persists its wind inputs for a 5% sample (that tax rule protects the client blob, which
    this object is not). Alert conditions need the wind on every entry, so the pass records all of them."""
    key = "SPOT_RATINGS_INPUTS_SAMPLE_PCT"
    old = os.environ.get(key)
    os.environ[key] = "100"
    try:
        yield
    finally:
        if old is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = old


def fetch_alert_spot_ids_via_rest(page_size: int = 1000, limit: int = 20000) -> set:
    """Distinct spot ids that carry at least one ACTIVE alert (no user ids leave the database)."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return set()
    import requests
    ids, offset = set(), 0
    while offset < limit:
        url = (f"{base}/rest/v1/surf_alerts?select=spot_id&is_active=eq.true"
               f"&order=id&limit={page_size}&offset={offset}")
        resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not isinstance(batch, list) or not batch:
            break
        ids.update(str(r["spot_id"]) for r in batch if r.get("spot_id"))
        if len(batch) < page_size:
            break
        offset += page_size
    return ids


async def build_alert_horizon(resolver, spots, models, offsets, *, base_dt=None, budget_s=None,
                              rate=None, clock=time.monotonic) -> dict:
    """Rate `spots` at every offset for every model (nearest hours first, all models per chunk, so a budget
    cut keeps a complete, gateable near horizon), gate, slim. `rate` is precompute_spot_ratings (injectable)."""
    from services.weather_pipeline.spot_ratings_precompute import (
        _top_of_hour_utc, build_l2_object, precompute_spot_ratings)
    rate = rate or precompute_spot_ratings
    base = base_dt or _top_of_hour_utc()
    chunk = _env_int("ALERTS_HORIZON_CHUNK", 9, 1, 200)
    started, frames, truncated = clock(), [], False
    for i in range(0, len(offsets), chunk):
        if budget_s is not None and clock() - started > budget_s:
            truncated = True
            break
        part = offsets[i:i + chunk]
        for model in models:
            obj = await rate(resolver, spots, [model], part, base_dt=base)
            if obj.get("refused"):
                raise RuntimeError(f"rating refused for {model}: {obj['refused']}")
            frames.extend(obj.get("frames") or [])
    if _rf.flag("RATING_OBS_GATE") == "1" and frames:
        from services.weather_pipeline.rating_confirmation import apply_gate_to_frames, fetch_recent_reports_via_rest
        apply_gate_to_frames(frames, fetch_recent_reports_via_rest())
    obj = build_l2_object([{"model": f.get("model"), "valid_time": f.get("valid_time"),
                            "hour_offset": f.get("hour_offset"),
                            "spots": [slim_entry(s) for s in f.get("spots") or []]} for f in frames])
    step = (offsets[1] - offsets[0]) if len(offsets) > 1 else 1
    obj.update({"kind": "alert_horizon", "horizon_version": ALERT_HORIZON_SCHEMA_VERSION,
                "models": list(models), "default_model": models[0] if models else None,
                "step_h": step, "base_time": base.strftime("%Y-%m-%dT%H:00:00Z"),
                "truncated": truncated, "elapsed_s": round(clock() - started, 1)})
    return obj


def run_alert_horizon_precompute() -> tuple:
    """CI entry (precompute_ci.py). Returns (n_spots, n_frames). Flag off -> (0, 0), nothing touched."""
    from services.surf_alert_windows import enabled
    if not enabled():
        return 0, 0
    from services.weather_pipeline.spot_ratings_precompute import _make_point_resolver, fetch_active_spots_via_rest
    from services.weather_pipeline.store import ProductStore
    wanted = fetch_alert_spot_ids_via_rest()
    max_spots = _env_int("ALERTS_HORIZON_MAX_SPOTS", 300, 1, 5000)
    spots = [s for s in fetch_active_spots_via_rest() if str(s.get("id")) in wanted][:max_spots]
    if not spots:
        logger.info("[alert-horizon] no active alerts on active spots; nothing to rate.")
        return 0, 0
    models, offsets = horizon_models(), horizon_offsets()
    if not models:
        logger.error("[alert-horizon] SPOT_RATINGS_PRECOMPUTE_MODELS is unset; no lane to rate, nothing uploaded.")
        return len(spots), 0
    budget = float(_env_int("ALERTS_HORIZON_BUDGET_S", 900, 60, 7200))
    with _all_inputs():
        obj = asyncio.run(build_alert_horizon(_make_point_resolver(), spots, models, offsets, budget_s=budget))
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    ProductStore()._upload_to_supabase(ALERT_HORIZON_L2_KEY, data)
    logger.info("[alert-horizon] %d spots x %d frames (%s, step %sh, truncated=%s) in %.0fs, %d bytes -> L2.",
                len(spots), len(obj["frames"]), models, obj["step_h"], obj["truncated"], obj["elapsed_s"], len(data))
    return len(spots), len(obj["frames"])


def load_alert_horizon() -> Optional[dict]:
    """One cache-busted Storage GET (same recipe as load_spot_ratings_l2). None on any failure."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{ALERT_HORIZON_L2_KEY}?cb={int(time.time() * 1000)}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key,
                                          "Cache-Control": "no-cache"}, timeout=10)
        if resp.status_code != 200:
            logger.warning("[alert-horizon] L2 read HTTP %s", resp.status_code)
            return None
        obj = resp.json()
        return obj if isinstance(obj, dict) and obj.get("kind") == "alert_horizon" else None
    except Exception as e:
        logger.warning("[alert-horizon] L2 read failed: %s", e)
        return None


_cache = {"obj": None, "ts": None}
_cache_lock = threading.Lock()


def load_alert_horizon_cached(ttl: float = 600.0) -> Optional[dict]:
    """The scheduler reads at most once per `ttl` (failures retried after 60 s)."""
    with _cache_lock:
        age = None if _cache["ts"] is None else time.monotonic() - _cache["ts"]
        limit = ttl if _cache["obj"] is not None else min(ttl, 60.0)
        if age is not None and 0 <= age < limit:
            return _cache["obj"]
        _cache["obj"], _cache["ts"] = load_alert_horizon(), time.monotonic()
        return _cache["obj"]


def generated_age_h(obj: Optional[dict], now: Optional[datetime] = None) -> Optional[float]:
    try:
        gen = datetime.fromisoformat(str(obj["generated_at"]).replace("Z", "+00:00"))
    except Exception:
        return None
    return ((now or datetime.now(timezone.utc)) - gen).total_seconds() / 3600.0
