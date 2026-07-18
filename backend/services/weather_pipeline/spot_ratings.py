"""
spot_ratings.py — shared per-spot surf-quality rating compute + precompute persistence (P1).

ONE implementation of "rate a surf spot" used by BOTH the live `/api/weather/spot-ratings` endpoint AND the
cron precompute, so they can never diverge (the parity rule). The precompute is designed to run on the GitHub
Action ingest runner (off the 1-CPU serve box): it reads the spot list via Supabase REST (the runner has no
DATABASE_URL — only the Storage service key), rates each spot, and writes a small JSON object to Supabase
Storage L2. The serve box reads that object back; the endpoint falls through to live compute whenever no
precomputed frame covers the request, so this is purely additive — it never removes the working live path.
"""
import asyncio
import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.weather_pipeline.schemas import NormalizedPointResponse
from services.weather_pipeline.surf_rating import compute_surf_rating

logger = logging.getLogger(__name__)

KT_TO_MS = 0.514444
# CDN lane (2026-07-14, queue #2, USER-APPROVED scoped-RLS design): this one object is anonymously
# READABLE via a storage RLS policy pinned to exactly this key (migration
# anon_read_spot_ratings_latest_only; bucket stays private, every sibling stays service-role-only).
# The frontend fetches it straight off the Supabase CDN (spotRatingsCdn.js) — zero serve-box
# involvement on the precomputed path. RENAMING THIS KEY silently breaks that policy + the frontend.
SPOT_RATINGS_L2_KEY = "spot_ratings/latest.json"
SPOT_RATINGS_SCHEMA_VERSION = 1


def spot_confidence(accuracy_flag, is_verified_peak) -> str:
    """Rating confidence from the spot's location-accuracy metadata (bathymetry factors are only as good as
    the pin). verified/verified-peak -> high; low_accuracy/crowdsourced -> low; else medium."""
    flag = (accuracy_flag or "").lower()
    if is_verified_peak or flag == "verified":
        return "high"
    if flag in ("low_accuracy", "crowdsourced"):
        return "low"
    return "medium"


def rating_why(level, surf_h_m, period_s, wind_ms, wind_from, shore_normal) -> Optional[str]:
    """Compact explainability string. None when there's nothing to rate."""
    if level == "unknown" or surf_h_m is None:
        return None
    parts = [f"~{surf_h_m * 3.281:.1f} ft surf"]
    if period_s:
        parts.append(f"{period_s:.0f}s period")
    if wind_ms is not None:
        kt = wind_ms * 1.943844
        if wind_from is not None and shore_normal is not None:
            off = -math.cos(math.radians(wind_from - shore_normal))  # +1 offshore .. -1 onshore
            wd = "offshore" if off > 0.34 else ("onshore" if off < -0.34 else "cross-shore")
            parts.append(f"{kt:.0f}kt {wd} wind")
        else:
            parts.append(f"{kt:.0f}kt wind")
    return ", ".join(parts)


