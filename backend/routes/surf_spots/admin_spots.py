"""
Admin spot management — hierarchy normalization, seeding, CRUD, import.

Dedup/merge endpoints extracted to spot_dedup.py (v99 audit).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, text as sa_text
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/surf-spots/admin/normalize-hierarchy")
async def normalize_surf_spot_hierarchy(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    One-time migration endpoint to normalize the surf spot hierarchy:
    1. Consolidates orphan countries (Canary Islands → Spain, Northern Ireland → UK, etc.)
    2. Populates missing state_province values for spots that have country + region but no state
    
    This is safe to run multiple times — it only updates spots that need fixing.
    """
    results = {"consolidated": [], "populated": [], "skipped": [], "errors": []}
    
    # ===== Step 1: Consolidate orphan countries =====
    CONSOLIDATION = [
        ("Canary Islands", "Spain", "Canary Islands"),
        ("Northern Ireland", "United Kingdom", "Northern Ireland"),
        ("Wales", "United Kingdom", "Wales"),
    ]
    
    for old_country, new_country, new_state in CONSOLIDATION:
        try:
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.country == old_country).where(SurfSpot.is_active.is_(True))
            )
            spots = result.scalars().all()
            for spot in spots:
                spot.country = new_country
                if not spot.state_province:
                    spot.state_province = new_state
                results["consolidated"].append(f"{spot.name}: {old_country} → {new_country}/{spot.state_province}")
        except Exception as e:
            results["errors"].append(f"Consolidation error for {old_country}: {str(e)}")
    
    # Puerto Rico: consolidate standalone → USA, deactivate true duplicates
    try:
        pr_result = await db.execute(
            select(SurfSpot).where(SurfSpot.country == "Puerto Rico").where(SurfSpot.is_active.is_(True))
        )
        pr_standalone = pr_result.scalars().all()
        
        pr_usa_result = await db.execute(
            select(SurfSpot.name).where(SurfSpot.country == "USA").where(SurfSpot.state_province == "Puerto Rico").where(SurfSpot.is_active.is_(True))
        )
        pr_usa_names = {row[0].strip().lower() for row in pr_usa_result.all()}
        
        for spot in pr_standalone:
            if spot.name.strip().lower() in pr_usa_names:
                spot.is_active = False
                results["consolidated"].append(f"DEACTIVATED duplicate: {spot.name}")
            else:
                spot.country = "USA"
                if not spot.state_province:
                    spot.state_province = "Puerto Rico"
                results["consolidated"].append(f"{spot.name}: Puerto Rico → USA/Puerto Rico")
    except Exception as e:
        results["errors"].append(f"Puerto Rico consolidation error: {str(e)}")
    
    # ===== Step 2: Populate missing state_province =====
    COUNTRY_STATE_MAP = {
        "Bahamas": "Bahamas",
        "Bermuda": "Bermuda",
        "British Virgin Islands": "Tortola",
        "Canada": "Canada",
        "Cook Islands": "Rarotonga",
        "Iceland": "Iceland",
        "Cape Verde": "Cape Verde",
        "Channel Islands": "Channel Islands",
        "Mauritius": "Mauritius",
        "Norway": "Norway",
        "Reunion Island": "Reunion",
        "Trinidad & Tobago": "Trinidad & Tobago",
        "U.S. Virgin Islands": "U.S. Virgin Islands",
        "Uruguay": "Uruguay",
        "Argentina": "Buenos Aires",
        "Belize": "Belize",
    }
    
    try:
        null_result = await db.execute(
            select(SurfSpot)
            .where(SurfSpot.state_province.is_(None))
            .where(SurfSpot.country.isnot(None))
            .where(SurfSpot.is_active.is_(True))
        )
        null_spots = null_result.scalars().all()
        
        for spot in null_spots:
            new_state = COUNTRY_STATE_MAP.get(spot.country)
            if new_state:
                spot.state_province = new_state
                results["populated"].append(f"{spot.name} ({spot.country}) → {new_state}")
            else:
                results["skipped"].append(f"{spot.name} ({spot.country})")
    except Exception as e:
        results["errors"].append(f"Population error: {str(e)}")
    
    await db.commit()
    
    return {
        "success": True,
        "summary": {
            "consolidated": len(results["consolidated"]),
            "populated": len(results["populated"]),
            "skipped": len(results["skipped"]),
            "errors": len(results["errors"])
        },
        "details": results
    }


