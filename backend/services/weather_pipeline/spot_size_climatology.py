"""
spot_size_climatology.py — per-spot LOCAL size expectation for the surf rating (P-local).

Surf quality is RELATIVE to a spot's potential (Surfline's principle): a clean 2-3 ft day is fair-good
in Florida but poor in Indonesia. `surf_rating.size_score` accepts a `reference_size_m` — the breaking
height at which THIS spot is "fully working". This module derives that reference from the spot's own
breaking-height CLIMATOLOGY, so it is objective, global, and auto-calibrates ANY spot added to the map
(no per-spot tuning).

Definition: reference = the p80 of the spot's SURFABLE-day breaking heights (samples below the ~0.2 m
rideability floor are excluded, so flat days don't drag the "good day" size down). A small-wave spot has
a small p80 (2 ft saturates the size gate); a big-wave spot has a large p80 (2 ft barely registers).

Storage: a compact rolling HISTOGRAM per spot in L2 (`spot_ratings/size_climatology.json`), merged each
precompute cycle (single-writer cron — no CAS needed). Bounded size (25 bins/spot), unbounded time. Until
a spot has >= MIN_SAMPLES it has NO reference (rating falls back to the global 1.2 m default → no
regression). The served reference is clamped to a sane range so a degenerate histogram can't rate absurdly.

Pure helpers (unit-tested, no I/O) + a thin L2 runner (flag-gated on the CI runner).
"""
import json
import logging
import math
import os
from typing import Optional

logger = logging.getLogger(__name__)

SIZE_CLIMATOLOGY_L2_KEY = "spot_ratings/size_climatology.json"
SCHEMA_VERSION = 1

# Histogram: 25 bins over [0, 5) m at 0.2 m each (breaking heights above 5 m clamp into the top bin).
BIN_WIDTH_M = 0.2
N_BINS = 25
_HMIN_RIDEABLE_M = 0.2                 # mirror surf_rating._HMIN_RIDEABLE_M — samples <= this are excluded
# ⚠️ WAS 0.80 ("the spot's good day"). MEASURED WRONG against the owner's own acceptance anchors on
# the live 1,821-entry blob, 2026-07-30. At p80 Florida's reference is 0.954 m and only 2 of the 5
# owner anchors pass — WORSE than the 4/5 the global 1.2 m default manages, because a too-high
# reference makes everything read small: clean 2-3 ft drops to poor_fair and PUMPING 6-8 ft falls out
# of epic, which is the opposite of what the owner asked for.
#
#   pctl   FL ref   anchors        pctl   FL ref   anchors
#   0.30    0.653     4/5          0.55    0.809     5/5
#   0.40    0.735     5/5          0.60    0.833     5/5
#   0.45    0.762     5/5          0.65    0.856     4/5
#   0.50    0.785     5/5   <-     0.80    0.954     2/5   (the old value)
#
# p40-p60 is a PLATEAU, not a knife edge, so this is margin rather than a fit to five points. 0.50 is
# its centre and the honest description of the quantity: the spot's TYPICAL surfable day, not a good
# one. Big-wave spots stay big — Pipeline 1.56 m, Mavericks 1.81 m, Uluwatu 2.4 m — so the small-vs-
# large shape the whole feature depends on is preserved.
#
# ★ Retroactive: the blob stores HISTOGRAMS and the reference is derived at read time, so this applies
# to the existing 1,821 entries immediately. No re-accumulation, no waiting for ingest.
REF_PERCENTILE = 0.50                  # median surfable-day height = the spot's typical day
MIN_SAMPLES = 12                       # below this a spot has no reference yet (bootstrap → global default)
REF_CLAMP_MIN_M = 0.4                  # a reference below chest-of-a-grom is nonsense; floor it
REF_CLAMP_MAX_M = 4.0                  # and cap it (a spot whose good day is > ~13 ft is the ceiling)


def _bin_index(h_m: float) -> int:
    i = int(h_m / BIN_WIDTH_M)
    return 0 if i < 0 else (N_BINS - 1 if i >= N_BINS else i)


def empty_hist() -> list:
    return [0] * N_BINS


def merge_samples(hist: Optional[list], samples) -> list:
    """Add breaking-height samples (metres) into a per-spot histogram, EXCLUDING sub-rideable samples so the
    distribution is over surfable days only. Returns the updated histogram (new list if `hist` is None/bad)."""
    h = list(hist) if (isinstance(hist, list) and len(hist) == N_BINS) else empty_hist()
    for s in samples or []:
        if s is None:
            continue
        try:
            v = float(s)
        except (TypeError, ValueError):
            continue
        if v <= _HMIN_RIDEABLE_M:
            continue
        h[_bin_index(v)] += 1
    return h


