import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def query():
    engine = create_async_engine('postgresql+asyncpg://postgres.jnfbxcvcbtndtsvscppt:Labocana%23123@aws-0-us-east-2.pooler.supabase.com:6543/postgres')
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT id FROM profiles WHERE username = 'davidsurf'"))
        user_id = result.scalar()
        print('User ID:', user_id)
        if user_id:
            result = await conn.execute(text("SELECT id, created_at, content_type, caption, media_url, media_type, thumbnail_url FROM posts WHERE author_id = :id ORDER BY created_at DESC LIMIT 3"), {'id': user_id})
            for row in result:
                print(row)

asyncio.run(query())