async def rate_one_spot(resolver, spot, model, valid_time, reference_size_m=None) -> dict:
    """Resolve a single spot's marine + wind point and compute its rating. `spot` is a dict with
    id/name/latitude/longitude/accuracy_flag/is_verified_peak (from the DB or Supabase REST). `resolver`
    exposes `async resolve_point(model, domain, layer, lat, lng, valid_time_str)` (the live point sampler).
    `reference_size_m` is the spot's LOCAL good-day breaking height (from spot_size_climatology) — None keeps
    the global 1.2 m default, so the rating is unchanged until a spot has enough climatology.
    Returns the rating dict — the SAME shape the endpoint serves and the precompute persists."""
    lat, lng = spot["latitude"], spot["longitude"]
    surf_h = period = swell_from = shore_normal = wind_ms = wind_from = None
    try:
        marine = await resolver.resolve_point(
            model=model, domain="marine", layer="waves", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(marine, NormalizedPointResponse) and marine.point is not None:
            surf_h = marine.surf_height_m
            period = marine.point.period
            swell_from = marine.point.direction
            shore_normal = marine.shore_normal_deg
    except Exception as e:
        logger.debug(f"[spot-ratings] marine resolve failed for {spot.get('id')}: {e}")
    try:
        wind = await resolver.resolve_point(
            model=model, domain="wind", layer="wind", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(wind, NormalizedPointResponse) and wind.point is not None:
            wind_ms = (wind.point.speed or 0.0) * KT_TO_MS    # wind point speed is knots
            wind_from = wind.point.direction
    except Exception as e:
        logger.debug(f"[spot-ratings] wind resolve failed for {spot.get('id')}: {e}")
    # Tide (global, lat/lng): the tide level + the spot's best_tide prior → tide_fit factor. Gated RATING_TIDE
    # (default off) so it's opt-in; a tide miss leaves tide_norm None → neutral, never breaks the rating.
    tide_norm = None
    tide_state = None
    best_tide = spot.get("best_tide")
    if os.environ.get("RATING_TIDE", "0") == "1":
        try:
            from services.weather_pipeline.tide import tide_norm_at
            tide_state = await tide_norm_at(lat, lng, valid_time)
            if tide_state:
                tide_norm = tide_state.get("norm")
        except Exception as e:
            logger.debug(f"[spot-ratings] tide resolve failed for {spot.get('id')}: {e}")
    # Breaker TYPE (Iribarren): bed slope + swell steepness → plunging/spilling/surging quality. Gated
    # RATING_BREAKER_TYPE (default off) AND neutral unless the FINER slope asset is bundled (bed_slope_at→None).
    breaker_xi = None
    if os.environ.get("RATING_BREAKER_TYPE", "0") == "1":
        try:
            from services.weather_pipeline.bathymetry import bed_slope_at
            from services.weather_pipeline.surf_transform import iribarren
            breaker_xi = iribarren(bed_slope_at(lat, lng), surf_h, period)
        except Exception as e:
            logger.debug(f"[spot-ratings] breaker-type resolve failed for {spot.get('id')}: {e}")
    score, level = compute_surf_rating(surf_h, period, wind_ms, wind_from, shore_normal, swell_from,
                                       tide_norm, best_tide, breaker_xi, reference_size_m)
    why = rating_why(level, surf_h, period, wind_ms, wind_from, shore_normal)
    if why and tide_state and best_tide:
        why += f", {tide_state.get('trend', '')} tide".rstrip()
    return {
        "spot_id": str(spot["id"]),
        "name": spot.get("name"),
        "latitude": lat,
        "longitude": lng,
        "score": score,
        "level": level,
        "confidence": spot_confidence(spot.get("accuracy_flag"), spot.get("is_verified_peak")),
        "surf_height_m": round(surf_h, 3) if surf_h is not None else None,
        "period_s": round(period, 1) if period is not None else None,
        "tide": tide_state,
        "why": why,
    }


def _lng_in(lng, w, e) -> bool:
    """Longitude-in-bbox, antimeridian-aware (w>e means the bbox wraps the dateline)."""
    return (w <= lng <= e) if w <= e else (lng >= w or lng <= e)


def _parse_dt(s):
    """Parse an ISO-8601 timestamp (tolerating a trailing 'Z') to an aware datetime, or None."""
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


SELECT_TOLERANCE_S = 7200  # 2h — the frontend's getSharedValidTime needn't string-match the precomputed key


def select_precomputed(obj, bbox, model, valid_time, tolerance_s: float = SELECT_TOLERANCE_S) -> Optional[list]:
    """PURE: pick the frame for (model, valid_time) from a loaded L2 object and filter its spots to the bbox.
    Matches valid_time EXACTLY first, else the NEAREST same-model frame within `tolerance_s` (the frontend's
    getSharedValidTime needn't byte-match the precompute's key — only be the same forecast hour). Returns the
    list of rating dicts (possibly empty when the frame matches but nothing's in view → DON'T fall back), or
    None when no frame matches → the signal to fall back to LIVE compute. Tolerant of malformed input."""
    if not obj or not isinstance(obj.get("frames"), list):
        return None
    try:
        w, s, e, n = bbox
    except Exception:
        return None
    model_frames = [f for f in obj["frames"] if f.get("model") == model]
    if not model_frames:
        return None
    frame = next((f for f in model_frames if f.get("valid_time") == valid_time), None)
    if frame is None:
        req = _parse_dt(valid_time)
        if req is not None:
            best, best_d = None, None
            for f in model_frames:
                ft = _parse_dt(f.get("valid_time"))
                if ft is None:
                    continue
                d = abs((ft - req).total_seconds())
                if best_d is None or d < best_d:
                    best, best_d = f, d
            if best is not None and best_d <= tolerance_s:
                frame = best
    if frame is None:
        return None
    out = []
    for sp in frame.get("spots", []):
        lat, lng = sp.get("latitude"), sp.get("longitude")
        if lat is None or lng is None:
            continue
        if s <= lat <= n and _lng_in(lng, w, e):
            out.append(sp)
    return out


def select_precomputed_laddered(obj, bbox, model, valid_time,
                                fresh_tolerance_s: float = SELECT_TOLERANCE_S,
                                stale_tolerance_s: Optional[float] = None) -> tuple:
    """PURE: the serve ladder — fresh precomputed (±fresh_tolerance_s) → bounded-STALE precomputed
    (±stale_tolerance_s, labeled) → (None, live). Melt hardening round 3 (2026-07-13): the 1-CPU box
    cannot survive live-at-scale (7.5-8.6 s/req starves every DB lane), so when the lane is merely
    STALE (missed/drifted cron) we serve the nearest frame within the stale bound as
    'precomputed_stale' instead of falling off the live cliff. Beyond the bound live remains the
    truth path. stale_tolerance_s defaults from SPOT_RATINGS_STALE_TOLERANCE_S (21600 s = 6h; 0 kills).
    Returns (spots_list_or_None, source_label)."""
    sel = select_precomputed(obj, bbox, model, valid_time, tolerance_s=fresh_tolerance_s)
    if sel is not None:
        return sel, "precomputed"
    if stale_tolerance_s is None:
        try:
            stale_tolerance_s = float(os.environ.get("SPOT_RATINGS_STALE_TOLERANCE_S", "21600"))
        except (TypeError, ValueError):
            stale_tolerance_s = 21600.0
    if stale_tolerance_s > 0:
        sel = select_precomputed(obj, bbox, model, valid_time, tolerance_s=stale_tolerance_s)
        if sel is not None:
            return sel, "precomputed_stale"
    return None, "live"


def build_l2_object(frames) -> dict:
    """Wrap precomputed frames (each {model, valid_time, spots:[...]}) in the versioned L2 object."""
    return {
        "version": SPOT_RATINGS_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "frames": frames,
    }


def upload_spot_ratings_l2(store, obj) -> None:
    """Write the precomputed object to Supabase Storage L2 (reuses the store's REST upload — same path/creds
    as the grid products, so it works on the ingest runner with only the Storage service key). This single
    upload IS the CDN lane's source too: the scoped RLS policy (see SPOT_RATINGS_L2_KEY) makes exactly this
    object anonymously readable — no mirror, no second bucket."""
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(SPOT_RATINGS_L2_KEY, data)


_l2_cache = {"obj": None, "ts": 0.0}


def load_spot_ratings_l2_cached(ttl: float = 300.0) -> Optional[dict]:
    """TTL-cached wrapper around load_spot_ratings_l2 so the serve box reads L2 at most once per `ttl`
    seconds (the precompute refreshes ~hourly on the cron). Used by the endpoint's precomputed-read path."""
    import time
    now = time.time()
    if _l2_cache["obj"] is not None and (now - _l2_cache["ts"]) < ttl:
        return _l2_cache["obj"]
    obj = load_spot_ratings_l2()
    # Cache even a None result briefly so a missing object doesn't 404 on every request.
    _l2_cache["obj"] = obj
    _l2_cache["ts"] = now
    return obj


def load_spot_ratings_l2() -> Optional[dict]:
    """Read the precomputed object back from L2 via a self-contained Storage REST GET (mirrors the upload).
    CACHE-BUSTED (2026-07-14): the object was uploaded with the product default max-age 3600 until today,
    so this read could serve an HOUR-stale edge copy — silently undoing checkpoint merge-uploads and feeding
    the stale ladder an old object. The unique query param bypasses every edge copy (the 07-06 manifest-scar
    recipe); the serve box's 300s TTL cache bounds the request rate.
    Returns the parsed object or None (missing / not configured / error) → caller falls back to live."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import time as _time
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{SPOT_RATINGS_L2_KEY}?cb={int(_time.time() * 1000)}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key,
                                          "Cache-Control": "no-cache", "Pragma": "no-cache"}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception as e:
        logger.debug(f"[spot-ratings] L2 load failed: {e}")
        return None


def fetch_active_spots_via_rest(limit: int = 5000, page_size: int = 1000) -> list:
    """Read active surf spots via Supabase REST/PostgREST (the ingest runner has no DATABASE_URL, only the
    Storage service key — which also authorizes PostgREST and bypasses RLS). Returns a list of spot dicts.

    PAGINATED (2026-07-18): PostgREST caps ANY single response at its server-side max-rows (Supabase
    default 1000) regardless of ``?limit=`` — with 1516 active spots the precompute silently rated
    exactly the first 1000 and ~516 spots never got a precomputed rating (CDN-object fingerprint:
    every frame spots=1000). Page by offset with a STABLE order (id) until a short page or `limit`."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return []
    import requests
    out = []
    while len(out) < limit:
        take = min(page_size, limit - len(out))
        url = (f"{base}/rest/v1/surf_spots?select=id,name,latitude,longitude,accuracy_flag,is_verified_peak,best_tide"
               f"&is_active=eq.true&latitude=not.is.null&longitude=not.is.null"
               f"&order=id&limit={take}&offset={len(out)}")
        resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch[:take])          # defensive: an over-serving page never blows past `limit`
        if len(batch) < take:
            break
    return out


def _make_point_resolver():
    """Build a PointResolutionService the same way the /weather routes do — for the CI precompute, which has
    the ingested products in the store but not the route module's singletons.

    Pass our OWN store AND dynamic_index (both file/L2-backed, no DB) so resolve_point never falls back to
    routes.weather.{store,dynamic_index} — BOTH PointResolutionService properties import routes.weather, which
    pulls in database.py; on the ingest runner (no DATABASE_URL) that instantiates a `sqlite+aiosqlite` engine
    at import and raises ModuleNotFoundError: aiosqlite for EVERY resolve, silently zeroing the ratings. With
    both injected, resolve_point stays DB-free (manifest-scan over the restored/ingested grids). The serve box
    dodged this only because it has DATABASE_URL=postgres so database.py never needs the sqlite driver."""
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.sampler import PointSampler
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    from services.weather_pipeline.dynamic_index import DynamicProductIndex
    from services.weather_pipeline.store import ProductStore
    return PointResolutionService(store=ProductStore(), sampler=PointSampler(), provider=OpenMeteoProvider(),
                                  dynamic_index=DynamicProductIndex())


def _top_of_hour_utc():
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


async def precompute_spot_ratings(resolver, spots, models, hour_offsets, base_dt=None, concurrency: int = 8) -> dict:
    """Rate every spot for each (model, hour) frame and return the versioned L2 object. Bounded concurrency so
    a large spot list doesn't stampede the resolver. valid_time per frame = base_dt + hour (top-of-hour UTC)."""
    base = base_dt or _top_of_hour_utc()
    sem = asyncio.Semaphore(max(1, concurrency))

    # LOCAL SIZE CALIBRATION (P-local): each spot's size gate saturates at its OWN good-day breaking height
    # (p80 climatology from spot_size_climatology), not a global 1.2 m — so a clean 2-3 ft day is fair-good at
    # a small-wave spot but poor at a big-wave spot (Surfline's "relative to the spot's potential"). Gate
    # RATING_LOCAL_SIZE; an empty map (feature off, or a spot without enough climatology yet) → reference None →
    # the global 1.2 m default → unchanged. Auto-scales to any spot added (its reference builds from the model).
    ref_map = {}
    if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
        try:
            from services.weather_pipeline.spot_size_climatology import (
                load_size_climatology_l2_cached, reference_map as _size_reference_map)
            ref_map = _size_reference_map(load_size_climatology_l2_cached())
            logger.info("[spot-ratings] local size calibration ON: %d spots have a size reference.", len(ref_map))
        except Exception as _re:
            logger.warning("[spot-ratings] size-reference load failed (global default): %s", _re)

    # SPATIAL-BATCHING pre-warm (2026-07-06, chip task_2d50cd81): the EURO pass below fires a
    # native CMEMS point per spot — one subset subprocess each, and CMEMS throttles under the
    # serial volume. Pre-warm ONE subset per ~5° spot cluster instead; the ladder's per-point
    # calls then hit the batched cache (native authority, ~60-100 requests for ~1000 spots).
    # Env-gated (POINT_BATCH_NATIVE_COPERNICUS=1, batch lanes only) and skip-flag-aware —
    # a no-op everywhere else. Never fatal: a failed pre-warm just leaves the ladder's own
    # per-point path (or its provider fallback) to serve.
    if spots and any((m or "").upper() == "EURO" for m in models):
        try:
            from services.copernicus_point_batching import (
                prewarm_euro_marine_point_cache, EURO_POINT_FORECAST_DAYS,
            )
            await prewarm_euro_marine_point_cache(
                [(sp.get("latitude"), sp.get("longitude")) for sp in spots],
                forecast_days=EURO_POINT_FORECAST_DAYS,
            )
        except Exception as _pe:
            logger.warning(f"[spot-ratings] CMEMS pre-warm skipped: {_pe}")

    # TIDE pre-warm (2026-07-18, RATING_TIDE flip): with the tide factor on, a fresh CI process would
    # cold-fetch ~900 spot-cells ONE request at a time inside rate_one_spot (Open-Meteo quota + tail
    # latency). Batch-seed the TTL cache first (~10 comma-separated-coords requests for ~1500 spots);
    # the per-spot path then hits the cache. Never fatal — a failed pre-warm just leaves the per-spot
    # fallback (and a tide miss is always a neutral rating).
    if spots and os.environ.get("RATING_TIDE", "0") == "1":
        try:
            from services.weather_pipeline.tide import prewarm_tide_cache
            n_tide = await prewarm_tide_cache(
                [(sp.get("latitude"), sp.get("longitude")) for sp in spots])
            logger.info("[spot-ratings] tide cache pre-warmed: %d cells.", n_tide)
        except Exception as _te:
            logger.warning(f"[spot-ratings] tide pre-warm skipped: {_te}")

    async def _one(resolver, sp, model, vt):
        async with sem:
            return await rate_one_spot(resolver, sp, model, vt, reference_size_m=ref_map.get(str(sp.get("id"))))

    frames = []
    for model in models:
        for h in hour_offsets:
            vt = (base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
            rated = list(await asyncio.gather(*[_one(resolver, sp, model, vt) for sp in spots])) if spots else []
            frames.append({"model": model, "valid_time": vt, "hour_offset": h, "spots": rated})
    return build_l2_object(frames)


def frames_coverage(frames) -> float:
    """PURE: fraction of spot-frames carrying a real score (the coverage-guard metric)."""
    rated = sum(1 for fr in frames for s in fr.get("spots", []) if s.get("score") is not None)
    total = sum(len(fr.get("spots", [])) for fr in frames) or 1
    return rated / total


def merge_model_frames(prev_frames, fresh_frames, replaced_models) -> list:
    """PURE: fresh frames for the models recomputed so far + the PREVIOUS object's frames for every
    other model. The checkpoint-merge contract (2026-07-13 melt round 4): a run that times out after
    model N still leaves models 1..N fresh AND models N+1.. on their previous (stale-servable) frames
    — never the all-or-nothing loss that froze the lane at frame 12:00Z for 9h (three consecutive
    cancelled runs × upload-at-end = the 21:00Z melt)."""
    return list(fresh_frames) + [f for f in (prev_frames or []) if f.get("model") not in replaced_models]


def run_spot_ratings_precompute() -> tuple:
    """CI entry: read spots (Supabase REST), rate the configured frames, upload the L2 object with a
    CHECKPOINT MERGE-UPLOAD AFTER EVERY MODEL (2026-07-13): the 07-13 melt recurrence was three
    consecutive cancelled runs (35/55-min timeouts) each losing ALL computed frames because the upload
    only happened at the very end. Now each model's frames go live as soon as that model completes,
    merged with the previous object so not-yet-recomputed models keep their prior coverage (the stale
    ladder serves them). Returns (n_spots, n_frames_uploaded; 0 = every model withheld/failed).
    Config via env: SPOT_RATINGS_PRECOMPUTE_MODELS (csv, default GFS), SPOT_RATINGS_PRECOMPUTE_HOURS
    (csv offsets, default '0'), SPOT_RATINGS_MIN_COVERAGE (per-model guard, default 0.05)."""
    from services.weather_pipeline.store import ProductStore
    spots = fetch_active_spots_via_rest()
    if not spots:
        logger.warning("[spot-ratings] precompute: no active spots from REST — nothing to do.")
        return 0, 0
    models = [m.strip().upper() for m in os.environ.get("SPOT_RATINGS_PRECOMPUTE_MODELS", "GFS").split(",") if m.strip()]
    hours = [int(h) for h in os.environ.get("SPOT_RATINGS_PRECOMPUTE_HOURS", "0").split(",") if h.strip()]
    resolver = _make_point_resolver()
    store = ProductStore()
    try:
        prev_frames = (load_spot_ratings_l2() or {}).get("frames") or []
    except Exception:
        prev_frames = []
    min_cov = float(os.environ.get("SPOT_RATINGS_MIN_COVERAGE", "0.05"))
    accepted_frames = []   # fresh frames that passed the per-model guard, across models so far
    replaced = set()
    n_frames_uploaded = 0

    async def _run_all():
        nonlocal n_frames_uploaded
        for model in models:
            obj_m = await precompute_spot_ratings(resolver, spots, [model], hours)
            frames_m = obj_m.get("frames", [])
            cov = frames_coverage(frames_m)
            # PER-MODEL coverage guard: an all-null model keeps its PREVIOUS frames (never stomp a
            # working model's coverage with nulls); other models proceed independently.
            if cov < min_cov:
                logger.error("[spot-ratings] precompute %s coverage %.1f%% below floor %.0f%% — keeping "
                             "the previous %s frames (are the grids warmed?).",
                             model, cov * 100, min_cov * 100, model)
                continue
            accepted_frames.extend(frames_m)
            replaced.add(model)
            merged = merge_model_frames(prev_frames, accepted_frames, replaced)
            obj = build_l2_object(merged)
            # OBSERVATION GATE + light report weigh-in (rating plan Step 4): scores above 'good' are
            # capped unless >=2 models agree or a fresh user report confirms. Applied to the merged
            # object BEFORE each checkpoint upload so every consumer sees one truth. Kill: RATING_OBS_GATE=0.
            if os.environ.get("RATING_OBS_GATE", "0") == "1":
                try:
                    from services.weather_pipeline.rating_confirmation import (
                        apply_gate_to_frames, fetch_recent_reports_via_rest)
                    n_capped = apply_gate_to_frames(obj.get("frames", []), fetch_recent_reports_via_rest())
                    logger.info("[spot-ratings] observation gate applied: %d spot-frames capped.", n_capped)
                except Exception as _oe:
                    logger.warning("[spot-ratings] observation gate skipped (raw scores served): %s", _oe)
            upload_spot_ratings_l2(store, obj)
            n_frames_uploaded = len(merged)
            logger.info("[spot-ratings] CHECKPOINT upload after %s: %d frames live (%d fresh, cov %.0f%%).",
                        model, len(merged), len(accepted_frames), cov * 100)

    asyncio.run(_run_all())

    if not replaced:
        logger.error("[spot-ratings] precompute: every model withheld/failed — previous object left as-is.")
        return len(spots), 0
    # Fold this run's breaking heights into the per-spot size CLIMATOLOGY (the local-calibration reference
    # source). Single-writer (this cron) → no CAS. NEVER fatal — a climatology hiccup must not fail the
    # ratings precompute or stomp the served ratings. Gate RATING_SIZE_CLIMATOLOGY (default on; it only
    # WRITES a separate blob, it doesn't change served ratings until RATING_LOCAL_SIZE reads it back).
    if os.environ.get("RATING_SIZE_CLIMATOLOGY", "1") == "1":
        try:
            from services.weather_pipeline.spot_size_climatology import (
                load_size_climatology_l2, merge_frames_into_climatology, upload_size_climatology_l2)
            clim = merge_frames_into_climatology(load_size_climatology_l2(), accepted_frames)
            upload_size_climatology_l2(store, clim)
            logger.info("[spot-ratings] size climatology updated: %d spots tracked.", len(clim.get("spots", {})))
        except Exception as _ce:
            logger.warning("[spot-ratings] size climatology accumulation skipped: %s", _ce)
    logger.info("[spot-ratings] precompute complete: %d spots, %d frames live (%s × hours %s, %d models fresh).",
                len(spots), n_frames_uploaded, models, hours, len(replaced))
    return len(spots), n_frames_uploaded
