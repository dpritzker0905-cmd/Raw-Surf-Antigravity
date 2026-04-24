"""
Seed missing Florida surf spots — sourced from Surfline, Mondo Surf, Visit Space Coast, and local guides.
Run via: POST /api/surf-spots/admin/seed-florida-spots
or directly: python -m scripts.seed_missing_florida_spots

Covers all major regions:
- Volusia County (Flagler, Ormond, Daytona, NSB, Ponce Inlet)
- Brevard County / Space Coast (Playalinda → Sebastian)
- Indian River / Treasure Coast (Wabasso → Fort Pierce)
- St. Lucie / Martin County
- Palm Beach County
- Northeast Florida (St. Augustine, Jacksonville Beach)
"""

import asyncio
import uuid
from datetime import datetime, timezone

# Each tuple: (name, latitude, longitude, region, difficulty, wave_type, best_tide, best_swell, description)
FLORIDA_SPOTS = [
    # ============ VOLUSIA COUNTY ============
    ("Flagler Beach Pier", 29.4750, -81.1270, "Volusia County", "Beginner", "Beach Break",
     "Low to mid incoming", "NE-E", "Consistent pier break with lefts and rights. Sandy bottom, good for all levels."),
    ("Flagler Beach - Watertower", 29.4680, -81.1270, "Volusia County", "Intermediate", "Beach Break",
     "Low tide", "NE-E", "Local favorite a few blocks south of the pier with better-shaped peaks."),
    ("Flagler Beach - 11th Street", 29.4710, -81.1270, "Volusia County", "Beginner", "Beach Break",
     "All tides", "NE-E", "Accessible beach access with gentle waves, good for beginners."),
    ("Ormond Beach", 29.2850, -81.0550, "Volusia County", "Beginner", "Beach Break",
     "Low to mid", "NE-E", "Relaxed, less crowded alternative to Daytona. Old pier remnants create sandbars."),
    ("Daytona Beach - Main Street Pier", 29.2280, -81.0050, "Volusia County", "Beginner", "Beach Break",
     "All tides", "NE-E", "Classic Florida pier surf. Consistent beach break with pier-generated sandbars."),
    ("Daytona Beach - Sunglow Pier", 29.1750, -80.9820, "Volusia County", "Beginner", "Beach Break",
     "All tides", "NE-E", "Sunglow Pier fishing pier produces fun peaks on either side."),
    ("Ponce Inlet - North Jetty", 29.0810, -80.9240, "Volusia County", "Advanced", "Jetty Break",
     "All tides", "E-SE", "One of Florida's most powerful breaks. Long jetty creates consistent, heavy waves."),
    ("Ponce Inlet - South Jetty", 29.0780, -80.9220, "Volusia County", "Intermediate", "Jetty Break",
     "Incoming", "E-SE", "South side of Ponce Inlet. Sandier bottom, slightly mellower than the north jetty."),
    ("New Smyrna Beach - Inlet", 29.0740, -80.9190, "Volusia County", "Advanced", "Jetty Break",
     "All tides", "NE-E", "Most consistent spot in Florida. High-performance wedgey A-frame peak near jetty."),
    ("New Smyrna Beach - Flagler Avenue", 29.0280, -80.9210, "Volusia County", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "Popular access point with fun beach breaks, great for longboarding."),
    ("Bethune Beach", 28.9980, -80.9260, "Volusia County", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "Quiet beach south of NSB. Mellower waves, less crowded, good for learners."),

    # ============ BREVARD COUNTY / SPACE COAST ============
    # Jetty Park already exists in original import — REMOVED "Jetty Park - Cape Canaveral" to prevent dupes
    ("Playalinda Beach", 28.6320, -80.6520, "Space Coast", "Intermediate", "Beach Break",
     "Low to mid", "NE-E", "Undeveloped beach in Canaveral National Seashore. Raw, uncrowded beach breaks."),
    ("Cocoa Beach Pier", 28.3680, -80.6020, "Space Coast", "Beginner", "Beach Break",
     "High tide", "E-NE", "Legendary Florida longboard spot. Long, crumbly lines perfect for all levels."),
    ("Lori Wilson Park", 28.3510, -80.6070, "Space Coast", "Beginner", "Beach Break",
     "All tides", "E-NE", "Family-friendly park in Cocoa Beach. Consistent sandbars, good for beginners."),
    # "Tables (Picnic Tables)" removed — duplicates existing "Picnic Tables"
    # "RC's" removed — duplicates existing entry from original import
    # "Indialantic Boardwalk" removed — duplicates existing "Indialantic"
    # "Melbourne Beach - Ocean Avenue" removed — duplicates existing "Melbourne Beach"
    # "Spessard Holland Park" removed — duplicates existing "Spessard Holland"
    ("Spanish House", 28.0480, -80.5520, "Space Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Well-known, consistent Melbourne Beach break. Good for all levels."),
    ("Shark Pit", 27.8650, -80.4590, "Space Coast", "Intermediate", "Beach Break",
     "Low to mid", "E-NE", "Punchy beach break north of Sebastian Inlet. Known for quick, hollow waves."),
    ("Canova Beach Park", 28.0960, -80.5680, "Space Coast", "Beginner", "Beach Break",
     "All tides", "E-NE", "Relaxed Indialantic area beach break. Less crowded than the boardwalk."),
    ("Sebastian Inlet - First Peak", 27.8590, -80.4480, "Space Coast", "Advanced", "Jetty Break",
     "All tides", "NE-E-SE", "Florida's most famous surf spot. Fast, powerful waves created by the jetty."),
    ("Sebastian Inlet - Second Peak", 27.8580, -80.4490, "Space Coast", "Advanced", "Jetty Break",
     "All tides", "NE", "Secondary peak that sometimes breaks better than First Peak on NE swells."),
    ("Sebastian Inlet - Monster Hole", 27.8550, -80.4510, "Space Coast", "Advanced", "Jetty Break",
     "Low tide", "E-SE", "Located further out on the south side. Heavy, powerful break on big swells."),
    ("Sebastian Inlet - South Jetty", 27.8560, -80.4520, "Space Coast", "Intermediate", "Beach Break",
     "All tides", "E-NE", "Sandy beach break alternative to the crowded north jetty side."),

    # ============ INDIAN RIVER COUNTY / TREASURE COAST ============
    ("Wabasso Beach", 27.7530, -80.3850, "Treasure Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Popular local beach break south of Sebastian Inlet. Relaxed vibe."),
    ("Tracking Station - Vero Beach", 27.6650, -80.3560, "Treasure Coast", "Intermediate", "Beach Break",
     "Low to mid", "E-NE", "Well-known Vero spot that produces good conditions with the right swell."),
    ("Vero Beach Pier", 27.6340, -80.3540, "Treasure Coast", "Beginner", "Beach Break",
     "All tides", "E-NE", "Consistent pier-influenced break. Friendly lineup, good for all levels."),
    ("Conn Beach", 27.6180, -80.3530, "Treasure Coast", "Intermediate", "Reef Break",
     "Low tide", "E-SE", "Reef/sandbar break that can fire under the right conditions."),
    ("Riomar Point", 27.6100, -80.3520, "Treasure Coast", "Advanced", "Point Break",
     "Low to mid", "E-SE", "One of the few point break-style waves in Florida. Needs bigger swell to work."),
    ("South Beach Park - Vero", 27.5950, -80.3500, "Treasure Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Reliable spot for local surfers. Consistent beach break."),
    ("Round Island Park", 27.5600, -80.3390, "Treasure Coast", "Beginner", "Beach Break",
     "All tides", "E-NE", "Southern Vero area offering additional beach break options."),
    ("Fort Pierce Inlet - North Jetty", 27.4680, -80.2890, "Treasure Coast", "Advanced", "Jetty Break",
     "All tides", "E-NE-SE", "Powerful jetty break. Can produce some of the best waves on the Treasure Coast."),
    ("Fort Pierce Inlet - South Jetty", 27.4650, -80.2870, "Treasure Coast", "Intermediate", "Jetty Break",
     "Incoming", "E-NE", "Mellower alternative to the north jetty. Sandy bottom."),
    ("Pepper Park", 27.4850, -80.2950, "Treasure Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Public beach park with consistent, easy-going beach break."),

    # ============ ST. LUCIE / MARTIN COUNTY ============
    ("Jensen Beach", 27.2540, -80.2090, "Treasure Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Fun beach break in Martin County. Good for beginners and longboarders."),
    ("Bathtub Reef Beach", 27.1650, -80.1650, "Treasure Coast", "Beginner", "Beach Break",
     "All tides", "E-SE", "Unique nearshore reef creates a calm 'bathtub' inside. Protected beach break outside."),
    ("Stuart Beach", 27.1850, -80.1700, "Treasure Coast", "Beginner", "Beach Break",
     "Mid tide", "E-NE", "Consistent Martin County beach break. Family-friendly."),
    ("St. Lucie Inlet", 27.1640, -80.1510, "Treasure Coast", "Intermediate", "Jetty Break",
     "Incoming", "E-NE-SE", "Inlet break that lights up on bigger swells. Strong currents."),

    # ============ NORTHEAST FLORIDA (First Coast / Jacksonville) ============
    ("Jacksonville Beach Pier", 30.2890, -81.3950, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "Main surf hub of Jacksonville. Pier creates consistent sandbars."),
    ("Neptune Beach", 30.3140, -81.4060, "First Coast", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "North of Jax Beach. Consistent, approachable beach breaks."),
    ("Atlantic Beach", 30.3340, -81.4150, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "Northernmost beach in the Jacksonville beach communities. Fun, mellow waves."),
    ("Mayport Poles", 30.3930, -81.3980, "First Coast", "Intermediate", "Beach Break",
     "Low to mid", "NE-E", "Navy base area. Beach break with better shape than typical Jax Beach spots."),
    ("Hanna Park (Kathryn Abbey)", 30.3860, -81.4080, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "County park with uncrowded beach breaks. Good for escaping the Jax crowd."),
    ("Ponte Vedra Beach", 30.2240, -81.3790, "First Coast", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "Upscale beach community south of Jax Beach. Less crowded, consistent breaks."),
    ("Vilano Beach", 29.9240, -81.2850, "First Coast", "Intermediate", "Beach Break",
     "Low to mid", "NE-E", "North of St. Augustine Inlet. Good sandbar formations."),
    ("St. Augustine Beach", 29.8610, -81.2710, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "Historic surf scene. Fun beach breaks with pier-generated sandbars."),
    ("St. Augustine Inlet - North Jetty", 29.9120, -81.2630, "First Coast", "Advanced", "Jetty Break",
     "All tides", "NE-E-SE", "Jetty break on the St. Augustine Inlet. Powerful on larger swells."),
    ("Butler Beach", 29.7810, -81.2440, "First Coast", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "South of St. Augustine Beach. Quiet, consistent."),
    ("Crescent Beach", 29.7530, -81.2290, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "Uncrowded alternative to St. Augustine. Good sandbars."),
    ("Marineland", 29.6670, -81.2120, "First Coast", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "Southern Flagler County beach break. Quiet, uncrowded."),
    ("Washington Oaks State Park", 29.6410, -81.2050, "First Coast", "Beginner", "Beach Break",
     "All tides", "NE-E", "State park with coquina rock formations creating unique wave patterns."),
    ("Summer Haven", 29.7260, -81.2200, "First Coast", "Beginner", "Beach Break",
     "Mid tide", "NE-E", "Small beach community between St. Aug and Flagler. Peaceful surf."),
]


