"""spot_geometry_readiness.py — can this coordinate actually be forecast, and if not, what is missing?

THE PROBLEM THIS EXISTS FOR (owner, 2026-07-29): *"when we pin a new surf spot, the forecast and
surf report data automatically sync up with the logic."* Today they do not, and nothing says so.

Per-spot geometry — the fine ETOPO shore normal and `break_depth_m` — comes from
`data/shore_normals.json`, a BUILD-TIME COMMITTED ARTIFACT matched within 1 km, produced by a
MANUALLY-DISPATCHED GitHub workflow (`build-shore-normals.yml`, `workflow_dispatch` only; its own
header says "RE-RUN THIS whenever spots are added, moved, or re-placed"). So a freshly pinned spot
silently falls back to the coarse 0.25 deg bathymetry normal and NO break depth.

MEASURED COST of that fallback, over the 1,360 catalogue spots that DO have a fine normal, re-run
through the full production chain at Hs 2.0 m / Tp 14 s across 8 swell directions (10,880 evals):

    shore-normal error inherited   median 22.3 deg, p90 81.4 deg, max 179.4 deg
    spots off by more than 45 deg  26.6%   (swell judged against the wrong-facing coast)
    served height off by >25%      16.0% of evaluations
    RATING LEVEL CHANGES           45.8% of evaluations, median jump 2 levels (max 6 of 7)
    depth-limited breaking cap     lost at 78.4% of spots

⚠️ AND THE COARSE FALLBACK IS STILL WORTH KEEPING — I tested dropping it. Scored against the fine
normal as truth, the coarse bearing has a mean level error of 1.04 versus 4.12 for `None`, because a
`None` normal disables the directional gate entirely and every swell then scores as head-on (68%
median height error). A wrong bearing is bad; no bearing is far worse. Do not "fix" this by
suppressing the coarse value.

★ WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO. It is a pure read of what
`surf_point.resolve_surf_geometry` already resolved — NO network, NO database, no ERDDAP. It is
therefore safe on the request path (the 1-CPU serve box has a three-incident melt history) and can
answer, the instant a pin is dropped, "this spot's forecast is running on degraded geometry".

It CANNOT say *why* a spot is unfittable — that needs the ETOPO fit in
`scripts/build_shore_normals.py`, which costs a ~6-8 s ERDDAP round-trip and belongs in a background
job. That fitter already classifies every failure (`not_on_open_ocean_inland`, `spot_misplaced`,
`spot_misplaced_at_sea`, `ambiguous_coastline`) and writes them to a CI-only review CSV that never
reaches the product.

⚠️ MEASURED, and the reason this matters more than staleness: of 24 randomly sampled unmatched
catalogue spots, **0 were merely missing — every one had been DELIBERATELY REJECTED**. 62% for
ambiguous coastline (genuinely hard geometry), 38% for PLACEMENT (the pin is inland, beyond 3 km
from shore, or sitting in deep water). Re-running the build changes nothing for those; the pin has
to move. So "not in the asset" is two different problems and only one is automatable.
"""
from typing import Optional

# Verdicts, worst first. A closed vocabulary — callers and UIs key on these exact strings.
BLIND = "blind"          # no shore normal at all: the directional gate is entirely absent
DEGRADED = "degraded"    # coarse 0.25 deg normal and/or no break depth
FULL = "full"            # per-spot ETOPO normal AND a nearshore break depth

# What each missing input actually costs, measured 2026-07-29 (see the module docstring).
_IMPACT = {
    "shore_normal": "no directional gate at all — every swell scores as head-on (68% median height error)",
    "fine_shore_normal": "coarse 0.25 deg bearing: median 22.3 deg off, and the rating LEVEL differs "
                         "in 45.8% of evaluations (median 2 levels)",
    "break_depth": "the depth-limited breaking cap cannot bind, and the oversize gate loses its "
                   "per-spot capacity tier",
    "coastal": "not classified as coastal — the transform returns open-ocean swell, not surf",
}


