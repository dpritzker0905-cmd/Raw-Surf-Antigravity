"""
rating_confirmation.py — the Good/Epic OBSERVATION GATE + light user-report weigh-in (rating plan Step 4).

Industry grounding (Surfline, researched 2026-07-12): their MODEL tops out at fair-to-good — Good and
Epic are only awarded when a human forecaster verifies conditions, and ratings are relative to each
spot's potential. We hybridize that (user decision 2026-07-12): the BACKEND plays the forecaster —
scores above the good threshold are CAPPED unless a confirmation exists — and confirmations come from
two sources:

  1. INTERNAL corroboration (the "virtual forecaster"): independent model agreement. The precompute
     rates every spot with GFS + EURO + ICON; when >= 2 models INDEPENDENTLY score a spot good/epic at
     the same hour, that hour's rating may say so. One model's spike stays capped (single-model
     over-excitement is exactly what the cap is for).
  2. USER CONDITION REPORTS (the app's surf_reports: 1-5 stars, per spot): a FRESH report (<= 12 h)
     with >= 4 stars confirms good; 5 stars confirms epic. Reports are the human observation Surfline
     gates on — photographers/surfers on the beach.

Reports ALSO nudge the score — LIGHTLY (user: "science heavy, reports light"): 30% of the gap between
the fresh-report consensus and the model score, clamped to +-8 points (about half a level), decaying
with report age. The model remains the baseline; a report can shade a rating, never rewrite it.

Pure helpers (no I/O, unit-tested; JS mirror carries observation_gate for the frontend infobox path)
+ a thin REST fetch for the runner. Everything is inert until RATING_OBS_GATE=1 at the wiring sites.
"""
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Score thresholds mirror surf_rating._BUCKETS: good begins at 70, epic at 84.
GOOD_T = 70.0
EPIC_T = 84.0
CAP_UNCONFIRMED = GOOD_T - 0.1     # 69.9 -> tops out displaying fair_good (Surfline's model ceiling)
CAP_GOOD = EPIC_T - 0.1            # 83.9 -> may display good, not epic
AGREE_MODELS = 2                   # internal confirmation: >= 2 of the 3 models agree
# Models are precomputed independently and land on DIFFERENT hours (measured: GFS 15/18, EURO+ICON
# 13/16), so cross-model agreement is joined on the NEAREST frame within this window rather than an
# exact valid_time. Set to the frame spacing (SPOT_RATINGS_PRECOMPUTE_HOURS='0,3'). See
# apply_gate_to_frames for the measurement that forced it.
CONFIRM_TIME_TOLERANCE_H = 3.0
REPORT_FRESH_H = 12.0              # a beach observation speaks for about half a day
REPORT_CONFIRM_GOOD_STARS = 4
REPORT_CONFIRM_EPIC_STARS = 5
REPORT_NUDGE_K = 0.30              # light weight: 30% of the report-vs-model gap...
REPORT_NUDGE_MAX = 8.0             # ...never more than ~half a level either way
# Star -> score anchor (level-bucket midpoints): what a 1..5-star report "says" on the 0-100 scale.
STAR_SCORE = {1: 20.0, 2: 35.0, 3: 49.0, 4: 70.0, 5: 90.0}

_CONFIRM_RANK = {None: 0, "good": 1, "epic": 2}


def observation_gate(score, confirm=None):
    """Cap a 0-100 score by confirmation level: None -> 69.9 (fair_good ceiling), 'good' -> 83.9,
    'epic' -> uncapped. None scores pass through. The cap changes the DISPLAYED verdict, not the
    underlying physics — raw scores stay auditable upstream."""
    if score is None:
        return None
    if confirm == "epic":
        return score
    cap = CAP_GOOD if confirm == "good" else CAP_UNCONFIRMED
    return round(min(float(score), cap), 1)


