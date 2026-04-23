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
    pool_size=5,          # Reduced from 10 — response caching means fewer concurrent DB calls
    max_overflow=3,       # Reduced from 5 — less burst capacity needed with caching
    pool_timeout=30,
    pool_recycle=3600,    # Increased from 1800 — recycle connections every 60 min (fewer TLS handshakes)
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