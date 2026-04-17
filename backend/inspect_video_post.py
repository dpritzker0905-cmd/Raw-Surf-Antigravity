import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

database_url = "postgresql+asyncpg://postgres:Labocana%23123@db.jnfbxcvcbtndtsvscppt.supabase.co:5432/postgres?ssl=require"
engine = create_async_engine(database_url, connect_args={"command_timeout": 60})

async def run():
    try:
        async with engine.begin() as conn:
            # Fix column references for profiles
            # In Raw Surf, profiles usually use 'name' or 'full_name' or 'username'
            author_query = text("""
                SELECT p.id, p.caption, p.media_url, p.media_type, p.content_type
                FROM posts p
                JOIN profiles pr ON p.author_id = pr.id
                WHERE pr.username ILIKE '%sarah%' 
                   OR pr.name ILIKE '%sarah%' 
                   OR pr.full_name ILIKE '%sarah%'
            """)
            
            try:
                author_res = await conn.execute(author_query)
                print(f"\nSarah Waters posts:")
                for p in author_res.fetchall():
                    print(f"- Post ID: {p[0]}, Type: {p[4]}, Media: {p[2]}")
            except Exception as inner_e:
                print(f"Error querying sarah waters profile: {inner_e}")
                
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()

asyncio.run(run())
