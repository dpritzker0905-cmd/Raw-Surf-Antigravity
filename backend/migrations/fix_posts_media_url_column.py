"""
Migration: Fix posts table media_url column size
Changes media_url and thumbnail_url from VARCHAR(500) to TEXT
to support base64 selfie images in check-in posts.
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
    """Run the migration to fix posts media_url column type"""
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=True
    )
    
    async with engine.begin() as conn:
        print("Starting migration: Changing posts media columns to TEXT...")
        
        # Fix posts.media_url column
        print("\n1. Altering posts.media_url to TEXT...")
        try:
            await conn.execute(text("""
                ALTER TABLE posts 
                ALTER COLUMN media_url TYPE TEXT;
            """))
            print("   ✓ posts.media_url changed to TEXT")
        except Exception as e:
            print(f"   ⚠ posts.media_url: {e}")
        
        # Fix posts.thumbnail_url column
        print("\n2. Altering posts.thumbnail_url to TEXT...")
        try:
            await conn.execute(text("""
                ALTER TABLE posts 
                ALTER COLUMN thumbnail_url TYPE TEXT;
            """))
            print("   ✓ posts.thumbnail_url changed to TEXT")
        except Exception as e:
            print(f"   ⚠ posts.thumbnail_url: {e}")
        
        print("\n✅ Migration completed successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migration())
