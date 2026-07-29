"""resolve_spot_geometry.py — give a newly-pinned spot its own geometry, without a human.

THE GAP THIS CLOSES
-------------------
Everything else already follows a new pin: spot membership, the marine and wind points, the
precompute (it reads the live spot list every run), the spot hub (computed per request). Fine
per-coordinate geometry does NOT. The shore normal and `break_depth_m` live only in the
git-committed `shore_normals.json`, rebuilt by a `workflow_dispatch`-ONLY GitHub workflow whose own
header says *"RE-RUN THIS whenever spots are added, moved, or re-placed."* So the sync between "a
spot exists" and "the spot has geometry" was **a human remembering to click a button**.

Measured cost of a fresh pin (1,360 spots x 8 swell directions = 10,880 evaluations):

    shore-normal error inherited from the coarse fallback   median 22.3 deg, p90 81.4, max 179.4
    spots off by more than 45 deg                           26.6%
    RATING LEVEL CHANGES                                    45.8% of evaluations, median 2 levels
    depth-limited breaking cap lost                         78.4% of spots

★★ Virginity is the DEFAULT: 69.6% of catalogued spots have BOTH along-shore neighbours outside the
1 km match radius, so pinning a second peak one beach down the sand is enough to lose it.

WHAT THIS IS NOT
----------------
⚠️⚠️ **It does not lower the quality bar.** It reuses `build_shore_normals.measure()` and its
`accepted()` gate verbatim — the same fit, the same placement clauses, the same thresholds as the
committed build. `measure()` was verified to reproduce the committed asset EXACTLY (0.00 deg and
identical break depths on 6 calibration spots), so an overlay entry is byte-comparable to a built
one, not an approximation of it.

⚠️⚠️ **It cannot repair a misplaced pin, and must not pretend to.** Of 24 randomly sampled unmatched
spots, ZERO were merely missing — every one had been DELIBERATELY REJECTED by the gate: 62%
`ambiguous_coastline` (genuinely hard geometry) and 38% PLACEMENT (`not_on_open_ocean_inland`,
`spot_misplaced`, `spot_misplaced_at_sea`). Re-running repairs NONE of the placement group; the pin
has to move. So this reports the rejection REASON, which is the actionable half.

⛔ **NEVER ON THE REQUEST PATH.** One ERDDAP round trip measured ~22 s, is independent of payload
(the static index page takes the same 22 s), and is documented to swing 30x. It parallelises to
~3.8 s/spot at 6 workers. Background job yes; inline never.

⛔ **NEVER ON THE FASTAPI EVENT LOOP.** The app's APScheduler runs ON the event loop, so scheduling
this there would freeze every request for the duration of a tick — ~23 s for one spot and up to
279 s for a backlog. `resolve_many` is deliberately a plain blocking function: run it from a script,
a cron, or a worker thread, never from an async handler.
"""
import logging
import os
from typing import Any, Callable, Dict, Iterable, List, Optional

from services.weather_pipeline import shore_normal_asset
from services.weather_pipeline.spot_geometry_readiness import assess_at

logger = logging.getLogger(__name__)

# Bounded by default: a sweep that quietly tried 1,773 spots at ~22 s each would run for hours and
# hammer a public NOAA endpoint. The caller raises it deliberately.
MAX_PER_RUN = int(os.environ.get("GEOMETRY_RESOLVE_MAX", "50"))


def _gate():
    """`measure` + `accepted` from the build script — imported lazily because that module pulls
    numpy, and importing numpy from a worker thread under a running event loop is what deadlocked
    the sim MCP server (see `weather_sim_mcp._warm_hot_path`). Callers here are already off the
    loop; keeping it lazy means merely IMPORTING this module never drags numpy in."""
    import sys
    scripts = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import build_shore_normals as b
    return b.measure, b.accepted


def needs_geometry(spot: Dict[str, Any]) -> bool:
    """Would a fit actually HELP this spot? Zero network, zero DB — safe anywhere.

    ★ Gated on `actionable`, not merely on "not full". `spot_geometry_readiness` distinguishes what
    a re-fit can repair (an absent or coarse shore normal, a missing break depth) from what it
    cannot (a spot that is not classified coastal at all — a PLACEMENT problem whose pin has to
    move). Spending ~22 s of a public NOAA endpoint on the second kind buys a rejection we could
    have predicted for free."""
    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is None or lng is None:
        return False
    try:
        return bool(assess_at(float(lat), float(lng)).get("actionable"))
    except Exception as e:                       # a readiness miss must never block a resolve
        logger.debug(f"[geometry-resolve] readiness failed for {spot.get('name')}: {e}")
        return True