def hist_count(hist) -> int:
    return sum(hist) if isinstance(hist, list) else 0


def percentile_from_hist(hist, p: float) -> Optional[float]:
    """The p-quantile (0..1) breaking height from a histogram, INTERPOLATED inside the bin.

    ⚠️ This used to return the bin's UPPER EDGE, described as "conservative". Measured against the
    live 1,821-entry blob (2026-07-30) that choice cost two things at once:

      * a systematic HIGH BIAS of up to a full bin, ~+0.13 m in practice. Sebastian Inlet read
        1.20 m where its interpolated p80 is 1.053; New Smyrna read 1.00 where it is 0.855.
      * QUANTISATION to multiples of BIN_WIDTH_M (0.2 m). The reference could only ever be
        0.8 / 1.0 / 1.2 — and the reference window that satisfies the owner's calibration anchors
        is [0.65, 0.85], itself only 0.2 m wide. A 0.2 m grid cannot be calibrated onto a 0.2 m
        target: exactly one grid point falls inside it, so most spots could not land there at all.

    Interpolating is also just the standard way to read a quantile off a histogram. Bin i spans
    [i*W, (i+1)*W); the quantile sits a fraction of the way through whichever bin contains it.
    """
    total = hist_count(hist)
    if total <= 0:
        return None
    target = p * total
    cum = 0
    for i, c in enumerate(hist):
        if c <= 0:
            continue
        if cum + c >= target:
            # Fraction of THIS bin's samples needed to reach the target.
            frac = (target - cum) / c
            frac = 0.0 if frac < 0.0 else (1.0 if frac > 1.0 else frac)
            return round((i + frac) * BIN_WIDTH_M, 3)
        cum += c
    return round(N_BINS * BIN_WIDTH_M, 3)


def reference_from_hist(hist, *, min_samples: int = None, percentile: float = None,
                        clamp=(REF_CLAMP_MIN_M, REF_CLAMP_MAX_M)) -> Optional[float]:
    """The spot's reference size (m) = clamped p80 of its surfable-day heights, or None when it has too few
    samples yet (caller falls back to the global default → no regression)."""
    min_samples = MIN_SAMPLES if min_samples is None else min_samples
    percentile = REF_PERCENTILE if percentile is None else percentile
    if hist_count(hist) < max(1, min_samples):
        return None
    ref = percentile_from_hist(hist, percentile)
    if ref is None:
        return None
    lo, hi = clamp
    return round(min(hi, max(lo, ref)), 3)


def reference_map(clim_obj: Optional[dict], **kw) -> dict:
    """{spot_id: reference_size_m} for every spot that has enough climatology. Missing spots are simply
    absent (→ the rating uses the global default for them). Tolerant of a missing/malformed object."""
    out = {}
    if not clim_obj or not isinstance(clim_obj.get("spots"), dict):
        return out
    for sid, rec in clim_obj["spots"].items():
        hist = rec.get("hist") if isinstance(rec, dict) else None
        ref = reference_from_hist(hist, **kw)
        if ref is not None:
            out[str(sid)] = ref
    return out


# The resolved map, memoised against the IDENTITY of the climatology object it was built from.
# NOT a second TTL: `load_size_climatology_l2_cached` returns the same object for the life of its
# own cache, so this invalidates exactly when that loader refreshes and can never be staler than it.
_ref_map_memo = {"cell": (None, {})}


