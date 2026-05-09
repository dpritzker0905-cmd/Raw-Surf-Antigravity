"""
surf_spots/spot_seeding.py — Florida spot seeding, coordinate updates, and image seeding.
Extracted from admin_spots.py (v93 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from models import SurfSpot

router = APIRouter()


@router.post("/seed-florida-spots")
async def seed_florida_spots(db: AsyncSession = Depends(get_db)):
    """Seed Florida surf spots with accurate coordinates."""
    florida_spots = [
        {"name": "Jacksonville Beach Pier", "region": "Northeast Florida", "latitude": 30.2950, "longitude": -81.3906, "difficulty": "Beginner-Intermediate", "description": "Consistent beach break near the pier"},
        {"name": "Atlantic Beach", "region": "Northeast Florida", "latitude": 30.3347, "longitude": -81.3963, "difficulty": "Beginner-Intermediate", "description": "Mellow waves, good for longboarding"},
        {"name": "St. Augustine Beach", "region": "Northeast Florida", "latitude": 29.8542, "longitude": -81.2680, "difficulty": "Beginner-Intermediate", "description": "Historic area with fun beach breaks"},
        {"name": "Sebastian Inlet", "region": "Central Florida", "latitude": 27.8603, "longitude": -80.4473, "difficulty": "Advanced", "description": "Florida's premier surf spot, powerful waves"},
        {"name": "Cocoa Beach Pier", "region": "Central Florida", "latitude": 28.3655, "longitude": -80.5995, "difficulty": "Beginner-Intermediate", "description": "Iconic pier with consistent waves"},
        {"name": "New Smyrna Beach Inlet", "region": "Central Florida", "latitude": 29.0288, "longitude": -80.8895, "difficulty": "Intermediate-Advanced", "description": "Quality waves, shark capital of the world"},
        {"name": "Ponce Inlet", "region": "Central Florida", "latitude": 29.0964, "longitude": -80.9370, "difficulty": "Intermediate", "description": "Jetty break with good shape"},
        {"name": "Playalinda Beach", "region": "Central Florida", "latitude": 28.6650, "longitude": -80.6130, "difficulty": "Intermediate", "description": "Natural beach near Kennedy Space Center"},
        {"name": "Fort Pierce Inlet", "region": "Treasure Coast", "latitude": 27.4750, "longitude": -80.2878, "difficulty": "Intermediate-Advanced", "description": "Reliable jetty break"},
        {"name": "Stuart Beach", "region": "Treasure Coast", "latitude": 27.1892, "longitude": -80.1567, "difficulty": "Beginner-Intermediate", "description": "Mellow beach break"},
        {"name": "Reef Road", "region": "Treasure Coast", "latitude": 26.7167, "longitude": -80.0300, "difficulty": "Advanced", "description": "Palm Beach's premier reef break"},
        {"name": "Jupiter Inlet", "region": "Southeast Florida", "latitude": 26.9456, "longitude": -80.0636, "difficulty": "Intermediate", "description": "Jetty waves with good shape"},
        {"name": "Lake Worth Pier", "region": "Southeast Florida", "latitude": 26.6145, "longitude": -80.0325, "difficulty": "Beginner-Intermediate", "description": "Consistent pier break"},
        {"name": "Deerfield Beach", "region": "Southeast Florida", "latitude": 26.3188, "longitude": -80.0695, "difficulty": "Beginner", "description": "Gentle waves, good for beginners"},
        {"name": "Pompano Beach Pier", "region": "Southeast Florida", "latitude": 26.2378, "longitude": -80.0805, "difficulty": "Beginner-Intermediate", "description": "Pier break with parking"},
        {"name": "South Beach", "region": "Miami", "latitude": 25.7835, "longitude": -80.1250, "difficulty": "Beginner", "description": "Small waves in the art deco district"},
        {"name": "Haulover Beach", "region": "Miami", "latitude": 25.9030, "longitude": -80.1180, "difficulty": "Beginner-Intermediate", "description": "Inlet provides better shape"},
    ]
    existing = await db.execute(select(func.count(SurfSpot.id)))
    if existing.scalar() > 0:
        return {"message": "Spots already seeded", "count": existing.scalar()}
    for spot_data in florida_spots:
        db.add(SurfSpot(**spot_data))
    await db.commit()
    return {"message": f"Seeded {len(florida_spots)} Florida surf spots"}


@router.post("/surf-spots/update-coordinates")
async def update_surf_spot_coordinates(db: AsyncSession = Depends(get_db)):
    """Update existing surf spots with corrected coastal coordinates"""
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
    """Seed spot images from Unsplash."""
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