def confirmation_for(lat, lng, valid_time, max_km: float = 2.0):
    """Best-effort `confirmed` level for one spot+hour, read from the PRECOMPUTED L2 ratings object.

    WHY IT READS RATHER THAN RECOMPUTES. `internal_confirmation` needs >= 2 of the 3 models' scores
    for the same spot+hour. Computing those live is 3x the rating work on a 1-CPU serve box with a
    three-incident melt history, so the single-model surfaces (spot hub, weather sim) read the
    confirmation the precompute already derived instead of deriving it again.

    ⚠️ RETURNS None ON EVERY MISS, AND THAT IS THE CORRECT FAILURE MODE — not a fallback that
    weakens the gate. Measured live 2026-07-31 over 999 spot-hours (4 regions x 3 forecast hours),
    the SERVING lane itself carries `confirmed=None` for 97.9% of spots, and capping-on-None is
    exactly what the map glyphs already do. So a surface that cannot find confirmation lands on the
    SAME verdict the map shows. Failing toward AGREEMENT is the whole point of gating here (#13):
    the defect was the hub and sim disagreeing with the map, and a miss cannot re-open it.

    Matched on POSITION, not spot_id: the sim and the hub can be asked about a coordinate that is
    not a catalogued spot at all, and `_HAVERSINE_KM` within `max_km` is the same tolerance the
    ratings lane uses to call two coordinates the same break.
    """
    try:
        from services.weather_pipeline.spot_ratings import load_spot_ratings_l2_cached
        obj = load_spot_ratings_l2_cached()
        frames = (obj or {}).get("frames") or []
        if not frames:
            return None
        target = _parse_time(valid_time) if not isinstance(valid_time, datetime) else valid_time
        if target is None:
            return None
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        best_frame, best_gap = None, None
        for fr in frames:
            t = _parse_time(fr.get("valid_time"))
            if t is None:
                continue
            gap = abs((t - target).total_seconds())
            if gap > CONFIRM_TIME_TOLERANCE_H * 3600 + 1:
                continue
            if best_gap is None or gap < best_gap:
                best_frame, best_gap = fr, gap
        if best_frame is None:
            return None
        best, best_km = None, None
        for s in best_frame.get("spots") or []:
            slat, slng = s.get("latitude"), s.get("longitude")
            if slat is None or slng is None:
                continue
            km = _haversine_km(float(lat), float(lng), float(slat), float(slng))
            if km <= max_km and (best_km is None or km < best_km):
                best, best_km = s, km
        return (best or {}).get("confirmed")
    except Exception as e:                       # a confirmation LOOKUP must never break a rating
        logger.debug(f"[obs gate] confirmation lookup failed at ({lat},{lng}): {e!r}")
        return None


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def gate_single_model_surface(score, lat, lng, valid_time):
    """THE ONE ENTRY POINT for a surface that computes ONE model's rating and must display what the
    app displays (#13, owner decision 2026-07-31: the hub and the sim answer "what will the app
    show", not "what does the model say").

    Returns (gated_score, level, confirmed, raw_score) so the caller can publish the capped verdict
    AND keep the ungated one auditable — `observation_gate`'s contract is that the cap changes the
    DISPLAYED verdict, never the underlying physics.

    ⚠️ THIS IS A POST-`rating_score` STEP, which is precisely the shape
    `test_rating_composition_parity.py` cannot see: that guard AST-extracts the rating CALL and
    checks its arguments, so a step applied AFTER the call has no argument to declare (#14). The
    POST-step registry in that file is what watches this one; add any future post-step there too.
    """
    from services.weather_pipeline.surf_rating import score_to_level
    if score is None:
        return None, None, None, None
    confirm = confirmation_for(lat, lng, valid_time)
    gated = observation_gate(score, confirm)
    return gated, score_to_level(gated), confirm, round(float(score), 1)


def combine_confirmations(a, b):
    """The stronger of two confirmation levels (None < 'good' < 'epic')."""
    return a if _CONFIRM_RANK.get(a, 0) >= _CONFIRM_RANK.get(b, 0) else b


def internal_confirmation(scores_by_model):
    """The virtual forecaster: UNGATED scores for one spot+hour keyed by model. >= AGREE_MODELS models
    at/above the epic threshold -> 'epic'; at/above good -> 'good'; else None. Ignores None scores."""
    vals = [float(s) for s in (scores_by_model or {}).values() if s is not None]
    if sum(1 for v in vals if v >= EPIC_T) >= AGREE_MODELS:
        return "epic"
    if sum(1 for v in vals if v >= GOOD_T) >= AGREE_MODELS:
        return "good"
    return None


