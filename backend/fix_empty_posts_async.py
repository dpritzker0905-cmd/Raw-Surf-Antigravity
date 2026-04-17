import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

database_url = "postgresql+asyncpg://postgres:Labocana%23123@db.jnfbxcvcbtndtsvscppt.supabase.co:5432/postgres?ssl=require"
engine = create_async_engine(database_url, connect_args={"command_timeout": 60})

async def run():
    try:
        async with engine.begin() as conn:
            # Query posts with no media
            query = text("""
                SELECT id, caption, media_url, content_type FROM posts 
                WHERE media_url IS NULL OR media_url = '' OR media_url = 'None'
            """)
            
            result = await conn.execute(query)
            rows = result.fetchall()
            
            print(f"Found {len(rows)} posts with NO MEDIA.")
            
            ids_to_delete = [row[0] for row in rows]
            
            if ids_to_delete:
                print(f"Deleting {len(ids_to_delete)} posts...")
                delete_query = text("""
                    DELETE FROM posts 
                    WHERE id = ANY(:ids)
                """)
                await conn.execute(delete_query, {"ids": ids_to_delete})
                print("Successfully deleted all posts with no media.")
            else:
                print("No posts without media found.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await engine.dispose()

asyncio.run(run())