def assess_geometry(geometry) -> dict:
    """Grade a resolved `SurfGeometry`. Pure — no I/O, no exceptions for missing fields.

    Returns {verdict, missing, impact, shore_normal_src, has_break_depth, coastal, actionable}.
    `actionable` is True when the operator can plausibly fix it (re-run the fit / move the pin), as
    opposed to a coordinate whose geometry is genuinely ambiguous."""
    src = getattr(geometry, "shore_normal_src", None) or "none"
    normal = getattr(geometry, "shore_normal_deg", None)
    break_depth = getattr(geometry, "break_depth_m", None)
    coastal = bool(getattr(geometry, "coastal", False))

    missing = []
    if normal is None:
        missing.append("shore_normal")
    elif src not in ("etopo",) and not str(src).startswith("override"):
        missing.append("fine_shore_normal")
    if break_depth is None:
        missing.append("break_depth")
    if not coastal:
        missing.append("coastal")

    if normal is None:
        verdict = BLIND
    elif missing:
        verdict = DEGRADED
    else:
        verdict = FULL

    return {
        "verdict": verdict,
        "missing": missing,
        "impact": [_IMPACT[m] for m in missing if m in _IMPACT],
        "shore_normal_src": src,
        "shore_normal_deg": normal,
        "has_break_depth": break_depth is not None,
        "break_depth_m": break_depth,
        "coastal": coastal,
        # A coarse-or-absent normal is what a background re-fit can actually repair. A spot that is
        # simply not coastal is a placement problem and re-fitting will not help it.
        "actionable": bool({"shore_normal", "fine_shore_normal", "break_depth"} & set(missing)),
    }


def assess_at(lat: float, lng: float, geometry=None) -> dict:
    """Readiness for a coordinate. Pass a pre-resolved `geometry` to avoid repeating the lookups.

    Fails OPEN: if geometry cannot be resolved at all we say so rather than raising, because this is
    a diagnostic and must never be able to break the surface that calls it."""
    if geometry is None:
        try:
            from services.weather_pipeline.surf_point import resolve_surf_geometry
            geometry = resolve_surf_geometry(lat, lng)
        except Exception as e:                       # noqa: BLE001 - diagnostics never raise
            return {"verdict": BLIND, "missing": ["shore_normal", "break_depth"],
                    "impact": [_IMPACT["shore_normal"], _IMPACT["break_depth"]],
                    "shore_normal_src": "error", "shore_normal_deg": None,
                    "has_break_depth": False, "break_depth_m": None, "coastal": False,
                    "actionable": True, "error": str(e)[:200]}
    out = assess_geometry(geometry)
    out["lat"], out["lng"] = lat, lng
    return out


def summarize(assessment: dict) -> str:
    """One human sentence for an admin panel or an MCP payload."""
    v = assessment.get("verdict")
    if v == FULL:
        return "Full per-spot geometry: this spot's forecast uses its own measured shore normal and break depth."
    if v == BLIND:
        return ("No shore orientation could be resolved for this coordinate — the forecast cannot tell "
                "which way the beach faces, so every swell direction scores the same. Check the pin is "
                "in the water and on an open coast.")
    bits = []
    if "fine_shore_normal" in assessment.get("missing", []):
        bits.append("it is using a coarse 0.25 degree shore orientation instead of its own measured one")
    if "break_depth" in assessment.get("missing", []):
        bits.append("it has no nearshore break depth, so the depth-limited size cap cannot apply")
    if "coastal" in assessment.get("missing", []):
        bits.append("it is not classified as coastal, so the model returns open-ocean swell rather than surf")
    return "Degraded geometry: " + "; ".join(bits) + "."


def readiness_counts(assessments) -> dict:
    """Aggregate for a catalogue-wide health view."""
    out = {FULL: 0, DEGRADED: 0, BLIND: 0, "actionable": 0, "total": 0}
    for a in assessments or []:
        if not isinstance(a, dict):
            continue
        out["total"] += 1
        v = a.get("verdict")
        if v in out:
            out[v] += 1
        if a.get("actionable"):
            out["actionable"] += 1
    return out
