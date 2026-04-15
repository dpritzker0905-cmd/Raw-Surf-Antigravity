"""
Session Pricing Metadata Migration
Adds fields to lock pricing context at the time of session join/upload.

This ensures that if a surfer joins via On-Demand, their gallery checkout prices 
are locked to the On-Demand rates set at the time of the request, even if the 
photographer's 'Standard' gallery price is different.
"""
import asyncio
from sqlalchemy import text
from database import engine

async def run_migration():
    """Add session pricing metadata columns"""
    
    async with engine.begin() as conn:
        print("Starting Session Pricing Metadata Migration...")
        
        # ============ GALLERY ITEMS: Add session origin tracking ============
        print("\n[1/7] Adding session_origin_mode to gallery_items...")
        try:
            await conn.execute(text("""
                ALTER TABLE gallery_items 
                ADD COLUMN IF NOT EXISTS session_origin_mode VARCHAR(30)
            """))
            print("  ✓ session_origin_mode added")
        except Exception as e:
            print(f"  ⚠ session_origin_mode may already exist: {e}")
        
        print("[2/7] Adding locked_price_web to gallery_items...")
        try:
            await conn.execute(text("""
                ALTER TABLE gallery_items 
                ADD COLUMN IF NOT EXISTS locked_price_web FLOAT
            """))
            print("  ✓ locked_price_web added")
        except Exception as e:
            print(f"  ⚠ locked_price_web may already exist: {e}")
        
        print("[3/7] Adding locked_price_standard to gallery_items...")
        try:
            await conn.execute(text("""
                ALTER TABLE gallery_items 
                ADD COLUMN IF NOT EXISTS locked_price_standard FLOAT
            """))
            print("  ✓ locked_price_standard added")
        except Exception as e:
            print(f"  ⚠ locked_price_standard may already exist: {e}")
        
        print("[4/7] Adding locked_price_high to gallery_items...")
        try:
            await conn.execute(text("""
                ALTER TABLE gallery_items 
                ADD COLUMN IF NOT EXISTS locked_price_high FLOAT
            """))
            print("  ✓ locked_price_high added")
        except Exception as e:
            print(f"  ⚠ locked_price_high may already exist: {e}")
        
        # ============ LIVE SESSION PARTICIPANTS: Lock prices at join time ============
        print("\n[5/7] Adding locked_price_web to live_session_participants...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS locked_price_web FLOAT
            """))
            print("  ✓ locked_price_web added")
        except Exception as e:
            print(f"  ⚠ locked_price_web may already exist: {e}")
        
        print("[6/7] Adding locked_price_standard to live_session_participants...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS locked_price_standard FLOAT
            """))
            print("  ✓ locked_price_standard added")
        except Exception as e:
            print(f"  ⚠ locked_price_standard may already exist: {e}")
        
        print("[7/7] Adding locked_price_high to live_session_participants...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS locked_price_high FLOAT
            """))
            print("  ✓ locked_price_high added")
        except Exception as e:
            print(f"  ⚠ locked_price_high may already exist: {e}")
        
        print("\n✅ Session Pricing Metadata Migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_migration())
