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
    "MARINE_MID_RES_RATING":       ("1", "Rate the mid-res (2°) tier so overview zooms keep a band", "Render env"),
    "RATING_OBS_GATE":             ("0", "Good/Epic observation gate + user-report weigh-in (Surfline hybrid)", "Render env AND precompute.yml env"),
    "RATING_LOCAL_SIZE":           ("0", "Local (per-spot/per-cell) size calibration — flip glyphs+band together", "Render env AND precompute.yml env"),
    "RATING_SIZE_CLIMATOLOGY":     ("1", "Accumulate per-SPOT good-day size climatology (blob only)", "precompute.yml env"),
    "RATING_GRID_SIZE_CLIMATOLOGY": ("1", "Accumulate per-CELL (band) size climatology (blob only)", "pilots workflow env"),
    "RATING_TIDE":                 ("0", "Tide-fit factor in spot ratings", "Render env"),
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
