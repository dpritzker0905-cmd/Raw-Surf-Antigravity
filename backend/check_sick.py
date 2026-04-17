import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import urllib.request
import urllib.error

database_url = "postgresql+asyncpg://postgres:Labocana%23123@db.jnfbxcvcbtndtsvscppt.supabase.co:5432/postgres?ssl=require"
engine = create_async_engine(database_url, connect_args={"command_timeout": 60})

async def run():
    try:
        async with engine.begin() as conn:
            # Output the sickening post
            res = await conn.execute(text("SELECT id, caption, media_url, media_type FROM posts WHERE caption ILIKE '%Sick%'"))
            rows = res.fetchall()
            for r in rows:
                print(r)
                if r[2]:
                    try:
                        req = urllib.request.Request(r[2], method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
                        response = urllib.request.urlopen(req, timeout=5)
                        print(f"URL HTTP status code: {response.getcode()}")
                    except Exception as e:
                        print(f"URL is broken: {e}")
            
    finally:
        await engine.dispose()

asyncio.run(run())
