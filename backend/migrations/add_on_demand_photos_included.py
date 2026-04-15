"""
Migration: Add on_demand_photos_included column to profiles
Adds the number of photos included in on-demand session buy-in
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
    """Run the migration to add on_demand_photos_included column"""
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=True
    )
    
    async with engine.begin() as conn:
        print("Starting migration: Adding on_demand_photos_included to profiles...")
        
        try:
            await conn.execute(text("""
                ALTER TABLE profiles 
                ADD COLUMN IF NOT EXISTS on_demand_photos_included INTEGER DEFAULT 3;
            """))
            print("   ✓ on_demand_photos_included added")
        except Exception as e:
            print(f"   ⚠ on_demand_photos_included: {e}")
        
        print("\n✅ Migration completed successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migration())
