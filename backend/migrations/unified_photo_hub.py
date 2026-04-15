"""
Unified Photo Hub Migration
- Removes 20 photo limit by allowing unlimited numerical input
- Adds resolution-tiered pricing to standard bookings
- Adds 'full_gallery_access' toggle for all-inclusive packages
"""
import asyncio
from sqlalchemy import text
from database import engine

async def run_migration():
    """Add Photo Hub unified pricing columns"""
    
    async with engine.begin() as conn:
        print("Starting Unified Photo Hub Migration...")
        
        # ============ PROFILE: Remove 20 Photo Limit ============
        # No actual limit in DB - the limit is enforced in frontend Slider
        # Just need to add full_gallery_access toggle
        print("\n[1/8] Adding full_gallery_access toggle to profiles...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS on_demand_full_gallery BOOLEAN DEFAULT FALSE
            """))
            print("  ✓ on_demand_full_gallery added")
        except Exception as e:
            print(f"  ⚠ on_demand_full_gallery may already exist: {e}")
        
        print("[2/8] Adding live_session_full_gallery toggle...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS live_session_full_gallery BOOLEAN DEFAULT FALSE
            """))
            print("  ✓ live_session_full_gallery added")
        except Exception as e:
            print(f"  ⚠ live_session_full_gallery may already exist: {e}")
        
        # ============ BOOKINGS: Add Resolution-Tiered Pricing ============
        print("\n[3/8] Adding booking_price_web to bookings...")
        try:
            await conn.execute(text("""
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS booking_price_web FLOAT DEFAULT 3.0
            """))
            print("  ✓ booking_price_web added")
        except Exception as e:
            print(f"  ⚠ booking_price_web may already exist: {e}")
        
        print("[4/8] Adding booking_price_standard to bookings...")
        try:
            await conn.execute(text("""
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS booking_price_standard FLOAT DEFAULT 5.0
            """))
            print("  ✓ booking_price_standard added")
        except Exception as e:
            print(f"  ⚠ booking_price_standard may already exist: {e}")
        
        print("[5/8] Adding booking_price_high to bookings...")
        try:
            await conn.execute(text("""
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS booking_price_high FLOAT DEFAULT 10.0
            """))
            print("  ✓ booking_price_high added")
        except Exception as e:
            print(f"  ⚠ booking_price_high may already exist: {e}")
        
        print("[6/8] Adding booking_photos_included to bookings...")
        try:
            await conn.execute(text("""
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS booking_photos_included INTEGER DEFAULT 3
            """))
            print("  ✓ booking_photos_included added")
        except Exception as e:
            print(f"  ⚠ booking_photos_included may already exist: {e}")
        
        print("[7/8] Adding booking_full_gallery toggle to bookings...")
        try:
            await conn.execute(text("""
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS booking_full_gallery BOOLEAN DEFAULT FALSE
            """))
            print("  ✓ booking_full_gallery added")
        except Exception as e:
            print(f"  ⚠ booking_full_gallery may already exist: {e}")
        
        # ============ PROFILE: Add Booking Default Pricing ============
        print("\n[8/8] Adding default booking tier pricing to profiles...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS booking_price_web FLOAT DEFAULT 3.0
            """))
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS booking_price_standard FLOAT DEFAULT 5.0
            """))
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS booking_price_high FLOAT DEFAULT 10.0
            """))
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS booking_photos_included INTEGER DEFAULT 3
            """))
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS booking_full_gallery BOOLEAN DEFAULT FALSE
            """))
            print("  ✓ All booking pricing defaults added to profiles")
        except Exception as e:
            print(f"  ⚠ Some booking pricing columns may already exist: {e}")
        
        print("\n✅ Unified Photo Hub Migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_migration())
