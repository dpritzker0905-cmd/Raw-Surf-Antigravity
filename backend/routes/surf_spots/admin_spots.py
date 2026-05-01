"""
Admin spot management — hierarchy normalization, dedup, merge, seeding, CRUD, import.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, text as sa_text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/surf-spots/admin/normalize-hierarchy")
async def normalize_surf_spot_hierarchy(db: AsyncSession = Depends(get_db)):
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
async def seed_florida_spots(db: AsyncSession = Depends(get_db)):
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


@router.post("/surf-spots/admin/dedup")
async def dedup_surf_spots(
    execute: bool = Query(False, description="Set to true to actually merge. Default is dry-run."),
    db: AsyncSession = Depends(get_db)
):
    """
    Deduplicate surf spots — finds spots with the same name in the same state/country
    and merges them, re-parenting all FK references to the survivor.
    
    Default is DRY RUN. Pass ?execute=true to apply changes.
    """
    from sqlalchemy import text as sa_text
    
    # FK tables that reference surf_spots.id
    fk_refs = [
        ("profiles", "current_spot_id"),
        ("spot_refinements", "spot_id"),
        ("spot_verifications", "spot_id"),
        ("spot_edit_logs", "spot_id"),
        ("spot_of_the_day", "spot_id"),
        ("bookings", "surf_spot_id"),
        ("dispatch_requests", "spot_id"),
        ("posts", "spot_id"),
        ("live_session_participants", "spot_id"),
        ("check_ins", "spot_id"),
        ("surf_reports", "spot_id"),
        ("surf_alerts", "spot_id"),
        ("photographer_requests", "spot_id"),
        ("stories", "spot_id"),
        ("gallery_items", "spot_id"),
        ("surfer_gallery_items", "spot_id"),
        ("live_sessions", "surf_spot_id"),
        ("galleries", "surf_spot_id"),
        ("condition_reports", "spot_id"),
        ("social_live_streams", "spot_id"),
        ("surf_passport_checkins", "spot_id"),
        ("spot_seo_metadata", "spot_id"),
    ]
    
    results = {"groups": [], "total_merged": 0, "errors": []}
    
    try:
        # Find duplicate groups: same name + state_province + country with count > 1
        dup_result = await db.execute(
            select(
                SurfSpot.name,
                SurfSpot.state_province,
                SurfSpot.country,
                func.count(SurfSpot.id).label("cnt")
            )
            .where(SurfSpot.is_active.is_(True))
            .group_by(SurfSpot.name, SurfSpot.state_province, SurfSpot.country)
            .having(func.count(SurfSpot.id) > 1)
            .order_by(SurfSpot.name)
        )
        groups = dup_result.all()
        
        if not groups:
            return {"success": True, "message": "No duplicate spots found. Database is clean.", "groups": [], "total_merged": 0}
        
        for name, state, country, count in groups:
            # Fetch all spots in this duplicate group
            spots_result = await db.execute(
                select(SurfSpot).where(
                    SurfSpot.name == name,
                    SurfSpot.state_province == state,
                    SurfSpot.country == country,
                    SurfSpot.is_active.is_(True)
                ).order_by(SurfSpot.created_at)
            )
            spots = spots_result.scalars().all()
            
            if len(spots) < 2:
                continue
            
            # Pick survivor: prefer spot with more specific region, earliest created
            survivor = spots[0]
            for s in spots:
                if s.region and not survivor.region:
                    survivor = s
                elif s.region and survivor.region and len(s.region) > len(survivor.region):
                    survivor = s
            
            duplicates_info = []
            for dup in spots:
                if dup.id == survivor.id:
                    continue
                
                moved = {}
                for table, column in fk_refs:
                    try:
                        if execute:
                            # Handle unique constraint on spot_seo_metadata
                            if table == "spot_seo_metadata":
                                existing = await db.execute(
                                    sa_text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :new_id"),
                                    {"new_id": str(survivor.id)}
                                )
                                if (existing.scalar() or 0) > 0:
                                    result = await db.execute(
                                        sa_text(f"DELETE FROM {table} WHERE {column} = :old_id"),
                                        {"old_id": str(dup.id)}
                                    )
                                    if result.rowcount:
                                        moved[f"{table}.{column}"] = f"{result.rowcount} deleted"
                                    continue
                            
                            result = await db.execute(
                                sa_text(f"UPDATE {table} SET {column} = :new_id WHERE {column} = :old_id"),
                                {"new_id": str(survivor.id), "old_id": str(dup.id)}
                            )
                            if result.rowcount:
                                moved[f"{table}.{column}"] = result.rowcount
                        else:
                            result = await db.execute(
                                sa_text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :old_id"),
                                {"old_id": str(dup.id)}
                            )
                            cnt = result.scalar() or 0
                            if cnt > 0:
                                moved[f"{table}.{column}"] = cnt
                    except Exception:
                        pass
                
                if execute:
                    await db.execute(
                        sa_text("DELETE FROM surf_spots WHERE id = :dup_id"),
                        {"dup_id": str(dup.id)}
                    )
                
                duplicates_info.append({
                    "id": str(dup.id),
                    "region": dup.region,
                    "fk_refs": moved,
                    "action": "DELETED" if execute else "WOULD DELETE"
                })
                results["total_merged"] += 1
            
            results["groups"].append({
                "name": name,
                "state": state,
                "country": country,
                "count": count,
                "survivor_id": str(survivor.id),
                "survivor_region": survivor.region,
                "duplicates": duplicates_info
            })
        
        if execute:
            await db.commit()
        
        return {
            "success": True,
            "mode": "EXECUTED" if execute else "DRY RUN",
            "message": f"{'Merged' if execute else 'Would merge'} {results['total_merged']} duplicate(s) across {len(results['groups'])} groups.",
            **results
        }
    except Exception as e:
        import traceback
        results["errors"].append(str(e))
        return {"success": False, "error": str(e), "traceback": traceback.format_exc(), **results}


@router.post("/surf-spots/admin/merge-near-dupes")
async def merge_near_duplicate_spots(
    execute: bool = Query(False, description="Set to true to actually merge. Default is dry-run."),
    db: AsyncSession = Depends(get_db)
):
    """
    Merge near-duplicate surf spots that have slightly different names but refer
    to the same physical location. The exact-name dedup endpoint can't catch these.
    
    Examples: 'Jetty Park' vs 'Jetty Park - Cape Canaveral',
              'Spessard Holland' vs 'Spessard Holland Park'
    
    Strategy: For each known pair, keep the survivor (shorter/canonical name),
    re-parent all FK references from the duplicate, then delete the duplicate.
    Default is DRY RUN. Pass ?execute=true to apply changes.
    """
    from sqlalchemy import text as sa_text
    
    # Known near-duplicate pairs: (canonical_name_pattern, duplicate_name_pattern)
    # We'll search by ILIKE to be resilient to case differences
    near_dupe_pairs = [
        # (survivor_name_contains, duplicate_name_contains, same_state_required)
        ("Jetty Park", "Jetty Park - Cape Canaveral", True),
        ("Spessard Holland", "Spessard Holland Park", True),
        ("Picnic Tables", "Tables (Picnic Tables)", True),
        ("10th Street Folly", "10th Street East Folly", True),
        ("Melbourne Beach", "Melbourne Beach - Ocean Avenue", True),
        ("Indialantic", "Indialantic Boardwalk", True),
        ("Indialantic", "Ocean Avenue (Indialantic)", True),
        ("RC's", "RC's", False),  # Cross-region dupe (Space Coast vs Satellite Beach)
        ("Hightower Beach", "Hightower Park", False),  # Cross-region dupe
    ]
    
    fk_refs = [
        ("profiles", "current_spot_id"),
        ("spot_refinements", "spot_id"),
        ("spot_verifications", "spot_id"),
        ("spot_edit_logs", "spot_id"),
        ("spot_of_the_day", "spot_id"),
        ("bookings", "surf_spot_id"),
        ("dispatch_requests", "spot_id"),
        ("posts", "spot_id"),
        ("live_session_participants", "spot_id"),
        ("check_ins", "spot_id"),
        ("surf_reports", "spot_id"),
        ("surf_alerts", "spot_id"),
        ("photographer_requests", "spot_id"),
        ("stories", "spot_id"),
        ("gallery_items", "spot_id"),
        ("surfer_gallery_items", "spot_id"),
        ("live_sessions", "surf_spot_id"),
        ("galleries", "surf_spot_id"),
        ("condition_reports", "spot_id"),
        ("social_live_streams", "spot_id"),
        ("surf_passport_checkins", "spot_id"),
        ("spot_seo_metadata", "spot_id"),
    ]
    
    results = {"merges": [], "total_merged": 0, "skipped": [], "errors": []}
    
    try:
        for survivor_pattern, dup_pattern, same_state in near_dupe_pairs:
            # Skip self-referencing patterns (handled differently for cross-region)
            if survivor_pattern == dup_pattern:
                # Cross-region dupe: find all spots with this name, keep earliest
                spots_result = await db.execute(
                    select(SurfSpot).where(
                        SurfSpot.name == survivor_pattern,
                        SurfSpot.is_active.is_(True)
                    ).order_by(SurfSpot.created_at)
                )
                spots = spots_result.scalars().all()
                if len(spots) < 2:
                    results["skipped"].append(f"'{survivor_pattern}' - only {len(spots)} found, no merge needed")
                    continue
                survivor = spots[0]
                duplicates = spots[1:]
            else:
                # Find survivor (canonical name)
                survivor_result = await db.execute(
                    select(SurfSpot).where(
                        SurfSpot.name == survivor_pattern,
                        SurfSpot.is_active.is_(True)
                    ).order_by(SurfSpot.created_at).limit(1)
                )
                survivor = survivor_result.scalar_one_or_none()
                
                if not survivor:
                    results["skipped"].append(f"Survivor '{survivor_pattern}' not found")
                    continue
                
                # Find duplicate
                dup_query = select(SurfSpot).where(
                    SurfSpot.name == dup_pattern,
                    SurfSpot.is_active.is_(True)
                )
                if same_state and survivor.state_province:
                    dup_query = dup_query.where(SurfSpot.state_province == survivor.state_province)
                
                dup_result = await db.execute(dup_query)
                duplicates = dup_result.scalars().all()
                
                if not duplicates:
                    results["skipped"].append(f"Duplicate '{dup_pattern}' not found")
                    continue
            
            for dup in duplicates:
                moved = {}
                for table, column in fk_refs:
                    try:
                        if execute:
                            if table == "spot_seo_metadata":
                                existing = await db.execute(
                                    sa_text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :new_id"),
                                    {"new_id": str(survivor.id)}
                                )
                                if (existing.scalar() or 0) > 0:
                                    r = await db.execute(
                                        sa_text(f"DELETE FROM {table} WHERE {column} = :old_id"),
                                        {"old_id": str(dup.id)}
                                    )
                                    if r.rowcount:
                                        moved[f"{table}.{column}"] = f"{r.rowcount} deleted"
                                    continue
                            
                            r = await db.execute(
                                sa_text(f"UPDATE {table} SET {column} = :new_id WHERE {column} = :old_id"),
                                {"new_id": str(survivor.id), "old_id": str(dup.id)}
                            )
                            if r.rowcount:
                                moved[f"{table}.{column}"] = r.rowcount
                        else:
                            r = await db.execute(
                                sa_text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :old_id"),
                                {"old_id": str(dup.id)}
                            )
                            cnt = r.scalar() or 0
                            if cnt > 0:
                                moved[f"{table}.{column}"] = cnt
                    except Exception:
                        pass
                
                if execute:
                    await db.execute(
                        sa_text("DELETE FROM surf_spots WHERE id = :dup_id"),
                        {"dup_id": str(dup.id)}
                    )
                
                results["merges"].append({
                    "survivor": {"id": str(survivor.id), "name": survivor.name, "region": survivor.region},
                    "deleted": {"id": str(dup.id), "name": dup.name, "region": dup.region},
                    "fk_refs_moved": moved,
                    "action": "MERGED" if execute else "WOULD MERGE"
                })
                results["total_merged"] += 1
        
        if execute:
            await db.commit()
        
        return {
            "success": True,
            "mode": "EXECUTED" if execute else "DRY RUN",
            "message": f"{'Merged' if execute else 'Would merge'} {results['total_merged']} near-duplicate(s).",
            **results
        }
    except Exception as e:
        import traceback
        results["errors"].append(str(e))
        return {"success": False, "error": str(e), "traceback": traceback.format_exc(), **results}


@router.patch("/surf-spots/admin/update-spot")
async def admin_update_spot(
    id: str = Query(..., description="Spot UUID"),
    latitude: Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    name: Optional[str] = Query(None),
    region: Optional[str] = Query(None),
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


@router.post("/seed-florida-spots")
async def seed_florida_spots(db: AsyncSession = Depends(get_db)):
    # Accurate coastal coordinates for Florida surf spots (referenced from Surfline)
    florida_spots = [
        # Northeast Florida - Coordinates on the actual beach/ocean
        {"name": "Jacksonville Beach Pier", "region": "Northeast Florida", "latitude": 30.2950, "longitude": -81.3906, "difficulty": "Beginner-Intermediate", "description": "Consistent beach break near the pier"},
        {"name": "Atlantic Beach", "region": "Northeast Florida", "latitude": 30.3347, "longitude": -81.3963, "difficulty": "Beginner-Intermediate", "description": "Mellow waves, good for longboarding"},
        {"name": "St. Augustine Beach", "region": "Northeast Florida", "latitude": 29.8542, "longitude": -81.2680, "difficulty": "Beginner-Intermediate", "description": "Historic area with fun beach breaks"},
        
        # Central Florida - Prime surf zone
        {"name": "Sebastian Inlet", "region": "Central Florida", "latitude": 27.8603, "longitude": -80.4473, "difficulty": "Advanced", "description": "Florida's premier surf spot, powerful waves"},
        {"name": "Cocoa Beach Pier", "region": "Central Florida", "latitude": 28.3655, "longitude": -80.5995, "difficulty": "Beginner-Intermediate", "description": "Iconic pier with consistent waves"},
        {"name": "New Smyrna Beach Inlet", "region": "Central Florida", "latitude": 29.0288, "longitude": -80.8895, "difficulty": "Intermediate-Advanced", "description": "Quality waves, shark capital of the world"},
        {"name": "Ponce Inlet", "region": "Central Florida", "latitude": 29.0964, "longitude": -80.9370, "difficulty": "Intermediate", "description": "Jetty break with good shape"},
        {"name": "Playalinda Beach", "region": "Central Florida", "latitude": 28.6650, "longitude": -80.6130, "difficulty": "Intermediate", "description": "Natural beach near Kennedy Space Center"},
        
        # Treasure Coast
        {"name": "Fort Pierce Inlet", "region": "Treasure Coast", "latitude": 27.4750, "longitude": -80.2878, "difficulty": "Intermediate-Advanced", "description": "Reliable jetty break"},
        {"name": "Stuart Beach", "region": "Treasure Coast", "latitude": 27.1892, "longitude": -80.1567, "difficulty": "Beginner-Intermediate", "description": "Mellow beach break"},
        {"name": "Reef Road", "region": "Treasure Coast", "latitude": 26.7167, "longitude": -80.0300, "difficulty": "Advanced", "description": "Palm Beach's premier reef break"},
        
        # Southeast Florida
        {"name": "Jupiter Inlet", "region": "Southeast Florida", "latitude": 26.9456, "longitude": -80.0636, "difficulty": "Intermediate", "description": "Jetty waves with good shape"},
        {"name": "Lake Worth Pier", "region": "Southeast Florida", "latitude": 26.6145, "longitude": -80.0325, "difficulty": "Beginner-Intermediate", "description": "Consistent pier break"},
        {"name": "Deerfield Beach", "region": "Southeast Florida", "latitude": 26.3188, "longitude": -80.0695, "difficulty": "Beginner", "description": "Gentle waves, good for beginners"},
        {"name": "Pompano Beach Pier", "region": "Southeast Florida", "latitude": 26.2378, "longitude": -80.0805, "difficulty": "Beginner-Intermediate", "description": "Pier break with parking"},
        
        # Miami Area
        {"name": "South Beach", "region": "Miami", "latitude": 25.7835, "longitude": -80.1250, "difficulty": "Beginner", "description": "Small waves in the art deco district"},
        {"name": "Haulover Beach", "region": "Miami", "latitude": 25.9030, "longitude": -80.1180, "difficulty": "Beginner-Intermediate", "description": "Inlet provides better shape"},
    ]
    
    existing = await db.execute(select(func.count(SurfSpot.id)))
    if existing.scalar() > 0:
        return {"message": "Spots already seeded", "count": existing.scalar()}
    
    for spot_data in florida_spots:
        spot = SurfSpot(**spot_data)
        db.add(spot)
    
    await db.commit()
    return {"message": f"Seeded {len(florida_spots)} Florida surf spots"}

@router.post("/surf-spots/update-coordinates")
async def update_surf_spot_coordinates(db: AsyncSession = Depends(get_db)):
    """Update existing surf spots with corrected coastal coordinates"""
    # Corrected coordinates - positions spots on actual beaches, not inland
    coordinate_updates = {
        "Jacksonville Beach Pier": {"latitude": 30.2950, "longitude": -81.3906},
        "Atlantic Beach": {"latitude": 30.3347, "longitude": -81.3963},
        "St. Augustine Beach": {"latitude": 29.8542, "longitude": -81.2680},
        "Sebastian Inlet": {"latitude": 27.8603, "longitude": -80.4473},
        "Cocoa Beach Pier": {"latitude": 28.3655, "longitude": -80.5995},
        "New Smyrna Beach Inlet": {"latitude": 29.0288, "longitude": -80.8895},
        "Ponce Inlet": {"latitude": 29.0964, "longitude": -80.9370},
        "Playalinda Beach": {"latitude": 28.6650, "longitude": -80.6130},
        "Fort Pierce Inlet": {"latitude": 27.4750, "longitude": -80.2878},
        "Stuart Beach": {"latitude": 27.1892, "longitude": -80.1567},
        "Reef Road": {"latitude": 26.7167, "longitude": -80.0300},
        "Jupiter Inlet": {"latitude": 26.9456, "longitude": -80.0636},
        "Lake Worth Pier": {"latitude": 26.6145, "longitude": -80.0325},
        "Deerfield Beach": {"latitude": 26.3188, "longitude": -80.0695},
        "Pompano Beach Pier": {"latitude": 26.2378, "longitude": -80.0805},
        "South Beach": {"latitude": 25.7835, "longitude": -80.1250},
        "Haulover Beach": {"latitude": 25.9030, "longitude": -80.1180},
    }
    
    updated = 0
    for spot_name, coords in coordinate_updates.items():
        result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_name))
        spot = result.scalar_one_or_none()
        if spot:
            spot.latitude = coords["latitude"]
            spot.longitude = coords["longitude"]
            updated += 1
    
    await db.commit()
    return {"message": f"Updated coordinates for {updated} surf spots", "updated_count": updated}


@router.post("/surf-spots/seed-images")
async def seed_spot_images(db: AsyncSession = Depends(get_db)):
    spot_images = {
        "Jacksonville Beach Pier": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800",
        "Atlantic Beach": "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800",
        "St. Augustine Beach": "https://images.unsplash.com/photo-1520454974749-611b7248ffdb?w=800",
        "Sebastian Inlet": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800",
        "Cocoa Beach Pier": "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800",
        "New Smyrna Beach Inlet": "https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=800",
        "Ponce Inlet": "https://images.unsplash.com/photo-1416949929422-a1d9c8fe84af?w=800",
        "Playalinda Beach": "https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800",
        "Fort Pierce Inlet": "https://images.unsplash.com/photo-1509914398892-963f53e6e2f1?w=800",
        "Stuart Beach": "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800",
        "Reef Road": "https://images.unsplash.com/photo-1484291470158-b8f8d608850d?w=800",
        "Jupiter Inlet": "https://images.unsplash.com/photo-1471922694854-ff1b63b20054?w=800",
        "Lake Worth Pier": "https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800",
        "Deerfield Beach": "https://images.unsplash.com/photo-1535262412227-85541e910204?w=800",
        "Pompano Beach Pier": "https://images.unsplash.com/photo-1504681869696-d977211a5f4c?w=800",
        "South Beach": "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=800",
        "Haulover Beach": "https://images.unsplash.com/photo-1495954222046-2c427ecb546d?w=800",
    }
    
    updated = 0
    for spot_name, image_url in spot_images.items():
        result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_name))
        spot = result.scalar_one_or_none()
        if spot and not spot.image_url:
            spot.image_url = image_url
            updated += 1
    
    await db.commit()
    return {"message": f"Updated {updated} spot images"}
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


class CreateSpotRequest(BaseModel):
    name: str
    country: Optional[str] = None
    state_province: Optional[str] = None
    region: Optional[str] = None
    wave_type: Optional[str] = None
    latitude: float
    longitude: float
    difficulty: Optional[str] = None
    override_land_warning: Optional[bool] = False

@router.post("/admin/spots/create")
async def create_spot(
    data: CreateSpotRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new surf spot (admin only)."""
    # Create spot
    spot = SurfSpot(
        name=data.name,
        country=data.country,
        state_province=data.state_province,
        region=data.region,
        wave_type=data.wave_type,
        latitude=data.latitude,
        longitude=data.longitude,
        difficulty=data.difficulty,
        is_active=True,
        is_verified_peak=True,
        accuracy_flag='verified',
        verified_by=admin.id,
        verified_at=datetime.now(timezone.utc)
    )
    
    db.add(spot)
    await db.commit()
    await db.refresh(spot)
    
    return {"success": True, "message": f"Created spot: {spot.name}", "spot_id": spot.id}


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


@router.delete("/admin/spots/{spot_id}")
async def delete_spot(
    spot_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a surf spot (admin only)."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    await db.delete(spot)
    await db.commit()
    
    return {"success": True, "message": f"Deleted spot: {spot.name}"}



