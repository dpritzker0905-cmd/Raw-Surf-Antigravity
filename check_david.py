import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

database_url = "postgresql+asyncpg://postgres:Labocana%23123@db.jnfbxcvcbtndtsvscppt.supabase.co:5432/postgres?ssl=require"
engine = create_async_engine(database_url, connect_args={"command_timeout": 60})

async def run():
    try:
        async with engine.begin() as conn:
            # 1. Set username on "David Surfer" (profile 94962bf9) to 'davidsurfer_test'
            #    so they can actually be found and navigated to
            r = await conn.execute(text("""
                UPDATE profiles
                SET username = 'davidsurfer'
                WHERE id = '94962bf9-b148-4d90-9537-1995f6b566a0'
                AND (username IS NULL OR username = '')
                RETURNING id, username, full_name
            """))
            updated = r.fetchall()
            print(f"Set username on David Surfer: {updated}")

            # 2. Delete the dead /api/uploads/ video post from @davidsurf account  
            #    (file is gone from Render disk, post is orphaned/broken)
            r2 = await conn.execute(text("""
                SELECT id, media_url, author_id FROM posts
                WHERE media_url LIKE '/api/uploads/%'
                AND media_url LIKE '%.mp4%'
            """))
            dead_posts = r2.fetchall()
            print(f"\nDead local video posts: {len(dead_posts)}")
            for p in dead_posts:
                print(f"  post_id={p[0]} url={p[1]} author={p[2]}")

            # Delete them (they serve nothing — no file, no thumbnail)
            if dead_posts:
                dead_ids = [str(p[0]) for p in dead_posts]
                placeholders = ','.join([f"'{pid}'" for pid in dead_ids])
                await conn.execute(text(f"""
                    DELETE FROM posts WHERE id IN ({placeholders})
                """))
                print(f"Deleted {len(dead_ids)} dead local video posts")

    except Exception as e:
        print(f"Error: {e}")
        import traceback; traceback.print_exc()
    finally:
        await engine.dispose()

asyncio.run(run())
