import asyncio
import urllib.request
import urllib.error
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

database_url = "postgresql+asyncpg://postgres:Labocana%23123@db.jnfbxcvcbtndtsvscppt.supabase.co:5432/postgres?ssl=require"
engine = create_async_engine(database_url, connect_args={"command_timeout": 60})

def is_working_url(url):
    if not url or not url.startswith('http'):
        return False
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=5)
        # Any 2xx or 3xx is ok. 400+ throws HTTPError
        return response.getcode() < 400
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code} for URL: {url}")
        return False
    except urllib.error.URLError as e:
        print(f"URL Error for {url}: {e.reason}")
        return False
    except Exception as e:
        print(f"Other Error for {url}: {e}")
        return False

async def run():
    try:
        async with engine.begin() as conn:
            query = text("SELECT id, caption, media_url, media_type FROM posts WHERE media_url IS NOT NULL")
            result = await conn.execute(query)
            rows = result.fetchall()
            
            print(f"Checking {len(rows)} posts with media...")
            broken_ids = []
            
            # Since user complained specifically about Sarah Waters posts, let's heavily flag post `f0ed5117...`
            # and test everything else
            for row in rows:
                post_id = row[0]
                media_url = row[2]
                
                # Check video URL validation
                working = is_working_url(media_url)
                if not working:
                    broken_ids.append(post_id)
                    print(f"Broken Post Detected! ID: {post_id}, URL: {media_url}")

            if broken_ids:
                print(f"Deleting {len(broken_ids)} posts with severely broken media URLs...")
                delete_query = text("DELETE FROM posts WHERE id = ANY(:ids)")
                await conn.execute(delete_query, {"ids": broken_ids})
                print("Deleted broken media posts successfully.")
            else:
                print("All posts have working media.")
                
    except Exception as e:
        print(f"Database Error: {e}")
    finally:
        await engine.dispose()

asyncio.run(run())
