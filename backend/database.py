from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

DATABASE_URL = os.environ.get('DATABASE_URL')
ASYNC_DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://')

engine = create_async_engine(
    ASYNC_DATABASE_URL,
    pool_size=5,          # Conservative: Supabase Session-mode pooler has hard client limits
    max_overflow=3,       # 5+3=8 max per instance — safe for deploy overlap (2×8=16 < pool_size limit)
    pool_timeout=20,
    pool_recycle=1800,    # Recycle every 30 min to avoid stale connections
    pool_pre_ping=True,
    echo=False,
    connect_args={
        "statement_cache_size": 0,
        "command_timeout": 30,
    }
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Export for webhook handler
async_session_maker = AsyncSessionLocal

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()