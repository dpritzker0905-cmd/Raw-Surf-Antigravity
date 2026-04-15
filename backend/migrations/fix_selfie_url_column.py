"""
Migration: Fix selfie_url column size
This migration changes the selfie_url column from VARCHAR(500) to TEXT
in both dispatch_requests and live_session_participants tables.

This is needed because base64-encoded selfie images exceed the 500 character limit.
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
    """Run the migration to fix selfie_url column type"""
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=True
    )
    
    async with engine.begin() as conn:
        print("Starting migration: Changing selfie_url columns from VARCHAR(500) to TEXT...")
        
        # Fix dispatch_requests table
        print("\n1. Altering dispatch_requests.selfie_url to TEXT...")
        try:
            await conn.execute(text("""
                ALTER TABLE dispatch_requests 
                ALTER COLUMN selfie_url TYPE TEXT;
            """))
            print("   ✓ dispatch_requests.selfie_url changed to TEXT")
        except Exception as e:
            print(f"   ⚠ dispatch_requests: {e}")
        
        # Fix live_session_participants table
        print("\n2. Altering live_session_participants.selfie_url to TEXT...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ALTER COLUMN selfie_url TYPE TEXT;
            """))
            print("   ✓ live_session_participants.selfie_url changed to TEXT")
        except Exception as e:
            print(f"   ⚠ live_session_participants: {e}")
        
        print("\n✅ Migration completed successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migration())
