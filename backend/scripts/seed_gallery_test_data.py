#!/usr/bin/env python3
"""
Seed Gallery Test Data
Creates test GalleryItem and SurferGalleryItem records for testing the 
Service-to-Gallery tier logic and watermark system.

Usage:
    cd /app/backend && python scripts/seed_gallery_test_data.py
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from database import AsyncSessionLocal
from models import (
    Profile, GalleryItem, SurferGalleryItem, SurferGalleryClaimQueue,
    GalleryTierEnum, SurfSpot
)
import json

# Test user IDs
SEAN_STANHOPE_ID = "a8d52460-cdea-4977-b718-c8722c5c262d"
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # David Pritzker

# Sample surf photo URLs (using Pexels placeholders - more stable)
SAMPLE_PHOTOS = [
    {
        "original_url": "https://images.pexels.com/photos/1549973/pexels-photo-1549973.jpeg?auto=compress&w=2400",
        "preview_url": "https://images.pexels.com/photos/1549973/pexels-photo-1549973.jpeg?auto=compress&w=1200",
        "thumbnail_url": "https://images.pexels.com/photos/1549973/pexels-photo-1549973.jpeg?auto=compress&w=400",
        "title": "Morning Barrel",
        "service_type": "scheduled",  # Pro tier
    },
    {
        "original_url": "https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=2400",
        "preview_url": "https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=1200",
        "thumbnail_url": "https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=400",
        "title": "Carving Turn",
        "service_type": "on_demand",  # Standard tier
    },
    {
        "original_url": "https://images.pexels.com/photos/1032650/pexels-photo-1032650.jpeg?auto=compress&w=2400",
        "preview_url": "https://images.pexels.com/photos/1032650/pexels-photo-1032650.jpeg?auto=compress&w=1200",
        "thumbnail_url": "https://images.pexels.com/photos/1032650/pexels-photo-1032650.jpeg?auto=compress&w=400",
        "title": "Beach Break Session",
        "service_type": "live_join",  # Standard tier
    },
    {
        "original_url": "https://images.pexels.com/photos/416676/pexels-photo-416676.jpeg?auto=compress&w=2400",
        "preview_url": "https://images.pexels.com/photos/416676/pexels-photo-416676.jpeg?auto=compress&w=1200",
        "thumbnail_url": "https://images.pexels.com/photos/416676/pexels-photo-416676.jpeg?auto=compress&w=400",
        "title": "Dawn Patrol",
        "service_type": "scheduled",  # Pro tier - but UNPAID for testing watermark
        "is_paid": False,
    },
    {
        "original_url": "https://images.pexels.com/photos/1654489/pexels-photo-1654489.jpeg?auto=compress&w=2400",
        "preview_url": "https://images.pexels.com/photos/1654489/pexels-photo-1654489.jpeg?auto=compress&w=1200",
        "thumbnail_url": "https://images.pexels.com/photos/1654489/pexels-photo-1654489.jpeg?auto=compress&w=400",
        "title": "Sunset Session",
        "service_type": "on_demand",  # Standard tier - UNPAID for testing watermark
        "is_paid": False,
    },
]


async def get_or_create_spot(db) -> str:
    """Get existing spot or create a test one"""
    result = await db.execute(select(SurfSpot).limit(1))
    spot = result.scalar_one_or_none()
    
    if spot:
        return spot.id
    
    # Create a test spot
    spot = SurfSpot(
        name="Test Beach",
        region="Test Region",
        latitude=28.123,
        longitude=-80.456
    )
    db.add(spot)
    await db.commit()
    await db.refresh(spot)
    return spot.id


def get_tier_from_service(service_type: str) -> GalleryTierEnum:
    """Map service type to gallery tier"""
    if service_type == 'scheduled':
        return GalleryTierEnum.PRO
    return GalleryTierEnum.STANDARD


async def seed_test_data():
    """Seed test gallery items for Sean Stanhope"""
    async with AsyncSessionLocal() as db:
        # Verify users exist
        sean_result = await db.execute(select(Profile).where(Profile.id == SEAN_STANHOPE_ID))
        sean = sean_result.scalar_one_or_none()
        
        photographer_result = await db.execute(select(Profile).where(Profile.id == PHOTOGRAPHER_ID))
        photographer = photographer_result.scalar_one_or_none()
        
        if not sean:
            print(f"ERROR: Sean Stanhope not found with ID {SEAN_STANHOPE_ID}")
            return
        
        if not photographer:
            print(f"ERROR: Photographer not found with ID {PHOTOGRAPHER_ID}")
            return
        
        print(f"Found Sean: {sean.full_name}")
        print(f"Found Photographer: {photographer.full_name}")
        
        # Get a spot ID
        spot_id = await get_or_create_spot(db)
        print(f"Using spot ID: {spot_id}")
        
        created_count = 0
        
        for i, photo_data in enumerate(SAMPLE_PHOTOS):
            # Create GalleryItem (photographer's original)
            gallery_item = GalleryItem(
                photographer_id=PHOTOGRAPHER_ID,
                spot_id=spot_id,
                original_url=photo_data["original_url"],
                preview_url=photo_data["preview_url"],
                thumbnail_url=photo_data["thumbnail_url"],
                media_type="image",
                title=photo_data["title"],
                description=f"Test photo {i+1} for Service-to-Gallery tier testing",
                price=10.0 if photo_data.get("service_type") == "scheduled" else 5.0,
                is_for_sale=True,
                is_public=True,
                shot_at=datetime.now(timezone.utc) - timedelta(days=i)
            )
            db.add(gallery_item)
            await db.flush()  # Get the ID
            
            # Determine tier from service type
            service_type = photo_data["service_type"]
            gallery_tier = get_tier_from_service(service_type)
            
            # Set quality limits based on tier
            if gallery_tier == GalleryTierEnum.PRO:
                max_photo_quality = "high"
                max_video_quality = "4k"
            else:
                max_photo_quality = "standard"
                max_video_quality = "1080p"
            
            # Is this item paid?
            is_paid = photo_data.get("is_paid", True)  # Default to paid unless specified
            
            # Create SurferGalleryItem (Sean's view)
            surfer_item = SurferGalleryItem(
                surfer_id=SEAN_STANHOPE_ID,
                gallery_item_id=gallery_item.id,
                photographer_id=PHOTOGRAPHER_ID,
                service_type=service_type,
                gallery_tier=gallery_tier,
                max_photo_quality=max_photo_quality,
                max_video_quality=max_video_quality,
                is_paid=is_paid,
                paid_amount=10.0 if is_paid else 0.0,
                access_type="purchased" if is_paid else "pending",
                is_public=True if is_paid else False,  # Only show paid publicly
                surfer_confirmed=True,
                session_date=datetime.now(timezone.utc) - timedelta(days=i),
                spot_name="Test Beach",
                spot_id=spot_id
            )
            db.add(surfer_item)
            created_count += 1
            
            tier_str = "PRO" if gallery_tier == GalleryTierEnum.PRO else "STANDARD"
            paid_str = "PAID" if is_paid else "UNPAID"
            print(f"  Created: {photo_data['title']} | {tier_str} | {paid_str}")
        
        # Also add one item to the claim queue for testing
        claim_queue_item = GalleryItem(
            photographer_id=PHOTOGRAPHER_ID,
            spot_id=spot_id,
            original_url="https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=2400",
            preview_url="https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=1200",
            thumbnail_url="https://images.pexels.com/photos/1295138/pexels-photo-1295138.jpeg?auto=compress&w=400",
            media_type="image",
            title="AI Suggested Match",
            price=5.0,
            is_for_sale=True,
            is_public=True,
            shot_at=datetime.now(timezone.utc) - timedelta(hours=2)
        )
        db.add(claim_queue_item)
        await db.flush()
        
        # Create claim queue entry
        claim_queue_entry = SurferGalleryClaimQueue(
            surfer_id=SEAN_STANHOPE_ID,
            gallery_item_id=claim_queue_item.id,
            photographer_id=PHOTOGRAPHER_ID,
            ai_confidence=0.87,
            ai_match_reasons=json.dumps(["board_color_match", "wetsuit_pattern"]),
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(days=7)
        )
        db.add(claim_queue_entry)
        
        await db.commit()
        
        print(f"\n{'='*50}")
        print(f"SUCCESS: Created {created_count} gallery items for Sean Stanhope")
        print(f"Also created 1 item in the AI claim queue")
        print(f"{'='*50}")
        print("\nTest data includes:")
        print("  - 2 PRO tier items (scheduled bookings)")
        print("  - 3 STANDARD tier items (on-demand/live)")
        print("  - 2 UNPAID items (to test watermark preview)")
        print("  - 1 AI claim queue item (pending)")


if __name__ == "__main__":
    print("Seeding Gallery Test Data...")
    print("="*50)
    asyncio.run(seed_test_data())
