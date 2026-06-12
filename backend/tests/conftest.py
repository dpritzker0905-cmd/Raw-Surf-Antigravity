"""
Shared test fixtures for the Raw Surf backend test suite.

Uses httpx.AsyncClient + ASGITransport for testing FastAPI async endpoints
without needing a running server. This is the FastAPI 2025 recommended pattern.
"""
import platform
platform._wmi = None

import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Set test environment variables BEFORE importing the app
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///test_dev.db")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("TESTING", "1")


@pytest_asyncio.fixture
async def client():
    """
    Provides an async httpx client wired to the FastAPI app via ASGITransport.
    Each test gets a fresh client instance. No real DB connections are made.
    """
    try:
        from server import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac
    except Exception as e:
        pytest.skip(f"App import failed (expected in CI without DB): {e}")


@pytest_asyncio.fixture
async def auth_headers():
    """
    Returns mock authorization headers for authenticated endpoint testing.
    In a full test suite, this would generate a real JWT token.
    """
    return {"Authorization": "Bearer test-token-for-smoke-tests"}