def reference_for_spot(spot_id, clim_obj: Optional[dict] = None) -> Optional[float]:
    """THE ONE-SPOT ACCESSOR: this spot's `reference_size_m`, or None.

    ★ WHY THIS EXISTS. The batch lanes (`spot_ratings.build_precomputed_frames`, the live glyph
    fallback in `routes/weather.py`) rate MANY spots per pass, so they build the whole
    `reference_map` once and index it. A per-spot surface — the spot hub — has no such pass to hang
    the map on, and the two obvious workarounds are both wrong:

      * rebuild `reference_map` per spot: a ~1,800-entry percentile sweep per hub call, and the
        explore lane fans out one hub call PER SPOT IN VIEW. Pure CPU on a serve box with a
        three-incident melt history.
      * read the climatology some other way: a THIRD derivation of the same number, free to drift
        from the two that already exist. CLAUDE.md: mirror the reference, never re-derive it.

    So the composition stays in ONE place. This is literally `reference_map(
    load_size_climatology_l2_cached())` — the same two symbols `spot_ratings` composes — with the
    map cached against the loaded object rather than rebuilt per lookup.

    ⚠️ NOT GATED HERE. `RATING_LOCAL_SIZE` is the CALLER's gate at every existing lane, and it must
    stay there: the flag has a value PER LANE, and a gate buried in a shared helper would silently
    flip every lane at once the day one of them set it. Callers gate; this only looks up.

    ``clim_obj`` lets a caller that ALREADY HOLDS the object resolve against THAT one instead of
    re-entering the loader. ⚠️ It is not an optimisation — it is a correctness requirement for
    `reference_for_coordinate`, which builds its coordinate index from a blob and must read the
    reference from the SAME blob. Re-entering the loader there could hand back a REFRESHED object
    between the two steps, so the index and the value would describe different snapshots: the
    "both sides of a comparison must share a composition" defect (`f504d52b`) in one function.

    Returns None for an unknown spot, a spot without enough climatology, or no blob at all — every
    one of which means "use the global curve", which is the pre-flip behaviour."""
    if spot_id is None:
        return None
    clim = clim_obj if clim_obj is not None else load_size_climatology_l2_cached()
    if not clim:
        return None
    src, mapping = _ref_map_memo["cell"]
    if src is not clim:
        mapping = reference_map(clim)
        # ONE tuple assignment: a concurrent reader sees either the whole old pair or the whole new
        # one, never a new source paired with a stale map.
        _ref_map_memo["cell"] = (clim, mapping)
    return mapping.get(str(spot_id))


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


# Coordinate index, memoised against the IDENTITY of the climatology object it was built from —
# the same contract as `_ref_map_memo`, so it invalidates exactly when the loader refreshes.
_coord_index_memo: dict = {"cell": (None, [])}


def reference_for_coordinate(lat: float, lng: float, max_km: float = 2.0,
                             clim_obj: Optional[dict] = None) -> Optional[float]:
    """THE COORDINATE ACCESSOR: the per-SPOT reference for a coordinate that IS a catalogued spot.

    ★★ WHY THIS EXISTS — queue item E#1. `/api/weather/point` is keyed by a COORDINATE and carries
    no spot identity, so it served the per-CELL reference (`grid_size_climatology.reference_for`)
    while the glyph for the same break used the per-SPOT one. Measured live 2026-08-01 by fitting
    the reference that reproduces each served score: the cell value sits a **median 21.3% (max
    52.5%, 4 of 10 over 25%)** from the spot value, which independently reproduced the 25.8%/53.0%
    measured in HANDOFF-2026-08-01-E. That gap is what remained after the sim began reading the
    served curve, and it moves the infobox badge by −11.4 to +9.6 points.

    ⛔ THE ALTERNATIVES WERE WORSE, AND ONE WAS A TRAP.
      * A `spot_id` QUERY PARAM would make the served number depend on a caller-supplied key the
        endpoint cannot validate, and threading it needs `point_resolution.py`.
      * PEEKING the resident L2 caches (upgrade only when both happen to be warm) looked free and
        is the recorded COVERAGE CLASS: the same coordinate would return 1.86 or 1.931 depending on
        what else had warmed the process — **a served number that varies with cache residency,
        degrading silently.** Rejected before building.
    A coordinate index is DETERMINISTIC: the blob either holds a spot within `max_km` or it does
    not, and the answer does not depend on process history.

    ⚠️ `max_km` 2.0 is not a new constant — it is the tolerance `rating_confirmation.confirmation_for`
    already uses to call two coordinates the same break, on this same endpoint's sibling lane.

    Returns None for: no blob, no coordinates in the blob (records written before this key existed),
    nothing within `max_km`, or a matched spot with too little climatology. **Every one of those
    means "use the cell reference", which is the pre-2026-08-01 behaviour exactly** — so this ships
    inert and activates when the next precompute cycle writes coordinates.

    ⚠️ NOT GATED on RATING_LOCAL_SIZE. Like `reference_for_spot`, the flag is the CALLER's gate at
    every lane; a gate buried in a shared helper would flip every lane at once.
    """
    if lat is None or lng is None:
        return None
    clim = clim_obj if clim_obj is not None else load_size_climatology_l2_cached()
    if not clim or not isinstance(clim.get("spots"), dict):
        return None
    src, index = _coord_index_memo["cell"]
    if src is not clim:
        index = [(rec["lat"], rec["lng"], sid)
                 for sid, rec in clim["spots"].items()
                 if isinstance(rec, dict) and rec.get("lat") is not None
                 and rec.get("lng") is not None]
        _coord_index_memo["cell"] = (clim, index)
    if not index:
        return None
    # ⚠️ A cheap bounding-box reject BEFORE haversine. At 2 km the latitude window is ~0.018 deg, so
    # this discards ~all of ~1,800 entries with two comparisons each; the trig then runs on a
    # handful. The endpoint is hot enough that a full haversine sweep per request would be felt.
    dlat = max_km / 111.0
    best_sid, best_km = None, None
    for rlat, rlng, sid in index:
        if abs(rlat - lat) > dlat:
            continue
        km = _haversine_km(lat, lng, rlat, rlng)
        if km <= max_km and (best_km is None or km < best_km):
            best_sid, best_km = sid, km
    if best_sid is None:
        return None
    # ⚠️ THE SAME `clim` THE INDEX WAS BUILT FROM, never a fresh loader call. Re-entering the loader
    # here could return a REFRESHED object, leaving the index and the value on different snapshots —
    # and in tests it ignored the injected blob entirely, which is how this was caught.
    return reference_for_spot(best_sid, clim_obj=clim)


