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
import os
from typing import Optional

logger = logging.getLogger(__name__)

SIZE_CLIMATOLOGY_L2_KEY = "spot_ratings/size_climatology.json"
SCHEMA_VERSION = 1

# Histogram: 25 bins over [0, 5) m at 0.2 m each (breaking heights above 5 m clamp into the top bin).
BIN_WIDTH_M = 0.2
N_BINS = 25
_HMIN_RIDEABLE_M = 0.2                 # mirror surf_rating._HMIN_RIDEABLE_M — samples <= this are excluded
REF_PERCENTILE = 0.80                  # p80 of surfable-day heights = the spot's "good day" size
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
    """The p-quantile (0..1) breaking height from a histogram, using bin UPPER edges (conservative — the
    'good day' is at least this big). None if the histogram is empty."""
    total = hist_count(hist)
    if total <= 0:
        return None
    target = p * total
    cum = 0
    for i, c in enumerate(hist):
        cum += c
        if cum >= target:
            return round((i + 1) * BIN_WIDTH_M, 3)   # upper edge of the bin the quantile falls in
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


def merge_frames_into_climatology(clim_obj: Optional[dict], frames) -> dict:
    """Fold the breaking heights from a precompute run's frames ([{spots:[{spot_id, surf_height_m}...]}]) into
    the rolling per-spot histograms. Returns the updated climatology object (schema-versioned)."""
    spots = {}
    if clim_obj and isinstance(clim_obj.get("spots"), dict):
        spots = dict(clim_obj["spots"])
    # Gather per-spot samples across all frames of this run.
    by_spot = {}
    for fr in frames or []:
        for s in (fr.get("spots") or []):
            sid = s.get("spot_id")
            h = s.get("surf_height_m")
            if sid is None or h is None:
                continue
            by_spot.setdefault(str(sid), []).append(h)
    for sid, samples in by_spot.items():
        rec = spots.get(sid) if isinstance(spots.get(sid), dict) else {}
        rec = {"hist": merge_samples(rec.get("hist"), samples)}
        rec["n"] = hist_count(rec["hist"])
        spots[sid] = rec
    from datetime import datetime, timezone
    return {"schema_version": SCHEMA_VERSION, "updated_at": datetime.now(timezone.utc).isoformat(),
            "spots": spots}


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


def load_size_climatology_l2() -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{SIZE_CLIMATOLOGY_L2_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception as e:
        logger.debug(f"[size-climatology] L2 load failed: {e}")
        return None
