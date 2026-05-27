import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

async def query():
    backend_dir = Path(__file__).parent.parent / 'backend'
    load_dotenv(backend_dir / '.env')
    
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        print("DATABASE_URL not found in .env")
        return
        
    async_url = db_url.replace('postgresql://', 'postgresql+asyncpg://')
    engine = create_async_engine(async_url)
    
    async with engine.connect() as conn:
        try:
            result = await conn.execute(text("SELECT access_code_enabled, access_code FROM platform_settings LIMIT 1"))
            row = result.fetchone()
            print("=== DATABASE SETTINGS ===")
            if row:
                print(f"access_code_enabled: {row[0]}")
                print(f"access_code: {row[1]}")
            else:
                print("No rows in platform_settings")
        except Exception as e:
            print(f"Database query error: {e}")

if __name__ == "__main__":
    asyncio.run(query())