def resolve_one(spot: Dict[str, Any], measure=None, accepted=None) -> Dict[str, Any]:
    """Fit ONE spot and publish it if it passes the gate. Blocking (~22 s). Never raises.

    Returns {name, id, lat, lng, status, reason, normal, spread, break_depth_m}, where `status` is:
        published  — passed the gate and is now live in the overlay
        rejected   — the gate refused it; `reason` is the actionable part (placement vs fit)
        failed     — the fetch or the fit errored; retryable
        skipped    — already has full geometry
    """
    out = {"id": spot.get("id"), "name": spot.get("name"),
           "lat": spot.get("latitude"), "lng": spot.get("longitude"),
           "status": "failed", "reason": None, "normal": None, "spread": None,
           "break_depth_m": None}
    if not needs_geometry(spot):
        out["status"], out["reason"] = "skipped", "already has full geometry"
        return out
    try:
        if measure is None or accepted is None:
            measure, accepted = _gate()
        row = measure(spot)
    except Exception as e:
        out["reason"] = f"measure_raised: {e}"
        return out
    if row.get("status") != "ok":
        out["reason"] = row.get("status")           # e.g. fetch_failed / fit_failed — retryable
        return out
    try:
        ok, reason = accepted(row)
    except Exception as e:
        out["reason"] = f"gate_raised: {e}"
        return out
    out["normal"], out["spread"] = row.get("normal"), row.get("spread")
    out["break_depth_m"] = row.get("break_depth_m")
    if not ok:
        out["status"], out["reason"] = "rejected", reason
        return out
    if row.get("normal") is None or row.get("spread") is None:
        # The gate can pass a row whose fit produced no bearing; publishing that would put a None
        # into the index and make every lookup near it raise.
        out["status"], out["reason"] = "rejected", "gate_passed_without_a_bearing"
        return out
    shore_normal_asset.add_overlay_entry(
        float(row["lat"]), float(row["lng"]), float(row["normal"]), float(row["spread"]),
        row.get("break_depth_m"))
    out["status"], out["reason"] = "published", None
    return out


def resolve_many(spots: Iterable[Dict[str, Any]], limit: Optional[int] = None,
                 on_result: Optional[Callable[[Dict[str, Any]], None]] = None,
                 measure=None, accepted=None) -> Dict[str, Any]:
    """Resolve up to `limit` spots that need geometry. BLOCKING — never call from the event loop.

    `measure`/`accepted` default to the build script's own pair and exist to be INJECTED: without
    them the only way to exercise this function is to let it dial NOAA ERDDAP at ~22 s a spot, which
    is not a test, it is an outage waiting for a CI runner. (Discovered the honest way — the first
    version of the suite hung on exactly that.)

    Sequential on purpose. The build script parallelises to ~3.8 s/spot at 6 workers, but that is a
    CI runner hitting NOAA deliberately; a background job on the serve box has no business opening
    six concurrent connections to a public endpoint on a schedule. Raise `limit` and run it more
    often instead.
    """
    cap = MAX_PER_RUN if limit is None else max(0, int(limit))
    results: List[Dict[str, Any]] = []
    counts = {"published": 0, "rejected": 0, "failed": 0, "skipped": 0}
    for spot in spots:
        if len(results) >= cap:
            break
        if measure is None:
            try:
                measure, accepted = _gate()
            except Exception as e:
                logger.warning(f"[geometry-resolve] build script unavailable: {e}")
                return {"counts": counts, "results": results, "error": str(e)}
        r = resolve_one(spot, measure, accepted)
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        results.append(r)
        if on_result:
            try:
                on_result(r)
            except Exception:
                pass
    # ★ Report the REJECTION REASONS, not just a count. A spot rejected for placement needs its pin
    # moved and no amount of re-running will fix it; one rejected for ambiguous coastline is simply
    # hard. Collapsing both into "12 failed" is what made the existing CI review CSV — which never
    # reaches the product — the only place that answer lived.
    reasons: Dict[str, int] = {}
    for r in results:
        if r["status"] in ("rejected", "failed") and r["reason"]:
            key = str(r["reason"]).split(":")[0]
            reasons[key] = reasons.get(key, 0) + 1
    return {"counts": counts, "reasons": reasons, "results": results}


def persist_overlay(path: Optional[str] = None) -> int:
    """Write the live overlay to disk so a restart keeps it. Returns the entry count.

    ⚠️ The overlay is a CACHE, not a source of record — an ephemeral filesystem loses it and the
    spots fall back to the coarse normal exactly as they do today. The durable fix is still to run
    the full build and commit the asset; this closes the window until then."""
    import json
    import tempfile
    target = path or shore_normal_asset._OVERLAY
    entries = shore_normal_asset.overlay_entries()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    # Write-then-rename: a process killed mid-write must not leave a truncated JSON that the loader
    # latches as permanently corrupt.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(target), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump({"source": "resolve_spot_geometry", "entries": entries}, fh)
        os.replace(tmp, target)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return len(entries)
