"""
Migration: Add resolution-based pricing columns to live_sessions
Adds session-specific resolution pricing for Live Sessions:
- session_price_web: Web-res (social media optimized)
- session_price_standard: Standard digital delivery
- session_price_high: High-res (print quality)
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
    """Run the migration to add resolution pricing columns"""
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=True
    )
    
    async with engine.begin() as conn:
        print("Starting migration: Adding resolution-based pricing to live_sessions...")
        
        # Add session_price_web column
        print("\n1. Adding session_price_web column...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS session_price_web FLOAT;
            """))
            print("   ✓ session_price_web added")
        except Exception as e:
            print(f"   ⚠ session_price_web: {e}")
        
        # Add session_price_standard column
        print("\n2. Adding session_price_standard column...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS session_price_standard FLOAT;
            """))
            print("   ✓ session_price_standard added")
        except Exception as e:
            print(f"   ⚠ session_price_standard: {e}")
        
        # Add session_price_high column
        print("\n3. Adding session_price_high column...")
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS session_price_high FLOAT;
            """))
            print("   ✓ session_price_high added")
        except Exception as e:
            print(f"   ⚠ session_price_high: {e}")
        
        print("\n✅ Migration completed successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migration())
