"""
Migration: add_tos_content_table.py
Creates the tos_content table for admin-managed ToS & Privacy Policy content.
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import os

DATABASE_URL = os.getenv("DATABASE_URL")

async def run():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tos_content (
                id VARCHAR(36) PRIMARY KEY,
                doc_type VARCHAR(20) NOT NULL,
                version VARCHAR(20) NOT NULL,
                sections JSONB NOT NULL DEFAULT '[]'::jsonb,
                effective_date VARCHAR(50),
                is_active BOOLEAN DEFAULT FALSE,
                created_by VARCHAR(36) REFERENCES profiles(id) ON DELETE SET NULL,
                updated_by VARCHAR(36) REFERENCES profiles(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """))
        
        # Indexes
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_tos_content_doc_type ON tos_content(doc_type);
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS ix_tos_content_type_version ON tos_content(doc_type, version);
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_tos_content_active ON tos_content(doc_type, is_active);
        """))
        
        print("✅ tos_content table created successfully")
    
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(run())
