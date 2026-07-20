"""
report_calibration.py — FORWARD calibration of the surf RATING against surfers' logged conditions (P5).

Buoys validate the OFFSHORE model (buoy_calibration.py); this validates the RATING itself — the thing we want
to be good — against ground truth surfers actually report: ``surf_log_entries.conditions_rating`` (1-5 ★) and
``wave_height``. The catch: those reports are HISTORICAL while the serve box holds only the CURRENT forecast,
so we can't compare retrospectively. The fix is a FORWARD loop:

  1. SNAPSHOT — each cron cycle, append the current per-spot rating predictions (score + surf height + valid
     time) to a rolling L2 archive (pruned to a few weeks).
  2. MATCH — read recent logged sessions (Supabase REST) and pair each with the archived prediction for the
     SAME spot nearest the session time.
  3. AGGREGATE — star/height MAE + bias (model minus observed) → an L2 report read at /api/weather/report-calibration.

Bias > 0 ⇒ the model rates HIGHER than surfers (systematic over-rating) → the signal to retune (NOT done here;
measure first). Pure helpers are unit-tested; the runner is flag-gated (REPORT_CALIBRATION) for the CI runner.
"""
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

REPORT_CAL_REPORT_KEY = "calibration/report_latest.json"
PREDICTION_ARCHIVE_KEY = "calibration/prediction_archive.json"
SCHEMA_VERSION = 1
FT_PER_M = 3.28084
ARCHIVE_MAX_AGE_DAYS = 21          # keep ~3 weeks of predictions to match against incoming reports
ARCHIVE_MAX_ENTRIES = 60000        # hard cap (prune oldest) so the L2 object can't grow unbounded
MATCH_TOLERANCE_S = 6 * 3600       # ±6h: session_time is local/imprecise + spot ratings move slowly hour-to-hour

# Surf-height word labels → representative feet (body-height scale used in surf reports).
_HEIGHT_LABELS = [
    ("double overhead", 11.0), ("triple overhead", 16.0), ("overhead", 7.0), ("head high", 5.5),
    ("head", 5.5), ("shoulder", 4.5), ("chest", 4.0), ("stomach", 3.5), ("waist", 3.0),
    ("thigh", 2.0), ("knee", 1.5), ("ankle", 0.5), ("flat", 0.0),
]


def parse_observed_height_m(text) -> Optional[float]:
    """Parse an observed surf height (``wave_height``/``conditions_label``) to METRES. Handles numeric ranges
    ('3-4ft' → 3.5 ft), single values ('2ft', '1.5'), and body-height labels ('Waist High', 'Overhead').
    Returns None when nothing usable is found."""
    if not text or not isinstance(text, str):
        return None
    t = text.strip().lower()
    if not t:
        return None
    # numeric range "a-b" or single "a" (optional 'ft'/'m'); ranges → midpoint
    nums = re.findall(r"\d+(?:\.\d+)?", t)
    if nums:
        vals = [float(n) for n in nums[:2]]
        v = sum(vals) / len(vals)
        return round(v / FT_PER_M, 3) if "m" not in t or "ft" in t else round(v, 3)  # default unit = feet
    for label, ft in _HEIGHT_LABELS:                # word labels
        if label in t:
            return round(ft / FT_PER_M, 3)
    return None


def score_to_stars(score) -> Optional[float]:
    """Map the model's 0-100 surf-quality score to the 1-5 ★ scale surfers log (linear; 0→1, 100→5)."""
    if score is None:
        return None
    return round(1.0 + 4.0 * max(0.0, min(100.0, score)) / 100.0, 2)