@router.post("/surf-spots/admin/seed-florida-spots")
async def seed_florida_spots(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Seed missing Florida surf spots from comprehensive research.
    Sources: Surfline, Mondo Surf, Visit Space Coast, Visit Indian River County.
    Covers: Volusia County, Space Coast/Brevard, Treasure Coast, First Coast/NE Florida.
    
    Safe to run multiple times — deduplicates by name + region.
    """
    try:
        from scripts.seed_missing_florida_spots import seed_spots
        result = await seed_spots(db)
        return {"success": True, **result}
    except Exception as e:
        import traceback
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


# ============================================================
# RE-EXPORTS - Dedup endpoints extracted to spot_dedup.py (v99 audit)
# ============================================================
from .spot_dedup import router as _dedup_router  # noqa: F401


@router.patch("/surf-spots/admin/update-spot")
async def admin_update_spot(
    id: str = Query(..., description="Spot UUID"),
    latitude: Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    name: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin endpoint to fix spot data (coordinates, name, region)."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == id))
    spot = result.scalar_one_or_none()
    if not spot:
        return {"success": False, "error": "Spot not found"}
    
    changes = []
    if latitude is not None:
        changes.append(f"latitude: {spot.latitude} → {latitude}")
        spot.latitude = latitude
    if longitude is not None:
        changes.append(f"longitude: {spot.longitude} → {longitude}")
        spot.longitude = longitude
    if name is not None:
        changes.append(f"name: {spot.name} → {name}")
        spot.name = name
    if region is not None:
        changes.append(f"region: {spot.region} → {region}")
        spot.region = region
    
    await db.commit()
    return {"success": True, "spot": spot.name, "changes": changes}


# ============================================================
# RE-EXPORTS - Seeding endpoints extracted to spot_seeding.py (v93 audit)
# ============================================================
from .spot_seeding import router as _seeding_router  # noqa: F401

@router.get("/admin/spots/stats")
async def get_spot_stats(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get global spot statistics for admin dashboard."""
    # Total spots
    total_result = await db.execute(select(func.count(SurfSpot.id)))
    total = total_result.scalar()
    
    # By country
    country_result = await db.execute(
        select(SurfSpot.country, func.count(SurfSpot.id))
        .group_by(SurfSpot.country)
        .order_by(func.count(SurfSpot.id).desc())
    )
    by_country = [{"country": c or "Unknown", "count": cnt} for c, cnt in country_result.all()]
    
    # By tier
    tier_result = await db.execute(
        select(SurfSpot.import_tier, func.count(SurfSpot.id))
        .group_by(SurfSpot.import_tier)
    )
    by_tier = {f"tier_{t or 1}": cnt for t, cnt in tier_result.all()}
    
    return {
        "total_spots": total,
        "by_country": by_country,
        "by_tier": by_tier
    }


@router.post("/admin/spots/import")
async def trigger_spot_import(
    admin: Profile = Depends(get_current_admin),
    tier: int = Query(default=0, description="Import tier: 0=all, 1=East Coast, 2=West Coast/Islands, 3=Global"),
    include_osm: bool = Query(default=False, description="Include OSM Overpass data"),
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger import of surf spots for a specific tier.
    - Tier 0: Import all curated spots
    - Tier 1: East Coast USA
    - Tier 2: West Coast, Hawaii, Puerto Rico  
    - Tier 3: Global (Australia, Indonesia, Europe, etc.)
    - include_osm: Also fetch from OSM Overpass API (slower)
    """
    from scripts.import_global_spots import import_curated_spots, import_osm_spots, CURATED_SPOTS
    
    # Filter curated spots by tier if specified
    if tier > 0:
        # Filter the CURATED_SPOTS by tier before importing
        original_spots = CURATED_SPOTS.copy()
        filtered_spots = [s for s in CURATED_SPOTS if s.get("tier") == tier]
        
        # Temporarily replace and restore
        import scripts.import_global_spots as import_module
        import_module.CURATED_SPOTS = filtered_spots
        curated_count = await import_curated_spots(db)
        import_module.CURATED_SPOTS = original_spots
    else:
        curated_count = await import_curated_spots(db)
    
    osm_count = 0
    if include_osm and tier > 0:
        osm_count = await import_osm_spots(db, tier)
    
    total = curated_count + osm_count
    
    tier_names = {0: "All", 1: "East Coast USA", 2: "West Coast & Islands", 3: "Global"}
    
    return {
        "success": True,
        "imported_curated": curated_count,
        "imported_osm": osm_count,
        "total_imported": total,
        "tier": tier,
        "tier_name": tier_names.get(tier, f"Tier {tier}"),
        "message": f"Imported {total} spots for {tier_names.get(tier, f'Tier {tier}')}"
    }


@router.put("/admin/spots/{spot_id}")
async def update_spot(
    spot_id: str,
    admin: Profile = Depends(get_current_admin),
    name: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    region: Optional[str] = None,
    wave_type: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    is_active: Optional[bool] = None,
    is_verified_peak: Optional[bool] = None,
    db: AsyncSession = Depends(get_db)
):
    """Update a surf spot (admin only)."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates if being modified for the first time
    if (latitude is not None or longitude is not None) and not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Update fields
    if name is not None:
        spot.name = name
    if country is not None:
        spot.country = country
    if state_province is not None:
        spot.state_province = state_province
    if region is not None:
        spot.region = region
    if wave_type is not None:
        spot.wave_type = wave_type
    if latitude is not None:
        spot.latitude = latitude
    if longitude is not None:
        spot.longitude = longitude
    if is_active is not None:
        spot.is_active = is_active
    if is_verified_peak is not None:
        spot.is_verified_peak = is_verified_peak
        if is_verified_peak:
            spot.accuracy_flag = 'verified'
            spot.verified_by = admin.id
            spot.verified_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"success": True, "message": f"Updated spot: {spot.name}"}



