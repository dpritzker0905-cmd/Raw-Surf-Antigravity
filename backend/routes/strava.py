from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
import os
import httpx
import logging
from database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter()

STRAVA_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "")
STRAVA_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

@router.get("/auth-url")
async def get_strava_auth_url():
    """Returns the Strava OAuth authorization URL."""
    if not STRAVA_CLIENT_ID:
        # Return a mock URL for development if no keys are set
        return {"url": f"{FRONTEND_URL}/surf-log?strava_mock_auth=success"}
        
    redirect_uri = f"{FRONTEND_URL}/api/strava/callback" # or backend URL depending on architecture
    url = f"https://www.strava.com/oauth/authorize?client_id={STRAVA_CLIENT_ID}&response_type=code&redirect_uri={redirect_uri}&approval_prompt=force&scope=activity:read_all"
    return {"url": url}

@router.get("/sync-recent")
async def sync_recent_activity(user_id: str):
    """
    Fetches the most recent surfing activity from Strava and its GPS streams.
    Requires user to have authenticated and stored their access token.
    """
    if not STRAVA_CLIENT_ID:
        # Return mock data if running without Strava keys
        import random
        return {
            "source": "strava",
            "distance": random.randint(1500, 4000),
            "topSpeed": random.uniform(4.5, 8.5),
            "waveCount": random.randint(3, 12),
            "duration_minutes": random.randint(45, 120)
        }
        
    # Real implementation would look up the user's Strava access token from DB
    # token = await get_user_strava_token(db, user_id)
    # async with httpx.AsyncClient() as client:
    #     # 1. Fetch recent activities
    #     res = await client.get("https://www.strava.com/api/v3/athlete/activities", headers={"Authorization": f"Bearer {token}"})
    #     # 2. Find surf activity
    #     # 3. Fetch streams: /activities/{id}/streams?keys=latlng,time
    #     # 4. Calculate metrics using GPS points
    
    raise HTTPException(status_code=501, detail="Strava API tokens missing. Real sync not implemented.")
