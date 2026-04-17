import asyncio
import sys
from sqlalchemy import select
from database import AsyncSessionLocal
from dotenv import load_dotenv
import os

# Load backend environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from models import Profile, Gallery, GalleryItem, SurfSpot
import uuid
from datetime import datetime, timezone

async def main():
    async with AsyncSessionLocal() as db:
        # Find photographer
        result = await db.execute(select(Profile).where(Profile.username == "davidpritzker"))
        photographer = result.scalar_one_or_none()
        
        if not photographer:
            print("Photographer @davidpritzker not found")
            return
            
        print(f"Found photographer: {photographer.full_name} ({photographer.id})")
        
        # Get a Spot
        spot_result = await db.execute(select(SurfSpot).limit(1))
        spot = spot_result.scalar_one_or_none()
        spot_id = spot.id if spot else None
        
        # Create a general gallery
        gallery = Gallery(
            photographer_id=photographer.id,
            surf_spot_id=spot_id,
            session_type='manual',
            title='Test General Gallery - April 2026',
            description='A test gallery populated by AI to test the pricing and purchase logic.',
            is_published=True
        )
        db.add(gallery)
        await db.commit()
        await db.refresh(gallery)
        
        # Inject standard photos
        item1 = GalleryItem(
            photographer_id=photographer.id,
            gallery_id=gallery.id,
            spot_id=spot_id,
            media_type='image',
            title='Epic Cutback',
            original_url='https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1000&q=80',
            preview_url='https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=1000&q=80',
            thumbnail_url='https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=200&q=80',
            price_web=3.0,
            price_standard=5.0,
            price_high=10.0,
            is_for_sale=True
        )
        
        item2 = GalleryItem(
            photographer_id=photographer.id,
            gallery_id=gallery.id,
            spot_id=spot_id,
            media_type='image',
            title='Barrel Run',
            original_url='https://images.unsplash.com/photo-1526365943261-24838641eb54?w=1000&q=80',
            preview_url='https://images.unsplash.com/photo-1526365943261-24838641eb54?w=1000&q=80',
            thumbnail_url='https://images.unsplash.com/photo-1526365943261-24838641eb54?w=200&q=80',
            price_web=3.0,
            price_standard=5.0,
            price_high=10.0,
            is_for_sale=True
        )
        
        # Inject custom priced photo
        item3 = GalleryItem(
            photographer_id=photographer.id,
            gallery_id=gallery.id,
            spot_id=spot_id,
            media_type='image',
            title='Premium Sunset Action',
            original_url='https://images.unsplash.com/photo-1414490929658-f64fb7da38af?w=1000&q=80',
            preview_url='https://images.unsplash.com/photo-1414490929658-f64fb7da38af?w=1000&q=80',
            thumbnail_url='https://images.unsplash.com/photo-1414490929658-f64fb7da38af?w=200&q=80',
            custom_price=25.0,  # Forces $25 regardless of generic settings
            is_for_sale=True
        )
        
        # Inject standard video
        item4 = GalleryItem(
            photographer_id=photographer.id,
            gallery_id=gallery.id,
            spot_id=spot_id,
            media_type='video',
            title='Slow Mo Spray',
            original_url='https://rawsurf-assets.s3.amazonaws.com/test-video.mp4',
            preview_url='https://rawsurf-assets.s3.amazonaws.com/test-video.mp4',
            thumbnail_url='https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=200&q=80',
            price_720p=8.0,
            price_1080p=15.0,
            price_4k=30.0,
            is_for_sale=True
        )

        db.add_all([item1, item2, item3, item4])
        await db.commit()
        print(f"Successfully injected Gallery (ID: {gallery.id}) with 4 media items!")

if __name__ == "__main__":
    asyncio.run(main())