def generate_spot_id():
    return str(uuid.uuid4())


async def seed_spots(db_session):
    """Insert missing spots, skip any that already exist by name+region."""
    from sqlalchemy import select
    from models import SurfSpot
    
    inserted = 0
    skipped = 0
    
    for (name, lat, lng, region, difficulty, wave_type, best_tide, best_swell, desc) in FLORIDA_SPOTS:
        # Check if spot already exists (by name + region)
        result = await db_session.execute(
            select(SurfSpot).where(
                SurfSpot.name == name,
                SurfSpot.region == region
            )
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            skipped += 1
            continue
        
        # Also check for base name match (e.g. 'Jetty Park' matches 'Jetty Park - Cape Canaveral')
        base_name = name.split(' - ')[0].split(' (')[0].strip()
        if base_name != name:
            base_check = await db_session.execute(
                select(SurfSpot).where(
                    SurfSpot.name == base_name,
                    SurfSpot.region == region
                )
            )
            if base_check.scalar_one_or_none():
                skipped += 1
                continue
        
        spot = SurfSpot(
            id=generate_spot_id(),
            name=name,
            latitude=lat,
            longitude=lng,
            region=region,
            country="USA",
            state_province="Florida",
            difficulty=difficulty,
            wave_type=wave_type,
            best_tide=best_tide,
            best_swell=best_swell,
            description=desc,
            is_active=True,
            import_tier=1,
            accuracy_flag="unverified",
        )
        db_session.add(spot)
        inserted += 1
    
    await db_session.commit()
    return {"inserted": inserted, "skipped": skipped, "total_attempted": len(FLORIDA_SPOTS)}


async def main():
    """Standalone execution"""
    import sys
    sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent))
    
    from database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as session:
        result = await seed_spots(session)
        print(f"✅ Seeded Florida spots: {result}")


if __name__ == "__main__":
    asyncio.run(main())