def merge_frames_into_climatology(clim_obj: Optional[dict], frames) -> dict:
    """Fold the breaking heights from a precompute run's frames ([{spots:[{spot_id, surf_height_m}...]}]) into
    the rolling per-spot histograms. Returns the updated climatology object (schema-versioned)."""
    spots = {}
    if clim_obj and isinstance(clim_obj.get("spots"), dict):
        spots = dict(clim_obj["spots"])
    # Gather per-spot samples across all frames of this run.
    # ★ AND THE COORDINATE, because a spot_id-only blob cannot answer the question the POINT
    # endpoint asks. `/api/weather/point` is keyed by a COORDINATE and has no spot identity, so it
    # served the per-CELL reference from `grid_size_climatology` while the glyph used the per-SPOT
    # one from here — measured a median 21.3% apart (max 52.5%), which is the whole of queue item
    # E#1. Carrying lat/lng makes this blob answerable BY COORDINATE (`reference_for_coordinate`),
    # so the coordinate-keyed lane can reach the same number the spot-keyed lane uses.
    # ⚠️ The frames already carry it — `spot_ratings.rate_one_spot` emits `latitude`/`longitude` on
    # every record — so this is a re-use, not a new derivation, and costs one dict read per spot.
    by_spot, coords = {}, {}
    for fr in frames or []:
        for s in (fr.get("spots") or []):
            sid = s.get("spot_id")
            h = s.get("surf_height_m")
            if sid is None or h is None:
                continue
            by_spot.setdefault(str(sid), []).append(h)
            la, ln = s.get("latitude"), s.get("longitude")
            if la is not None and ln is not None:
                coords[str(sid)] = (la, ln)
    for sid, samples in by_spot.items():
        rec = spots.get(sid) if isinstance(spots.get(sid), dict) else {}
        prev = rec                                   # keep the OLD coordinate if this run has none
        rec = {"hist": merge_samples(rec.get("hist"), samples)}
        rec["n"] = hist_count(rec["hist"])
        # ⚠️ This function REBUILDS the record rather than mutating it, so anything not copied here
        # is dropped every cycle. The coordinate must therefore survive explicitly — and fall back
        # to the previous value, or a run whose frames happen to omit lat/lng would silently strip
        # coordinates the blob already had and quietly disable the coordinate lane.
        latlng = coords.get(sid) or (prev.get("lat"), prev.get("lng"))
        if latlng[0] is not None and latlng[1] is not None:
            rec["lat"], rec["lng"] = latlng
        spots[sid] = rec
    from datetime import datetime, timezone
    return {"schema_version": SCHEMA_VERSION, "updated_at": datetime.now(timezone.utc).isoformat(),
            "spots": spots}


# ── The INBOX — how any process other than the single writer contributes histograms ─────────────────
#
# MEASURED 2026-07-30: a workstation backfill read-modify-wrote this blob with a verify-after-upload
# race guard, watched the guard fire and recover — and was erased anyway within the hour. Multi-
# writer read-modify-write on one key cannot be made safe by checking harder. The contract is now:
# THE PRECOMPUTE CRON IS THE ONLY WRITER of size_climatology.json. Everyone else drops a batch in
# the inbox (`spot_ratings/climatology_inbox/<batch_id>.json`, shape {"batch_id", "spots": {sid:
# {"hist": [...], ...markers}}}); the cron folds pending batches into the blob inside its own
# single-writer cycle, records the batch_id, and deletes the consumed object. Fold-in is bin-wise
# additive; non-hist keys on a batch's spot record (backfill/era5 markers) are carried onto the
# blob record so resume filters keep working.
INBOX_PREFIX = "spot_ratings/climatology_inbox/"
_MERGED_BATCH_IDS_KEEP = 200


