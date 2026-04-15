"""Add price_per_additional_surfer column for crew split pricing"""

import asyncio
from sqlalchemy import text
from database import engine

async def run_migration():
    async with engine.begin() as conn:
        # Check if column exists
        result = await conn.execute(text("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'profiles' AND column_name = 'price_per_additional_surfer'
        """))
        if result.fetchone():
            print("Column price_per_additional_surfer already exists, skipping")
            return
        
        # Add the column
        await conn.execute(text("""
            ALTER TABLE profiles 
            ADD COLUMN price_per_additional_surfer FLOAT DEFAULT 15.0
        """))
        print("Added price_per_additional_surfer column to profiles table")

if __name__ == "__main__":
    asyncio.run(run_migration())
    print("Migration completed successfully")
