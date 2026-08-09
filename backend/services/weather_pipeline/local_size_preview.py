"""local_size_preview.py — what happens if we flip RATING_LOCAL_SIZE?

WHY THIS EXISTS
---------------
`95c5f04a` (2026-07-11) landed local size calibration behind a flag and wrote the rollout plan into
its own commit message:

    "accumulation starts on the next ingest; once climatology is sane (FL spots get small refs,
     big-wave spots large), flip RATING_LOCAL_SIZE=1 and verify."

Eighteen days later the blob is 218 KB and updating six times a day, and the flag is still 0 —
because nothing could answer "is the climatology sane yet?" without a production credential and a
bespoke script. Meanwhile the owner reported Florida reading poor-to-fair on offshore-wind days,
which `sim_explain` traced to exactly this: `size_gate` 0.694, because 2.9 ft is being scored
against the GLOBAL 1.2 m reference. **The fix was built, gated, and forgotten.**

★★★ THE KEY INSIGHT THAT MAKES THIS CHEAP. `reference_size_m` enters the composite in exactly two
places — `size_score` and `oversize_gate` — and BOTH are multiplicative. So for a spot already rated
with the global default:

    score_local = score_global * (sg_local * og_local) / (sg_global * og_global)

That is EXACT, not an approximation, and it needs only the persisted `surf_height_m`. No weather is
re-fetched, no point is re-resolved: a full-catalogue A/B costs one blob read. The two `size_score`
branches share the same ~0.2 m rideability floor, so the denominator is zero only when the numerator
is too (both flat → score 0 either way → no change), and the ratio never divides by zero.

⚠️ THIS CHANGES NOTHING. It reads the current ratings and the climatology and reports what WOULD
happen. Flipping the flag is still a deliberate act.
"""
import logging
from typing import Any, Callable, Dict, List, Optional

from services.weather_pipeline.surf_rating import (
    oversize_gate, score_to_level, size_score,
)

logger = logging.getLogger(__name__)

# The acceptance criterion from the rollout plan, made checkable. A small-wave coast must come out
# with a SMALL reference and a big-wave coast with a LARGE one — if that inverts, the climatology is
# not sane and the flag must not be flipped, whatever the aggregate deltas look like.
SANITY_EXEMPLARS = [
    # (label, lat, lng, expect_max_m, expect_min_m) — generous bounds; this is a sanity check, not a
    # calibration. `None` means unbounded on that side.
    ("Florida east coast (Sebastian Inlet)", 27.8608, -80.4464, 1.1, None),
    ("Florida east coast (New Smyrna)", 29.0258, -80.9111, 1.1, None),
    ("Hawaii North Shore (Pipeline)", 21.6650, -158.0533, None, 1.5),
    ("California (Mavericks)", 37.4956, -122.5011, None, 1.5),
    ("Indonesia (Uluwatu)", -8.8148, 115.0880, None, 1.0),
]

# ⛔⛔ THESE BOUNDS ARE FROZEN AT THE PERCENTILE THEY WERE AUTHORED AGAINST — DO NOT WIDEN THEM.
# Verified from git objects 2026-08-09 (never from the docstring that asserted it):
#   d8635716 (07-29) authored the bounds above while REF_PERCENTILE = 0.80
#   e3aedb06 (07-30) moved REF_PERCENTILE 0.80 -> 0.50 and re-authored NOTHING here
# So an absolute metre bound written for a p80 population has been graded against a p50 one for ten
# days. It survived on luck: Pipeline sat EXACTLY on 1.5 (green 08-08T03:53 and red 08-08T09:19 both
# printed "ref=1.5 m" — same number, opposite verdict) until ordinary drift took it to 1.48, and the
# census then paged every run for a 1.3% miss of a bound that is ~21% too high in this frame
# (Pipeline at the authored p80 today: 1.81 m).
# ★★★ THE CLASS: A THRESHOLD OUTLIVES THE CALIBRATION OF ITS INPUT. Second independent instance.
# The answer is NOT a wider bound — a gate red every run is a gate nobody reads, and the next real
# inversion would be invisible inside the standing red. The answer is to page on the form of the
# claim that SURVIVES a percentile change, and to REFUSE to render an absolute verdict in a frame
# the bounds were not written for. Measured across the census's own sweep at HEAD:
#   pctl        0.50   0.65   0.80   0.85      spread
#   Pipeline    1.48   1.61   1.81   1.88      27.0%   <- the absolute bound's quantity
#   separation  1.72   1.68   1.65   1.61       6.6%   <- min(big-wave) / max(small-wave)
# The ordering ratio is ~4x more percentile-stable, and inversion — the thing this gate exists to
# catch — is a ratio claim, not a level claim: the blob that gives Florida 2.5 m and Pipeline 0.7 m
# scores 0.28 here at EVERY percentile.
SANITY_EXEMPLARS_AUTHORED_PCTL = 0.80

