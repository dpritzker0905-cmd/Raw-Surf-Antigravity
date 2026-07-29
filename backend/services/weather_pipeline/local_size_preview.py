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


def sanity_check(clim: Optional[dict], spots_by_coord: Optional[List[dict]] = None,
                 *, reference_map_fn: Callable[[Optional[dict]], dict] = None) -> Dict[str, Any]:
    """The rollout plan's OWN acceptance criterion: "FL spots get small refs, big-wave spots large".

    ★ A pure aggregate (median delta, % changed) CANNOT catch an inverted climatology — a blob that
    gave Florida 2.5 m and Pipeline 0.7 m would show a large, symmetric, entirely plausible spread.
    Only named exemplars with expected directions can, which is why the plan named them.
    """
    if reference_map_fn is None:
        from services.weather_pipeline.spot_size_climatology import reference_map as _rm
        reference_map_fn = _rm
    refs = reference_map_fn(clim) or {}

    # Match exemplars to spot ids by nearest coordinate (the climatology is keyed by spot id).
    results, failures = [], 0
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
    return {
        "exemplars": results,
        "resolved": len(resolved),
        "failures": failures,
        "verdict": ("SANE" if (resolved and failures == 0)
                    else "NOT ENOUGH DATA" if not resolved else "INVERTED OR MISCALIBRATED"),
    }