def _parse_time(value):
    """An ISO timestamp as an aware datetime, or None. Used to join frames across models by time.

    Returns None rather than raising: a frame with an unparseable valid_time must not take down a
    precompute upload. It simply finds no cross-model peers and stays capped, which is the safe
    direction for a gate whose whole job is to withhold the top two levels."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _report_age_h(rep, now):
    created = rep.get("created_at")
    if isinstance(created, str):
        try:
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except Exception:
            return None
    if not isinstance(created, datetime):
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (now - created).total_seconds() / 3600.0


def fresh_reports(reports, now=None, fresh_h: float = REPORT_FRESH_H):
    """The subset of report dicts ({rating, created_at}) younger than ``fresh_h``, each annotated with
    ``_age_h``. Malformed entries are dropped."""
    now = now or datetime.now(timezone.utc)
    out = []
    for rep in reports or []:
        if not isinstance(rep, dict):
            continue
        age = _report_age_h(rep, now)
        if age is None or age < 0 or age > fresh_h:
            continue
        r = rep.get("rating")
        if r is None:
            continue
        try:
            r = int(r)
        except (TypeError, ValueError):
            continue
        if not (1 <= r <= 5):
            continue
        out.append({**rep, "rating": r, "_age_h": age})
    return out


def report_confirmation(reports, now=None):
    """Human observation: any fresh report at 5 stars -> 'epic'; >= 4 stars -> 'good'; else None."""
    best = None
    for rep in fresh_reports(reports, now):
        if rep["rating"] >= REPORT_CONFIRM_EPIC_STARS:
            return "epic"
        if rep["rating"] >= REPORT_CONFIRM_GOOD_STARS:
            best = "good"
    return best


def report_nudge(score, reports, now=None):
    """The LIGHT weigh-in: freshness-weighted mean of the fresh reports' star anchors vs the model
    score -> clamp(K * gap, +-MAX). 0.0 when the score is None or no fresh reports exist."""
    if score is None:
        return 0.0
    fresh = fresh_reports(reports, now)
    if not fresh:
        return 0.0
    wsum = vsum = 0.0
    for rep in fresh:
        w = 1.0 - (rep["_age_h"] / REPORT_FRESH_H)      # linear decay to 0 at the freshness horizon
        w = max(w, 0.05)
        vsum += w * STAR_SCORE.get(rep["rating"], 49.0)
        wsum += w
    consensus = vsum / wsum
    nudge = REPORT_NUDGE_K * (consensus - float(score))
    return round(max(-REPORT_NUDGE_MAX, min(REPORT_NUDGE_MAX, nudge)), 2)


# ── runner-side REST fetch (mirrors fetch_active_spots_via_rest — Storage key authorizes PostgREST) ──
def fetch_recent_reports_via_rest(fresh_h: float = REPORT_FRESH_H, limit: int = 2000) -> dict:
    """{spot_id: [{rating, created_at}, ...]} for reports younger than ``fresh_h``. Empty dict on any
    failure — the gate then simply has no report signal (internal corroboration still applies)."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return {}
    try:
        import requests
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=fresh_h)).isoformat()
        url = (f"{base}/rest/v1/surf_reports?select=spot_id,rating,created_at"
               f"&created_at=gte.{cutoff}&rating=not.is.null&limit={limit}")
        resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=20)
        resp.raise_for_status()
        by_spot = {}
        for row in resp.json():
            sid = row.get("spot_id")
            if sid is None:
                continue
            by_spot.setdefault(str(sid), []).append({"rating": row.get("rating"),
                                                     "created_at": row.get("created_at")})
        return by_spot
    except Exception as e:
        logger.warning(f"[rating-confirmation] recent-reports fetch failed (gate runs report-less): {e}")
        return {}