# DERIVED PER PAIR, never chosen. Each (small-wave, big-wave) pair carries the ratio its OWN authored
# bounds assert — `lo_big / hi_small` — and the report's scalar is the worst observed ratio divided by
# its authored one, so >= 1.0 means every pair is at least as separated as authored.
# ⚠️ A single min(lo)/max(hi) would have been WRONG and was caught before it ran: Uluwatu's generous
# 1.0 floor sits BELOW Florida's 1.1 ceiling, so that form yields 0.909 and would pass a genuine
# inversion. The authored table does not assert one global gap; it asserts one gap per pair.
def _authored_pairs():
    """(small_label, big_label, authored_ratio) for every ordering claim the bounds make."""
    smalls = [(lbl, hi) for lbl, _la, _ln, hi, lo in SANITY_EXEMPLARS if hi is not None and lo is None]
    bigs = [(lbl, lo) for lbl, _la, _ln, hi, lo in SANITY_EXEMPLARS if lo is not None and hi is None]
    return [(s_lbl, b_lbl, b_lo / s_hi) for s_lbl, s_hi in smalls for b_lbl, b_lo in bigs]


def _ratio(surf_h_m: Optional[float], ref: Optional[float],
           break_depth_m: Optional[float]) -> Optional[float]:
    """The exact multiplier the flip applies to this spot-hour's score, or None if undefined."""
    if surf_h_m is None or ref is None:
        return None
    sg_g = size_score(surf_h_m, None)
    sg_l = size_score(surf_h_m, ref)
    if sg_g <= 0.0:
        # Below the rideability floor BOTH branches return 0 -> the score is 0 either way.
        return 1.0 if sg_l <= 0.0 else None
    og_g = oversize_gate(surf_h_m, None, break_depth_m=break_depth_m)
    og_l = oversize_gate(surf_h_m, ref, break_depth_m=break_depth_m)
    denom = sg_g * og_g
    if denom <= 0.0:
        return None
    return (sg_l * og_l) / denom


