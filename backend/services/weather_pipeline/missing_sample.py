"""A point sample that carries no data must be read as MISSING, never as a measured zero (bug-hunt 2026-11-22, item B).

The sampler answers two situations with a placeholder of zeros instead of no answer:
  * `_build_unavailable_response` (no usable cell): speed 0, direction 0, period 0, method "unavailable";
  * the out-of-bounds fallback (the point is outside the product): the same zeros, method "out_of_bounds_fallback".
`point_resolution` drops those degraded samples only for MARINE on the global-coarse grid; everywhere else they come back
as an ordinary answer. Read as data, a missing WIND sample is 0 kt, which the rating grades as GLASSY, its best wind
(measured: 2 m @ 14 s with a real 12 kt onshore wind = 42.9 "fair"; the same hour with the wind sample "unavailable"
= 96.0 "epic"). A missing MARINE sample is 0 m, so the surf reads flat and the rating `very_poor` instead of unknown.

`is_missing` names those placeholders, and `skip` says whether a caller should treat one as absent. Absent means
exactly what a failed resolve (None) already means at each caller, so no new behaviour is invented:
  * marine absent -> no surf height and no rating (score None, level "unknown", the state clients already render);
  * wind absent   -> `wind_quality(None)`, the engine's own neutral for unknown wind (never glassy).

ONE FORECAST COMPOSITION: the two callers are the shared chain's own entry points: `point_surf_augment.augment_with_surf`
(the single site that produces `surf_height_m`) and `spot_ratings.rate_one_spot` (the reference rating). Every surface
that reads either inherits the fix; nothing is forked.

DARK: `RATING_MISSING_SAMPLE_UNKNOWN`, code default '0' (it moves served heights and ratings; turning it on is the owner's
word, D-065 with a SCOREBOARD row). Off, both callers are byte-identical to before.
"""
from collections import Counter

from services import runtime_flags as _rf

FLAG = "RATING_MISSING_SAMPLE_UNKNOWN"

# The sampler's two zero-filled placeholders. Not the nearest-ocean fallbacks: those return a real neighbouring value.
MISSING_METHODS = frozenset({"unavailable", "out_of_bounds_fallback"})


def is_missing(response) -> bool:
    """True when `response` has no point, or its point is one of the sampler's zero-filled placeholders."""
    point = getattr(response, "point", None)
    if point is None:
        return True
    return getattr(point, "interpolation_method", None) in MISSING_METHODS


def enabled() -> bool:
    return _rf.flag(FLAG) == "1"


def skip(response) -> bool:
    """True when the flag is on and `response` is a missing sample: the caller treats it as absent (like None)."""
    return response is not None and enabled() and is_missing(response)


# ── THE PLACEHOLDER TALLY (bug-hunt B follow-up, committed with #1181) ─────────────────────────────────────────────────
# How often does production actually serve a placeholder? The precompute records no sample method, so the blast radius
# of B was unmeasured. `note` counts every input `rate_one_spot` reads, by (model, domain) and outcome, whether the flag
# is on or off, so the count is the same either way. Process-local and pure counting: no I/O, no effect on any number.
_TALLY = Counter()


def note(response, domain: str, model: str) -> None:
    """Count one resolved input. `response` None (a failed resolve) is counted as 'none', not as a placeholder."""
    if response is None:
        kind = "none"
    elif is_missing(response):
        kind = getattr(getattr(response, "point", None), "interpolation_method", None) or "no_point"
    else:
        kind = "sample"
    _TALLY[(str(model), str(domain), kind)] += 1


def reset_tally() -> None:
    _TALLY.clear()


def tally_summary() -> dict:
    """{"model/domain": {"total": n, "placeholder": k, "share": k/n, "none": f, <method>: c, ...}} for this process."""
    out = {}
    for (model, domain, kind), n in sorted(_TALLY.items()):
        row = out.setdefault(f"{model}/{domain}", {"total": 0, "placeholder": 0, "none": 0})
        row["total"] += n
        if kind == "none":
            row["none"] += n
        elif kind != "sample":
            row["placeholder"] += n
            row[kind] = row.get(kind, 0) + n
    for row in out.values():
        row["share"] = round(row["placeholder"] / row["total"], 6) if row["total"] else 0.0
    return out
