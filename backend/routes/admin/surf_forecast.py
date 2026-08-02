"""
Admin · Surf Forecast — status + controls for the surf-rating system and its user-report inputs.

One place for the operator to see the rating pipeline's truth and moderate the data that feeds it:
  - GET  /admin/surf-forecast/status       — live server values of every rating feature flag (the
        kill-switch board), spot-ratings/climatology blob freshness, and calibration summaries.
  - GET  /admin/surf-forecast/reports      — recent user condition reports (surf_reports). These feed
        the observation gate + light score weigh-in (RATING_OBS_GATE), so junk reports need moderation.
  - DELETE /admin/surf-forecast/reports/{id} — remove a report (immediately stops influencing ratings;
        the confirmation/nudge windows only read fresh rows).

Flags are SERVER ENV (Render / workflow env) — this endpoint reports what the serve box actually sees;
flipping them is an env change + restart, documented per flag. Read-only besides report deletion.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Profile, SurfReport, SurfSpot
from deps.admin_auth import get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter()

# flag -> (default, what it controls, where to flip)
_RATING_FLAGS = {
    "SURF_RATING":                 ("1", "Rating overlay (vs raw surf-height band) on surf=1 grids", "Render env"),
    "SURF_TRANSFORM":              ("1", "Whole surf/rating band transform on marine grids", "Render env"),
    # ⚠️⚠️ THE DOCUMENTED KILL SWITCH DOES NOT KILL THE HUB. `SURF_TRANSFORM=0` gates the map band
    # (grid_resolver_surf.py:30) and the point lane (point_surf_augment.py:45) — but the spot hub
    # gates on a SECOND, differently-named switch, and it was absent from this registry, so an
    # operator pulling the documented switch during an incident would leave the hub transforming
    # while the other two surfaces stopped. One transform, one switch is the goal; until the two
    # names are unified the second one must at least be VISIBLE here.
    "SPOT_HUB_SURF_TRANSFORM":     ("1", "Spot hub's offshore->breaking transform (SEPARATE switch "
                                         "from SURF_TRANSFORM — pulling that one does NOT stop the hub)",
                                    "Render env"),
    # ★★★ THE THREE MULTIPLICATIVE VETOES. Each exists because an ADDITIVE term with a floor cannot
    # veto, and each was added to close a MEASURED defect. Setting any of them to 0 re-opens that
    # exact defect, and none was declared here — invisible to this panel and to the lane-parity guard.
    "RATING_WIND_GATE":            ("1", "Blown-out onshore veto — without it a blown-out day is "
                                         "floored back up by a long period", "Render env"),
    "RATING_OVERSIZE":             ("1", "Closeout veto — without it 4 / 12 / 35 / 100 ft ALL scored "
                                         "97.3 'epic' (size_score has no descending limb)", "Render env"),
    "RATING_PERIOD_GATE":          ("1", "Short-period veto — without it Tp 2 / 3 / 4 / 6 s ALL scored "
                                         "76.0 'good' (period_quality floors at 0.40)", "Render env"),
    # Nearshore transform switches. Boolean, and each reverts a measured correction.
    "SURF_BREAK_DEPTH":            ("1", "Use the ETOPO nearshore break depth for the depth-limited "
                                         "cap; off = the shelf median, which bound on 0 of 395 spots",
                                    "Render env"),
    "SURF_SHELF_KF_FLOOR":         ("1", "Floor bottom friction at Ardhuin's cited ~90% energy-loss "
                                         "ceiling; off = unbounded, which kept 0.4% of a wave at "
                                         "Salthill", "Render env"),
    "SURF_V3_SLOPE_GAMMA":         ("1", "Slope-aware breaker index (Weggel); off = the flat 0.78 "
                                         "centre that under-capped plunging reef breaks", "Render env"),
    "MARINE_MID_RES_RATING":       ("1", "Rate the mid-res (2°) tier so overview zooms keep a band", "Render env"),
    # ★★★ THE SHORE NORMAL — the #1 Jacobian variable (7.4 rating points at the median coarse
    # error, 28.1 at +45°) — and until 2026-08-02 not one of its switches was visible here. This
    # panel is the ONLY instrument that can read Render, which is the one lane no test can open, so
    # a kill switch missing from this dict is a kill switch an operator cannot find during an
    # incident. Same class as SPOT_HUB_SURF_TRANSFORM above (audit v5 F5).
    "SHORE_NORMAL_BEARING_RADIUS_KM": ("3.0", "How far the shore normal may borrow a gate-passed "
                                              "neighbour's bearing. NOT a boolean — set '1.0' to "
                                              "restore the pre-2026-08-02 single radius. The BREAK "
                                              "DEPTH deliberately stays at 1 km (different spatial "
                                              "correlation length); do not 'align' the two",
                                    "Render env AND forecast-ingest.yml AND precompute.yml AND "
                                    "sim-parity-monitor.yml env"),
    "SHORE_NORMAL_ASSET":          ("1", "The whole ETOPO per-spot shore-normal + break-depth asset. "
                                         "Off = every spot falls back to the 0.25° grid's bearing, "
                                         "decided from a 194.6 km window", "Render env"),
    "SHORE_NORMAL_OVERLAY":        ("1", "The runtime overlay that carries geometry resolved AFTER "
                                         "the committed asset was built. Off = a newly-pinned spot "
                                         "keeps the coarse bearing until the next asset build",
                                    "Render env"),
    # ★★★ SIX SWITCHES THAT ESCAPED THIS REGISTRY BY TWO DIFFERENT ROUTES (audit v5 F5/F10,
    # declared 2026-08-02). The guard that is supposed to catch an undeclared science switch was
    # seeing 17 of the 35 read across the chain — blind to more than it could see:
    #   * BY FILE SCOPE — `_RATING_SURFACES` is a hardcoded list of files, and `surf_point.py`,
    #     `shore_normal_asset.py` and `surf_height_convention.py` were not on it.
    #   * BY INDIRECTION — `surf_transform._v3(flag)` reads the env through a VARIABLE, so a scan
    #     matching `os.environ.get("LITERAL")` could not see four switches inside a file it was
    #     already walking.
    # ⚠️ SURF_HEIGHT_H110 is the one to read twice. The repo's own record: flipping it ALONE makes
    # the served height +25.5% too high, because it and the Kr assumption are two errors that
    # currently cancel. BOTH OR NEITHER.
    "SURF_HEIGHT_H110":            ("0", "Report H1/10 (the surfer's 'wave face') instead of Hs. "
                                         "⚠️ NEVER FLIP ALONE — +25.5% too high on its own; it "
                                         "cancels against the missing refraction Kr", "Render env"),
    "SURF_V3_NORMAL_OVERRIDES":    ("1", "Hand-audited per-spot shore normals — HUMAN GROUND TRUTH, "
                                         "outranks the derived ETOPO asset. Off = those spots fall "
                                         "back to the fit", "Render env"),
    "SURF_V3_EXPOSURE":            ("1", "Directional exposure factor: how much of the swell is "
                                         "AIMED at this coast. Off = every swell scores head-on "
                                         "(-30.0% of height at 75 deg off-normal is un-applied)",
                                    "Render env"),
    "SURF_V3_KOMAR":               ("1", "Komar breaker-height relation for the nearshore transform",
                                    "Render env"),
    "SURF_V3_MAGNETS":             ("1", "Sub-grid inlet/jetty focusing factor", "Render env"),
    "SURF_V3_SHELF_RECAL":         ("1", "Shelf-friction recalibration; off restores the "
                                         "pre-calibration cf scale", "Render env"),
    "RATING_OBS_GATE":             ("0", "Good/Epic observation gate + user-report weigh-in (Surfline hybrid)",
                                    "Render env AND forecast-ingest.yml AND precompute.yml env"),
    # ⚠️ THIS COLUMN WAS WRONG AND THE ERROR WAS DORMANT. It named 2 places ("Render env AND
    # precompute.yml") for a flag whose own workflow comments, tests/test_flag_lane_parity.py and
    # every memory file all say THREE — forecast-ingest.yml writes spot ratings too. The parity
    # guard only fires when a lane's value differs from the code default, so while this sat at '0'
    # everywhere the missing lane was invisible; flipping it to '1' on 2026-08-01 surfaced it
    # immediately. ★ A "where to flip" that is short by one lane is worse than none: it reads as
    # complete, and the lane it omits is exactly the one that silently keeps the old reference.
    "RATING_LOCAL_SIZE":           ("0", "Local (per-spot/per-cell) size calibration — flip glyphs+band together",
                                    "Render env AND forecast-ingest.yml AND precompute.yml env"),
    "RATING_SIZE_CLIMATOLOGY":     ("1", "Accumulate per-SPOT good-day size climatology (blob only)", "precompute.yml env"),
    "RATING_GRID_SIZE_CLIMATOLOGY": ("1", "Accumulate per-CELL (band) size climatology (blob only)", "pilots workflow env"),
    # ⚠️ "where to flip" is CHECKED — tests/test_flag_lane_parity.py fails if a workflow sets a flag
    # to something other than its code default without this column naming that workflow. It said
    # "Render env" while BOTH ingest lanes had already set it to '1' since 2026-07-18, so a reader of
    # this table could not learn the precomputed frames' true state.
    "RATING_TIDE":                 ("0", "Tide-fit factor in spot ratings",
                                    "Render env AND forecast-ingest.yml AND precompute.yml env"),
    # 2026-07-30: partitions now reach the RATING at all three surfaces, so a lane split on this
    # flag changes scores and LEVELS (measured: level moves on 50% of spot-hours), not just
    # heights — the exact RATING_TIDE-class trap. 4x the marine point resolutions when on.
    "SURF_PARTITIONS":             ("0", "Spectral swell trains in the height AND the rating (all surfaces)",
                                    "Render env AND forecast-ingest.yml AND precompute.yml env"),
    "RATING_BREAKER_TYPE":         ("0", "Iribarren breaker-type factor in spot ratings", "Render env"),
    "SPOT_RATINGS_V2":             ("1", "Spot-ratings endpoint (glyphs) master switch", "Render env"),
    "SURF_REGIONAL_PREFER":        ("1", "Surf regional-tile preference for the coastal band", "Render env"),
    "EURO_MARINE_MID_RES_INGEST":  ("1", "EURO mid-tier ingest (ECMWF wave stream) — the EURO band's data", "pilots workflow env"),
    "EURO_MARINE_MID_ECMWF":       ("1", "EURO mid source: ECMWF free wave stream (0 = legacy CMEMS)", "pilots workflow env"),
}


@router.get("/admin/surf-forecast/status")
async def get_surf_forecast_status(admin: Profile = Depends(get_current_admin)):
    """The rating system's live truth: flag values AS THE SERVE BOX SEES THEM, blob freshness, and
    calibration summaries. Every sub-read is independent and never fatal."""
    flags = [
        {"name": name, "value": os.environ.get(name, default), "default": default,
         "active": os.environ.get(name, default) != "0", "controls": controls, "where": where}
        for name, (default, controls, where) in _RATING_FLAGS.items()
    ]

    blobs = {}
    try:
        from services.weather_pipeline.spot_ratings import load_spot_ratings_l2_cached
        obj = load_spot_ratings_l2_cached()
        frames = (obj or {}).get("frames", [])
        confirmed = sum(1 for fr in frames for s in fr.get("spots", []) if s.get("confirmed"))
        blobs["spot_ratings"] = {
            "generated_at": (obj or {}).get("generated_at"), "frames": len(frames),
            "models": sorted({fr.get("model") for fr in frames if fr.get("model")}),
            "confirmed_spot_frames": confirmed,
        }
    except Exception as e:
        blobs["spot_ratings"] = {"error": str(e)}
    try:
        from services.weather_pipeline.spot_size_climatology import load_size_climatology_l2_cached
        clim = load_size_climatology_l2_cached()
        spots = (clim or {}).get("spots", {})
        ready = sum(1 for rec in spots.values() if isinstance(rec, dict) and rec.get("n", 0) >= 12)
        blobs["spot_size_climatology"] = {"updated_at": (clim or {}).get("updated_at"),
                                          "spots_tracked": len(spots), "spots_ready": ready}
    except Exception as e:
        blobs["spot_size_climatology"] = {"error": str(e)}
    try:
        from services.weather_pipeline.grid_size_climatology import load_grid_size_climatology_l2_cached
        gclim = load_grid_size_climatology_l2_cached()
        cells = (gclim or {}).get("cells", {})
        ready = sum(1 for rec in cells.values() if isinstance(rec, dict) and rec.get("n", 0) >= 12)
        blobs["grid_size_climatology"] = {"updated_at": (gclim or {}).get("updated_at"),
                                          "cells_tracked": len(cells), "cells_ready": ready}
    except Exception as e:
        blobs["grid_size_climatology"] = {"error": str(e)}

    return {"flags": flags, "blobs": blobs, "now": datetime.now(timezone.utc).isoformat()}


@router.post("/admin/surf-forecast/size-reference")
async def get_size_reference(
    payload: dict,
    admin: Profile = Depends(get_current_admin),
):
    """Local good-day breaking height (m) for a batch of coordinates, from the gridded size
    climatology.

    WHY THIS EXISTS: `grid_size_climatology` accumulates observed p80 breaking heights for every
    coastal 2-degree cell on Earth, 6x/day, into an L2 blob. It is the best available answer to
    "does this coast actually receive rideable swell" — better than any geometric proxy, because it
    is measured rather than inferred.

    It lives in the PRIVATE `weather-products` bucket, so only this process (which holds the
    service-role key) can read it. Candidate-filtering tooling runs outside the app and cannot.
    Rather than hand a production credential around, the server answers the question.

    That gap is real and it cost something: the 2026-07-27 spot-discovery filter fell back to a
    geometric open-water FETCH, which separates the Atlantic from the Baltic but NOT from the
    Mediterranean — Naples scores 344 km against Bundoran's 264 km. Storm climate is the actual
    discriminator and this blob measures it.

    Body: {"points": [[lat, lng], ...]}  (max 2000)
    Returns a reference per point, null where the cell has too few samples.
    """
    pts = payload.get("points") or []
    if not isinstance(pts, list) or len(pts) > 2000:
        raise HTTPException(status_code=400,
                            detail="points must be a list of at most 2000 [lat, lng] pairs")
    try:
        from services.weather_pipeline.grid_size_climatology import (
            load_grid_size_climatology_l2_cached, reference_for)
        clim = load_grid_size_climatology_l2_cached()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"climatology unavailable: {e}")
    if not clim:
        raise HTTPException(status_code=503, detail="climatology blob not present in L2")

    out = []
    for p in pts:
        try:
            lat, lng = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            out.append(None)
            continue
        try:
            out.append(reference_for(clim, lat, lng))
        except Exception:
            out.append(None)
    return {
        "updated_at": clim.get("updated_at"),
        "cells_tracked": len(clim.get("cells") or {}),
        "lattice_deg": clim.get("lattice_deg"),
        "references": out,
    }


@router.get("/admin/surf-forecast/local-size-preview")
async def local_size_preview(admin: Profile = Depends(get_current_admin),
                             db: AsyncSession = Depends(get_db)):
    """What WOULD happen if RATING_LOCAL_SIZE were flipped to 1 — measured, before flipping it.

    WHY THIS EXISTS: `95c5f04a` (2026-07-11) landed local size calibration behind this flag and put
    the rollout plan in its own commit message — "once climatology is sane (FL spots get small refs,
    big-wave spots large), flip RATING_LOCAL_SIZE=1 and verify". Eighteen days later the blob is
    218 KB and refreshing six times a day, and the flag is still 0, because answering "is it sane
    yet?" needed a production credential and a bespoke script. Nobody ever did it.

    ★ The A/B is free. `reference_size_m` enters the composite in exactly two multiplicative factors
    (`size_score`, `oversize_gate`), so every already-rated spot-hour can be re-scored by an exact
    ratio off its persisted breaking height. No weather is re-fetched: one blob read covers the
    whole catalogue.

    ⚠️ This reads and reports. It does not flip anything — that remains an env change + restart.
    """
    from services.weather_pipeline.local_size_preview import (
        anchor_report, preview_impact, sanity_check)
    from services.weather_pipeline.spot_ratings import load_spot_ratings_l2_cached
    from services.weather_pipeline.spot_size_climatology import load_size_climatology_l2_cached

    clim = load_size_climatology_l2_cached()
    if not clim:
        raise HTTPException(status_code=503, detail="size climatology blob not present in L2")
    obj = load_spot_ratings_l2_cached()
    frames = (obj or {}).get("frames", [])
    if not frames:
        raise HTTPException(status_code=503, detail="no precomputed spot ratings to compare against")

    # Break depth makes the oversize gate exact at big-wave spots. Offline (git geometry asset), so
    # this stays a pure blob-read endpoint — but never fatal, the gate is inert well below capacity.
    def _break_depth(lat, lng):
        try:
            from services.weather_pipeline.surf_point import resolve_surf_geometry
            geo = resolve_surf_geometry(lat, lng)
            return getattr(geo, "break_depth_m", None) if geo is not None else None
        except Exception:
            return None

    rows = (await db.execute(select(SurfSpot.id, SurfSpot.latitude, SurfSpot.longitude))).all()
    spots = [{"id": r[0], "latitude": r[1], "longitude": r[2]} for r in rows]

    report = preview_impact(clim, frames, break_depth_fn=_break_depth)
    report["sanity"] = sanity_check(clim, spots)
    # ★ The question is not "what changes" but "does flipping it make the OWNER'S stated targets
    # green?". Reported for the global reference (today) and a Florida-class local one, because the
    # global reference is exactly what fails the "4 ft is not epic" anchor — at 84.0, the first
    # value in the epic bucket. Solved in `backend/scripts/calibration_solver.py`.
    report["owner_anchors"] = {"today_global": anchor_report(None),
                               "with_local_reference": anchor_report(0.75)}
    report["flag"] = {"name": "RATING_LOCAL_SIZE",
                      "current": os.environ.get("RATING_LOCAL_SIZE", "0"),
                      "flip_where": "Render env AND precompute.yml env (glyphs+band together)"}
    # ⚠️ The aggregate cannot see an INVERTED climatology — a blob giving Florida 2.5 m and Pipeline
    # 0.7 m produces a perfectly plausible spread. Only the named exemplars can, so the go/no-go
    # follows the sanity verdict, never the deltas.
    report["recommendation"] = (
        "SAFE TO FLIP" if report["sanity"]["verdict"] == "SANE"
        else "DO NOT FLIP — " + report["sanity"]["verdict"])
    return report


@router.get("/admin/surf-forecast/reports")
async def get_recent_surf_reports(
    hours: int = 168, limit: int = 200,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Recent user condition reports — the human observations that confirm Good/Epic and nudge scores
    when RATING_OBS_GATE is on. Fresh (<=12 h) rows are the LIVE inputs; older rows are context."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 24 * 30)))
    rows = (await db.execute(
        select(SurfReport, SurfSpot.name)
        .join(SurfSpot, SurfSpot.id == SurfReport.spot_id, isouter=True)
        .where(SurfReport.created_at >= cutoff)
        .order_by(SurfReport.created_at.desc())
        .limit(max(1, min(limit, 500)))
    )).all()
    fresh_cut = datetime.now(timezone.utc) - timedelta(hours=12)
    return {"count": len(rows), "reports": [{
        "id": r.id, "spot_id": r.spot_id, "spot_name": name,
        "user_id": r.user_id, "rating": r.rating, "conditions": r.conditions,
        "wave_height": r.wave_height, "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "influences_rating_now": bool(r.created_at and r.created_at >= fresh_cut and r.rating is not None),
    } for r, name in rows]}


@router.delete("/admin/surf-forecast/reports/{report_id}")
async def delete_surf_report(
    report_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Moderation: remove a junk/abusive condition report. Takes effect on the next rating pass —
    the confirmation/nudge reads only live rows."""
    row = (await db.execute(select(SurfReport).where(SurfReport.id == report_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    await db.delete(row)
    await db.commit()
    logger.info("[admin/surf-forecast] report %s deleted by admin %s", report_id, getattr(admin, "id", "?"))
    return {"deleted": report_id}