def _parse_dt(s):
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def report_datetime(session_date, session_time):
    """Combine a log entry's session_date ('2026-06-28') + optional session_time ('06:30') into an aware UTC
    datetime (session_time is local & tz-unknown → treated as UTC; the ±6h match window absorbs the slop).
    Defaults a missing time to midday. Returns None if the date can't be parsed."""
    if not session_date:
        return None
    d = _parse_dt(session_date if "T" in str(session_date) else f"{session_date}T00:00:00Z")
    if d is None:
        return None
    hh, mm = 12, 0
    if session_time and isinstance(session_time, str):
        m = re.match(r"\s*(\d{1,2}):(\d{2})", session_time)
        if m:
            hh, mm = int(m.group(1)), int(m.group(2))
    return d.replace(hour=min(23, hh), minute=min(59, mm), second=0, microsecond=0)


def normalize_report(row) -> Optional[dict]:
    """Normalize a surf_log_entries row to {spot_id, time(dt), observed_rating(1-5|None), observed_height_m}.
    Returns None if it has neither a usable rating nor a height (nothing to calibrate against), or no spot/time."""
    spot_id = row.get("spot_id")
    if not spot_id:
        return None
    t = report_datetime(row.get("session_date"), row.get("session_time"))
    if t is None:
        return None
    rating = row.get("conditions_rating")
    rating = float(rating) if isinstance(rating, (int, float)) and 1 <= rating <= 5 else None
    height = parse_observed_height_m(row.get("wave_height"))
    if rating is None and height is None:
        return None
    return {"spot_id": str(spot_id), "time": t, "observed_rating": rating, "observed_height_m": height}


def match_reports(reports, archive_entries, tolerance_s: float = MATCH_TOLERANCE_S):
    """PURE: pair each normalized report with the SAME-spot archived prediction nearest in time (within
    tolerance). archive_entries: [{spot_id, valid_time, score, surf_height_m}]. Returns [(report, prediction)].
    Indexes the archive by spot for efficiency. Reports with no in-tolerance prediction are dropped."""
    by_spot = {}
    for e in archive_entries or []:
        vt = _parse_dt(e.get("valid_time"))
        if vt is None:
            continue
        by_spot.setdefault(str(e.get("spot_id")), []).append((vt, e))
    pairs = []
    for r in reports or []:
        cands = by_spot.get(r["spot_id"])
        if not cands:
            continue
        best, best_d = None, None
        for vt, e in cands:
            d = abs((vt - r["time"]).total_seconds())
            if best_d is None or d < best_d:
                best, best_d = e, d
        if best is not None and best_d <= tolerance_s:
            pairs.append((r, best))
    return pairs


def compare_pair(report, prediction) -> dict:
    """PURE: residuals (model − observed) for one matched (report, prediction). star_err uses the model score→
    stars vs the logged 1-5; height_err the model surf height vs the observed. Each side None when unavailable."""
    pred_stars = score_to_stars(prediction.get("score"))
    obs_rating = report.get("observed_rating")
    pred_h = prediction.get("surf_height_m")
    obs_h = report.get("observed_height_m")
    out = {"spot_id": report["spot_id"], "report_time": report["time"].isoformat(),
           "obs_rating": obs_rating, "pred_stars": pred_stars,
           "star_err": None, "abs_star_err": None,
           "obs_height_m": obs_h, "pred_height_m": pred_h, "height_err_m": None, "abs_height_err_m": None}
    if pred_stars is not None and obs_rating is not None:
        out["star_err"] = round(pred_stars - obs_rating, 2)
        out["abs_star_err"] = round(abs(pred_stars - obs_rating), 2)
    if pred_h is not None and obs_h is not None:
        out["height_err_m"] = round(pred_h - obs_h, 3)
        out["abs_height_err_m"] = round(abs(pred_h - obs_h), 3)
    return out


