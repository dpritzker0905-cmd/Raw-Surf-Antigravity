from fastapi import APIRouter, HTTPException, Request, Depends, Query
from fastapi.responses import RedirectResponse
import os
import httpx
import logging
from database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

logger = logging.getLogger(__name__)

router = APIRouter()

# Allow environment variables or fallback to hardcoded tokens for testing
STRAVA_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "238756")
STRAVA_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "3dc3dacb2fbaa94b6b5c914b669d2ca072e84bcc")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# For testing sync without full OAuth
TEST_ACCESS_TOKEN = os.environ.get("STRAVA_TEST_ACCESS_TOKEN", "ca8ffd5d1129ad973a03279438690b6617f7d9dd")

@router.get("/auth-url")
async def get_strava_auth_url():
    """Returns the Strava OAuth authorization URL."""
    if not STRAVA_CLIENT_ID or STRAVA_CLIENT_ID == "238756":
        logger.warning("Using hardcoded/test Strava Client ID. In production, ensure STRAVA_CLIENT_ID is set in .env.")
        
    redirect_uri = f"{FRONTEND_URL}/surf-log?strava_callback=true" 
    url = f"https://www.strava.com/oauth/authorize?client_id={STRAVA_CLIENT_ID}&response_type=code&redirect_uri={redirect_uri}&approval_prompt=force&scope=activity:read_all"
    return {"url": url}

@router.post("/callback")
async def strava_callback(code: str):
    """Exchanges the OAuth code for an access token."""
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
        
    async with httpx.AsyncClient() as client:
        res = await client.post("https://www.strava.com/oauth/token", data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code"
        })
        
        if res.status_code != 200:
            logger.error(f"Strava token exchange failed: {res.text}")
            raise HTTPException(status_code=400, detail="Failed to exchange token with Strava")
            
        data = res.json()
        
        # Here we would normally store this in the database for the user:
        # access_token = data.get("access_token")
        # refresh_token = data.get("refresh_token")
        # expires_at = data.get("expires_at")
        # await update_user_strava_tokens(user_id, access_token, refresh_token, expires_at)
        
        return {"status": "success", "access_token": data.get("access_token")}

@router.get("/sync-recent")
async def sync_recent_activity(user_id: str, access_token: Optional[str] = None):
    """
    Fetches the most recent surfing activity from Strava.
    Uses the provided access_token, the test token, or simulated data as a last resort.
    """
    token_to_use = access_token or TEST_ACCESS_TOKEN
    
    if not token_to_use:
        raise HTTPException(status_code=401, detail="No Strava access token available.")

    async with httpx.AsyncClient() as client:
        # 1. Fetch recent activities
        res = await client.get(
            "https://www.strava.com/api/v3/athlete/activities?per_page=5", 
            headers={"Authorization": f"Bearer {token_to_use}"}
        )
        
        if res.status_code == 401:
            # Token expired or invalid, return mock data gracefully for development
            logger.warning(f"Strava API returned 401 Unauthorized for token. Returning mock data.")
            import random
            return {
                "source": "strava",
                "distance": random.randint(1500, 4000),
                "topSpeed": random.uniform(4.5, 8.5),
                "waveCount": random.randint(3, 12),
                "duration_minutes": random.randint(45, 120),
                "mocked": True,
                "note": "Strava token expired. Mock data returned."
            }
            
        if res.status_code != 200:
            logger.error(f"Failed to fetch Strava activities: {res.text}")
            raise HTTPException(status_code=res.status_code, detail="Failed to fetch activities from Strava")
            
        activities = res.json()
        if not activities:
            raise HTTPException(status_code=404, detail="No recent activities found on Strava")
            
        # Try to find a Surfing activity, fallback to the most recent activity
        surf_activity = next((act for act in activities if act.get("type") == "Surfing" or act.get("sport_type") == "Surfing"), activities[0])
        
        # Calculate metrics from the Strava activity object
        # Strava distance is in meters, max_speed is in meters/second, elapsed_time is in seconds
        distance = surf_activity.get("distance", 0)
        top_speed = surf_activity.get("max_speed", 0)
        duration_minutes = surf_activity.get("elapsed_time", 0) / 60
        
        # We don't have waveCount directly from the summary, we'd need to fetch streams and calculate it.
        # For now, we simulate a realistic wave count based on distance and duration
        wave_count = max(0, int((distance / 1000) * 2 + (duration_minutes / 30)))
        
        return {
            "source": "strava",
            "distance": distance,
            "topSpeed": top_speed,
            "waveCount": wave_count,
            "duration_minutes": duration_minutes,
            "activity_id": surf_activity.get("id"),
            "activity_name": surf_activity.get("name")
        }