def _l2_env():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    return (base, key) if base and key else (None, None)


def list_inbox_keys() -> list:
    base, key = _l2_env()
    if not base:
        return []
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        resp = requests.post(
            f"{base}/storage/v1/object/list/{WEATHER_BUCKET}",
            headers={"Authorization": f"Bearer {key}", "apikey": key},
            json={"prefix": INBOX_PREFIX, "limit": 100}, timeout=15)
        if resp.status_code != 200:
            return []
        return [INBOX_PREFIX + row["name"] for row in resp.json()
                if isinstance(row, dict) and row.get("name", "").endswith(".json")]
    except Exception as e:
        logger.debug(f"[size-climatology] inbox list failed: {e}")
        return []


def delete_inbox_key(l2_key: str) -> bool:
    base, key = _l2_env()
    if not base:
        return False
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        resp = requests.delete(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{l2_key}",
                               headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=15)
        return resp.status_code in (200, 204)
    except Exception:
        return False


def merge_inbox_into_climatology(clim_obj: dict) -> tuple:
    """Fold every pending inbox batch into the climatology object. Returns (clim_obj,
    consumed_keys). Dedupe: a batch_id already in clim_obj['merged_batches'] is consumed (deleted)
    without re-folding, so a failed delete cannot double-count a batch."""
    merged_ids = list(clim_obj.get("merged_batches") or [])
    consumed = []
    for l2_key in list_inbox_keys():
        batch = load_size_climatology_l2(l2_key)
        if not isinstance(batch, dict) or not isinstance(batch.get("spots"), dict):
            consumed.append(l2_key)          # malformed — consume so it cannot wedge the inbox
            continue
        bid = batch.get("batch_id") or l2_key
        if bid in merged_ids:
            consumed.append(l2_key)
            continue
        spots = clim_obj.setdefault("spots", {})
        for sid, rec in batch["spots"].items():
            if not isinstance(rec, dict) or not isinstance(rec.get("hist"), list):
                continue
            existing = spots.get(str(sid)) if isinstance(spots.get(str(sid)), dict) else {}
            old_hist = existing.get("hist") if isinstance(existing.get("hist"), list) else empty_hist()
            if len(old_hist) != N_BINS or len(rec["hist"]) != N_BINS:
                continue
            entry = dict(existing)
            entry["hist"] = [a + b for a, b in zip(old_hist, rec["hist"])]
            entry["n"] = hist_count(entry["hist"])
            for k, v in rec.items():          # carry markers (backfill / era5 / ...)
                if k not in ("hist", "n"):
                    entry[k] = v
            spots[str(sid)] = entry
        merged_ids.append(bid)
        consumed.append(l2_key)
        logger.info("[size-climatology] inbox batch folded: %s (%d spots)", bid, len(batch["spots"]))
    clim_obj["merged_batches"] = merged_ids[-_MERGED_BATCH_IDS_KEEP:]
    return clim_obj, consumed


def upload_inbox_batch(store, batch_id: str, spots: dict) -> str:
    """For scripts: contribute histograms WITHOUT touching the blob. Returns the inbox key."""
    l2_key = f"{INBOX_PREFIX}{batch_id}.json"
    data = json.dumps({"batch_id": batch_id, "spots": spots},
                      separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(l2_key, data)
    return l2_key


# ── L2 persistence (mirrors spot_ratings load/upload) ───────────────────────────────────────────────
def upload_size_climatology_l2(store, obj) -> None:
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(SIZE_CLIMATOLOGY_L2_KEY, data)


_l2_cache = {"obj": None, "ts": 0.0}


def load_size_climatology_l2_cached(ttl: float = 600.0) -> Optional[dict]:
    import time
    now = time.time()
    if _l2_cache["obj"] is not None and (now - _l2_cache["ts"]) < ttl:
        return _l2_cache["obj"]
    obj = load_size_climatology_l2()
    _l2_cache["obj"] = obj
    _l2_cache["ts"] = now
    return obj


def load_size_climatology_l2(l2_key: str = None) -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{l2_key or SIZE_CLIMATOLOGY_L2_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception as e:
        logger.debug(f"[size-climatology] L2 load failed: {e}")
        return None