def aggregate_pairs(pairs) -> dict:
    """PURE: roll matched pairs into star + height MAE/bias + counts. Bias > 0 ⇒ model rates HIGHER than logged."""
    s_abs, s_signed, h_abs, h_signed = [], [], [], []
    for report, pred in pairs or []:
        c = compare_pair(report, pred)
        if c["abs_star_err"] is not None:
            s_abs.append(c["abs_star_err"]); s_signed.append(c["star_err"])
        if c["abs_height_err_m"] is not None:
            h_abs.append(c["abs_height_err_m"]); h_signed.append(c["height_err_m"])
    def _mean(xs):
        return round(sum(xs) / len(xs), 3) if xs else None
    return {
        "n_matched": len(pairs or []),
        "star_mae": _mean(s_abs), "star_bias": _mean(s_signed), "star_n": len(s_abs),
        "height_mae_m": _mean(h_abs), "height_bias_m": _mean(h_signed), "height_n": len(h_abs),
        "height_mae_ft": round(_mean(h_abs) * FT_PER_M, 2) if h_abs else None,
    }


def prune_archive(entries, now=None, max_age_days: int = ARCHIVE_MAX_AGE_DAYS, max_entries: int = ARCHIVE_MAX_ENTRIES):
    """PURE: drop predictions older than max_age_days, then cap to the most-recent max_entries. Tolerant of
    malformed rows (kept only if their valid_time parses and is in-window)."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max_age_days)
    kept = []
    for e in entries or []:
        vt = _parse_dt(e.get("valid_time"))
        if vt is not None and vt >= cutoff:
            kept.append((vt, e))
    kept.sort(key=lambda x: x[0])
    if len(kept) > max_entries:
        kept = kept[-max_entries:]
    return [e for _, e in kept]


# ── L2 persistence (mirrors buoy_calibration / spot_ratings) ──
def _load_l2(key) -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    k = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not k:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {k}", "apikey": k}, timeout=10)
        return resp.json() if resp.status_code == 200 else None
    except Exception as e:
        logger.debug(f"[report-calibration] L2 load {key} failed: {e}")
        return None


def _upload_l2(store, key, obj) -> None:
    import json
    store._upload_to_supabase(key, json.dumps(obj, separators=(",", ":")).encode("utf-8"))


_report_cache = {"obj": None, "ts": 0.0}


def load_report_calibration_cached(ttl: float = 300.0) -> Optional[dict]:
    import time
    now = time.time()
    if _report_cache["obj"] is not None and (now - _report_cache["ts"]) < ttl:
        return _report_cache["obj"]
    _report_cache["obj"] = _load_l2(REPORT_CAL_REPORT_KEY)
    _report_cache["ts"] = now
    return _report_cache["obj"]


def fetch_recent_reports_via_rest(days: int = ARCHIVE_MAX_AGE_DAYS, limit: int = 5000) -> list:
    """Read recent surf_log_entries (with a spot + a rating or a height) via Supabase REST."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return []
    import requests
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    url = (f"{base}/rest/v1/surf_log_entries"
           f"?select=spot_id,session_date,session_time,wave_height,conditions_rating"
           f"&spot_id=not.is.null&session_date=gte.{since}&order=session_date.desc&limit={limit}")
    resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def run_report_calibration() -> tuple:
    """CI entry (flag-gated by caller): (1) snapshot current per-spot predictions → append to the rolling L2
    archive (pruned); (2) match recent logged sessions to the archive; (3) upload the residual report. Returns
    (n_archived, n_matched). Model via REPORT_CALIBRATION_MODEL (default GFS)."""
    import asyncio
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.spot_ratings import (
        fetch_active_spots_via_rest, _make_point_resolver, _top_of_hour_utc, rate_one_spot)

    model = os.environ.get("REPORT_CALIBRATION_MODEL", "GFS").strip().upper()
    valid_time = _top_of_hour_utc().strftime("%Y-%m-%dT%H:00:00Z")
    # BOUND the snapshot so this can't blow the cron's job budget: cap the spot count and wall-clock the rating
    # pass (partial archive is fine — it accrues over cycles). The cap is the safety guard for a step added to
    # every cron cycle on an as-yet-unproven resolver-in-CI path.
    max_spots = max(1, int(os.environ.get("REPORT_CALIBRATION_MAX_SPOTS", "2000")))
    budget_s = float(os.environ.get("REPORT_CALIBRATION_BUDGET_S", "600"))
    spots = fetch_active_spots_via_rest()[:max_spots]

    # (1) snapshot — rate the (capped) spot set now, keep the compact prediction fields.
    new_entries = []
    if spots:
        resolver = _make_point_resolver()
        sem = asyncio.Semaphore(8)

        async def _one(sp):
            async with sem:
                d = await rate_one_spot(resolver, sp, model, valid_time)
            if d.get("score") is None:
                return None
            return {"spot_id": d["spot_id"], "valid_time": valid_time,
                    "score": d["score"], "surf_height_m": d.get("surf_height_m")}

        try:
            # Deadline lives INSIDE _gather_snapshot now (asyncio.wait keeps completed
            # partials); the outer catch remains for loop-setup catastrophes only.
            rated = asyncio.run(_gather_snapshot(_one, spots, timeout=budget_s))
        except Exception as _se:
            logger.warning("[report-calibration] snapshot bounded/failed (%s) — archiving what's available.", _se)
            rated = []
        new_entries = [e for e in rated if e]

    store = ProductStore()
    archive = _load_l2(PREDICTION_ARCHIVE_KEY) or {"version": SCHEMA_VERSION, "entries": []}
    entries = prune_archive((archive.get("entries") or []) + new_entries)
    _upload_l2(store, PREDICTION_ARCHIVE_KEY,
               {"version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(), "entries": entries})

    # (2)+(3) match recent reports to the (now-updated) archive + upload the residual report.
    try:
        rows = fetch_recent_reports_via_rest()
    except Exception as e:
        logger.warning("[report-calibration] reports fetch failed: %s", e)
        rows = []
    reports = [r for r in (normalize_report(x) for x in rows) if r]
    pairs = match_reports(reports, entries)
    summary = aggregate_pairs(pairs)
    report = {"version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(),
              "model": model, "n_reports": len(reports), "n_archive": len(entries), "summary": summary,
              "residuals": [compare_pair(rp, pr) for rp, pr in pairs[:500]]}
    _upload_l2(store, REPORT_CAL_REPORT_KEY, report)
    logger.info("[report-calibration] archived %d (total %d), matched %d reports; star MAE %s.",
                len(new_entries), len(entries), summary["n_matched"], summary["star_mae"])
    return len(new_entries), summary["n_matched"]


async def _gather_snapshot(fn, spots, timeout=None):
    """PER-SPOT ISOLATION + DEADLINE PARTIALS (2026-07-20 bug-class sweep, the f9c5e59a
    blast-radius shape): the old bare ``asyncio.gather`` meant ONE raising spot discarded
    every completed snapshot (the caller's fallback logged "archiving what's available"
    and archived nothing), and the caller's outer ``wait_for`` CANCELLED the whole gather
    on timeout — zero entries, not the partial archive the budget comment promises.
    ``asyncio.wait`` keeps what finished by the deadline; a failed spot costs one spot."""
    import asyncio
    if not spots:
        return []
    tasks = [asyncio.ensure_future(fn(sp)) for sp in spots]
    done, pending = await asyncio.wait(tasks, timeout=timeout)
    for t in pending:
        t.cancel()
    if pending:
        logger.warning("[report-calibration] snapshot deadline: %d/%d spots unfinished (kept the rest).",
                       len(pending), len(tasks))
    out = []
    failed = 0
    for t in done:
        try:
            out.append(t.result())
        except Exception as e:
            failed += 1
            if failed <= 3:
                logger.warning("[report-calibration] spot snapshot failed: %s", e)
    if failed:
        logger.warning("[report-calibration] %d spot snapshot(s) failed; %d kept.", failed, len(out))
    return out