def apply_gate_to_frames(frames, reports_by_spot, now=None) -> int:
    """Mutate precomputed frames ([{model, valid_time, spots:[...]}]) with the observation gate +
    light report weigh-in. Per (spot, valid_time): internal confirmation from the CROSS-MODEL ungated
    scores in these same frames, combined with the spot's fresh-report confirmation; then
    score -> gate(score + nudge). Adds per-spot ``raw_score`` (audit), ``confirmed`` (level|None) and
    updates ``score``/``level``. Returns the number of spot entries whose displayed level was capped."""
    from services.weather_pipeline.surf_rating import score_to_level

    # IDEMPOTENT base (2026-07-13, checkpoint merge-uploads): the precompute now re-applies this
    # gate at EVERY per-model checkpoint, so already-gated frames (raw_score stamped) come through
    # again. Always gate from the ORIGINAL raw — reading `score` on a second pass would re-add the
    # nudge on top of the gated value (compounding) and overwrite raw_score with a gated score
    # (corrupting the audit trail). gate(raw) is stable across any number of applications.
    def _raw_of(s):
        return s.get("raw_score") if s.get("raw_score") is not None else s.get("score")

    # Cross-model index of UNGATED scores, joined on the NEAREST valid_time per model rather than an
    # exact match.
    #
    # ⚠️⚠️ THE EXACT JOIN WAS WRONG AND SILENTLY SEVERE. The models are precomputed independently and
    # land on DIFFERENT hours — measured 2026-07-30 on the live blob: GFS at 15:00/18:00, EURO and
    # ICON at 13:00/16:00. GFS therefore shared a valid_time with nobody, 50% of spot-hours had
    # exactly one model available, and **59.9% of all good/epic scores were capped for want of a peer
    # frame**. That is not the gate doing its job. Absence of a peer is not evidence of disagreement,
    # and capping on it would have made the SAME spot in the SAME conditions read differently
    # depending on which model the user had selected.
    #
    # Tolerance is the frame spacing (SPOT_RATINGS_PRECOMPUTE_HOURS is '0,3'), so each model is
    # compared against its closest opinion and never against a frame further away than the ladder's
    # own step. Measured: capping falls 59.9% -> 24.9%, and the +/-2h and +/-3h results differ by 6
    # spot-hours, so this sits on a plateau rather than a knife edge. Swell height and period - what
    # actually drives the score - are coherent over a couple of hours; the join is not.
    by_spot = {}
    for fr in frames or []:
        vt = _parse_time(fr.get("valid_time"))
        for s in fr.get("spots") or []:
            if _raw_of(s) is None or vt is None:
                continue
            by_spot.setdefault(s.get("spot_id"), []).append((fr.get("model"), vt, _raw_of(s)))

    def _peers(spot_id, model, when):
        """Nearest raw score from each OTHER model within the tolerance, as {model: score}."""
        best = {}
        for other, t, sc in by_spot.get(spot_id, ()):
            if other == model or when is None:
                continue
            gap = abs((t - when).total_seconds())
            if gap > CONFIRM_TIME_TOLERANCE_H * 3600 + 1:
                continue
            if other not in best or gap < best[other][0]:
                best[other] = (gap, sc)
        return {k: v[1] for k, v in best.items()}

    n_capped = 0
    for fr in frames or []:
        for s in fr.get("spots") or []:
            raw = _raw_of(s)
            if raw is None:
                continue
            reports = (reports_by_spot or {}).get(str(s.get("spot_id")))
            # This model's own score counts toward the >= 2 agreement, alongside its nearest peers.
            scores = dict(_peers(s.get("spot_id"), fr.get("model"), _parse_time(fr.get("valid_time"))))
            scores[fr.get("model")] = raw
            confirm = combine_confirmations(
                internal_confirmation(scores),
                report_confirmation(reports, now),
            )
            nudged = float(raw) + report_nudge(raw, reports, now)
            gated = observation_gate(nudged, confirm)
            s["raw_score"] = raw
            s["confirmed"] = confirm
            s["score"] = gated
            s["level"] = score_to_level(gated)
            if gated is not None and nudged > gated:
                n_capped += 1
    return n_capped