def preview_impact(clim: Optional[dict], frames: List[dict], *,
                   reference_map_fn: Callable[[Optional[dict]], dict] = None,
                   break_depth_fn: Optional[Callable[[float, float], Optional[float]]] = None,
                   max_movers: int = 15) -> Dict[str, Any]:
    """A/B the RATING_LOCAL_SIZE flip across every persisted spot-hour.

    `frames` is `spot_ratings/latest.json`'s frame list. `reference_map_fn` maps the climatology blob
    to {spot_id: reference_m} (injected so this stays unit-testable with no I/O). `break_depth_fn`
    resolves a spot's break depth for the oversize gate — optional; omitting it is safe because the
    gate is inert well below a spot's capacity, but supplying it makes big-wave spots exact.
    """
    if reference_map_fn is None:
        from services.weather_pipeline.spot_size_climatology import reference_map as _rm
        reference_map_fn = _rm

    refs = reference_map_fn(clim) or {}
    spots_tracked = len((clim or {}).get("spots", {}) or {})

    seen_spots, with_ref, changed_level = set(), set(), set()
    up = down = same = 0
    indeterminate = 0
    deltas: List[float] = []
    movers: List[dict] = []
    level_flow: Dict[str, int] = {}
    _depth_cache: Dict[tuple, Optional[float]] = {}

    for fr in frames or []:
        for s in fr.get("spots") or []:
            sid = s.get("spot_id")
            if sid is None:
                continue
            seen_spots.add(sid)
            score_g = s.get("score")
            h = s.get("surf_height_m")
            ref = refs.get(sid)
            if ref is None:
                continue                       # no climatology yet -> global default -> unchanged
            with_ref.add(sid)
            if score_g is None:
                continue
            bd = None
            if break_depth_fn is not None:
                key = (round(float(s.get("latitude") or 0.0), 4),
                       round(float(s.get("longitude") or 0.0), 4))
                if key not in _depth_cache:
                    try:
                        _depth_cache[key] = break_depth_fn(key[0], key[1])
                    except Exception:
                        _depth_cache[key] = None
                bd = _depth_cache[key]
            r = _ratio(h, ref, bd)
            if r is None:
                indeterminate += 1
                continue
            score_l = round(score_g * r, 1)
            lvl_g, lvl_l = s.get("level") or score_to_level(score_g), score_to_level(score_l)
            d = round(score_l - score_g, 1)
            deltas.append(d)
            if lvl_g != lvl_l:
                changed_level.add(sid)
                key = f"{lvl_g} -> {lvl_l}"
                level_flow[key] = level_flow.get(key, 0) + 1
                if d > 0:
                    up += 1
                else:
                    down += 1
            else:
                same += 1
            movers.append({"spot_id": sid, "name": s.get("name"),
                           "latitude": s.get("latitude"), "longitude": s.get("longitude"),
                           "surf_height_m": h, "reference_m": round(ref, 2),
                           "score_now": score_g, "score_after": score_l, "delta": d,
                           "level_now": lvl_g, "level_after": lvl_l})

    movers.sort(key=lambda m: m["delta"])
    n = len(deltas)
    deltas_sorted = sorted(deltas)

    def _pct(i):
        return deltas_sorted[min(max(i, 0), n - 1)] if n else None

    return {
        "readiness": {
            "climatology_updated_at": (clim or {}).get("updated_at"),
            "spots_tracked": spots_tracked,
            "spots_with_reference": len(with_ref),
            "spots_rated": len(seen_spots),
            "coverage_pct": round(100.0 * len(with_ref) / len(seen_spots), 1) if seen_spots else 0.0,
        },
        "impact": {
            "spot_hours_compared": n,
            "indeterminate": indeterminate,
            "level_unchanged": same,
            "level_up": up,
            "level_down": down,
            "level_change_pct": round(100.0 * (up + down) / n, 1) if n else 0.0,
            "spots_changing_level": len(changed_level),
            "delta_median": _pct(n // 2),
            "delta_p10": _pct(n // 10),
            "delta_p90": _pct((9 * n) // 10),
            "delta_min": deltas_sorted[0] if n else None,
            "delta_max": deltas_sorted[-1] if n else None,
        },
        "level_flow": dict(sorted(level_flow.items(), key=lambda kv: -kv[1])),
        "biggest_downgrades": movers[:max_movers],
        "biggest_upgrades": list(reversed(movers[-max_movers:])),
    }


# ★ THE OWNER'S CALIBRATION ANCHORS, evaluated live. Solved 2026-07-29 with
# `backend/scripts/calibration_solver.py`: R_FL in [0.65, 0.85] m satisfies all five Florida
# anchors; the GLOBAL 1.2 m reference fails "4 ft is not epic" (it scores exactly 84.0, the first
# value in the epic bucket). Reporting these next to the deltas turns "should I flip this flag?"
# into "does flipping it make the owner's own stated targets green?", which is the actual question.
# Feet are DISPLAYED surf height under clean conditions (light dead-offshore, head-on swell).
OWNER_ANCHORS = [
    ("FL 2-3 ft clean = fair",           2.5,  9.0, ("fair",)),
    ("FL 3-4 ft clean = fair_good/good", 3.5,  9.0, ("fair_good", "good")),
    ("FL 4 ft @ 9 s is NOT epic",        4.0,  9.0, ("fair", "fair_good", "good")),
    ("FL 6-8 ft pumping = epic",         7.0, 11.0, ("epic",)),
    ("FL 8-10 ft pumping = epic",        9.0, 12.0, ("epic",)),
]
_FT = 0.3048


def anchor_report(reference_size_m: Optional[float]) -> Dict[str, Any]:
    """Do the owner's stated calibration anchors pass at this size reference?

    ⚠️ Clean-condition anchors: swell_from MUST equal the shore normal for head-on (passing the
    opposite bearing floors `swell_exposure` at 0.10 and makes every number ~10x too small).
    """
    from services.weather_pipeline.surf_rating import compute_surf_rating
    rows, passed = [], 0
    for label, ft, tp, allowed in OWNER_ANCHORS:
        try:
            score, level = compute_surf_rating(ft * _FT, tp, 2.0, 270.0, 90.0, 90.0,
                                               reference_size_m=reference_size_m)
        except Exception as e:
            rows.append({"anchor": label, "error": str(e)})
            continue
        ok = level in allowed
        passed += 1 if ok else 0
        rows.append({"anchor": label, "displayed_ft": ft, "period_s": tp,
                     "score": score, "level": level,
                     "owner_expects": list(allowed), "pass": ok})
    return {"reference_size_m": reference_size_m, "anchors": rows,
            "passed": passed, "total": len(OWNER_ANCHORS)}


def sanity_check(clim: Optional[dict], spots_by_coord: Optional[List[dict]] = None,
                 *, reference_map_fn: Callable[[Optional[dict]], dict] = None,
                 operative_pctl: Optional[float] = None,
                 strict_absolute: bool = False) -> Dict[str, Any]:
    """The rollout plan's OWN acceptance criterion: "FL spots get small refs, big-wave spots large".

    ★ A pure aggregate (median delta, % changed) CANNOT catch an inverted climatology — a blob that
    gave Florida 2.5 m and Pipeline 0.7 m would show a large, symmetric, entirely plausible spread.
    Only named exemplars with expected directions can, which is why the plan named them.

    TWO CLAIMS, GRADED SEPARATELY (2026-08-09) — see the frozen-bounds block above.
      ORDERING   percentile-invariant, and the thing "inverted" actually means -> pages as INVERTED.
      ABSOLUTE   the authored metre envelope. Only meaningful in the frame it was written for; when
                 `operative_pctl` differs from `SANITY_EXEMPLARS_AUTHORED_PCTL` a miss is reported as
                 BOUNDS STALE, because this function cannot tell "the blob moved" from "the yardstick
                 was re-scaled underneath the bound" — and a check that cannot tell those apart must
                 refuse rather than assert. `strict_absolute=True` (kill switch
                 CENSUS_STRICT_ABSOLUTE_BOUNDS=1) restores the pre-08-09 behaviour exactly.
    """
    if operative_pctl is None:
        try:
            from services.weather_pipeline.spot_size_climatology import REF_PERCENTILE
            operative_pctl = float(REF_PERCENTILE)
        except Exception:                                    # noqa: BLE001 - frame unknown, say so
            operative_pctl = None
    if reference_map_fn is None:
        from services.weather_pipeline.spot_size_climatology import reference_map as _rm
        reference_map_fn = _rm
    refs = reference_map_fn(clim) or {}

    # Match exemplars to spot ids by nearest coordinate (the climatology is keyed by spot id).
    # ⚠️ `raw_by_label` is UNROUNDED on purpose. `reference_m` below is rounded to 2 dp for the
    # operator, and a first pass computed the ordering ratio from that display value — up to ~0.5%
    # of pure rounding error in the number that decides INVERTED. That is the same "identical print,
    # opposite verdict" trap this whole change exists to close; caught by the boundary test.
    results, failures, raw_by_label = [], 0, {}
    for label, lat, lng, hi, lo in SANITY_EXEMPLARS:
        sid, best = None, None
        for sp in spots_by_coord or []:
            try:
                d = abs(float(sp["latitude"]) - lat) + abs(float(sp["longitude"]) - lng)
            except (TypeError, ValueError, KeyError):
                continue
            if best is None or d < best:
                best, sid = d, str(sp.get("id"))
        ref = refs.get(sid) if (sid is not None and best is not None and best < 0.2) else None
        ok = None
        if ref is not None:
            raw_by_label[label] = ref
            ok = True
            if hi is not None and ref > hi:
                ok = False
            if lo is not None and ref < lo:
                ok = False
            if not ok:
                failures += 1
        results.append({"exemplar": label, "reference_m": round(ref, 2) if ref else None,
                        "expected_max_m": hi, "expected_min_m": lo,
                        "verdict": ("ok" if ok else "OUT OF RANGE") if ref is not None
                                   else "no reference yet"})
    resolved = [r for r in results if r["reference_m"] is not None]

    # ── ORDERING: the claim that survives a percentile change ───────────────────────────────────
    by_label = raw_by_label
    pairs, worst = [], None
    for s_lbl, b_lbl, authored in _authored_pairs():
        s_ref, b_ref = by_label.get(s_lbl), by_label.get(b_lbl)
        if not s_ref or not b_ref or authored <= 0:
            continue
        observed = b_ref / s_ref
        margin = observed / authored
        pairs.append({"small": s_lbl, "big": b_lbl, "authored_ratio": round(authored, 3),
                      "observed_ratio": round(observed, 3), "margin": round(margin, 3)})
        if worst is None or margin < worst["margin"]:
            worst = pairs[-1]
    inverted = worst is not None and worst["margin"] < 1.0

    frame_matches = (operative_pctl is not None
                     and abs(operative_pctl - SANITY_EXEMPLARS_AUTHORED_PCTL) < 1e-9)
    absolute_binds = strict_absolute or frame_matches
    if not resolved:
        verdict = "NOT ENOUGH DATA"
    elif inverted:
        verdict = "INVERTED OR MISCALIBRATED"
    elif failures and absolute_binds:
        verdict = "INVERTED OR MISCALIBRATED"
    elif failures:
        verdict = "BOUNDS STALE"
    else:
        verdict = "SANE"
    return {
        "exemplars": results,
        "resolved": len(resolved),
        "failures": failures,
        "verdict": verdict,
        "ordering": {"pairs": pairs, "worst": worst, "inverted": inverted},
        "bounds_frame": {"authored_pctl": SANITY_EXEMPLARS_AUTHORED_PCTL,
                         "operative_pctl": operative_pctl,
                         "binds": absolute_binds,
                         "strict_override": bool(strict_absolute)},
    }
