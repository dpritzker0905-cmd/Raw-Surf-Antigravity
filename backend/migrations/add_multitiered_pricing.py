"""
Migration: Add multi-tiered gallery pricing columns
Adds session-specific pricing fields to the profiles table:
- on_demand_photo_price: Per-photo rate for on-demand requests
- live_session_photo_price: Per-photo rate for live sessions  
- live_session_photos_included: Number of photos included in buy-in
"""

import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

DATABASE_URL = os.environ.get('DATABASE_URL')
ASYNC_DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://')


async def run_migration():
    """Run the migration to add multi-tiered pricing columns"""
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=True
    )
    
    async with engine.begin() as conn:
        print("Starting migration: Adding multi-tiered gallery pricing columns...")
        
        # Add on_demand_photo_price column
        print("\n1. Adding on_demand_photo_price column...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS on_demand_photo_price FLOAT DEFAULT 10.0;
            """))
            print("   ✓ on_demand_photo_price added")
        except Exception as e:
            print(f"   ⚠ on_demand_photo_price: {e}")
        
        # Add live_session_photo_price column
        print("\n2. Adding live_session_photo_price column...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS live_session_photo_price FLOAT DEFAULT 5.0;
            """))
            print("   ✓ live_session_photo_price added")
        except Exception as e:
            print(f"   ⚠ live_session_photo_price: {e}")
        
        # Add live_session_photos_included column
        print("\n3. Adding live_session_photos_included column...")
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS live_session_photos_included INTEGER DEFAULT 3;
            """))
            print("   ✓ live_session_photos_included added")
        except Exception as e:
            print(f"   ⚠ live_session_photos_included: {e}")
        
        print("\n✅ Migration completed successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migration())
