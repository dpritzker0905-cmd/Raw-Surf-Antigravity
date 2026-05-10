from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
import os
import httpx
import logging
from database import get_db, async_session_maker
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import Profile
import time

logger = logging.getLogger(__name__)

router = APIRouter()

STRAVA_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "238756")
STRAVA_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "3dc3dacb2fbaa94b6b5c914b669d2ca072e84bcc")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

async def refresh_strava_token_if_needed(profile: Profile, db: AsyncSession) -> str:
    """Checks if the access token is expired, refreshes it if necessary, and returns the valid access token."""
    if not profile.strava_access_token or not profile.strava_refresh_token:
        return None
        
    current_time = int(time.time())
    # Add a 5 minute buffer
    if profile.strava_expires_at and current_time < (profile.strava_expires_at - 300):
        return profile.strava_access_token
        
    logger.info(f"Strava token expired for user {profile.id}, refreshing...")
    async with httpx.AsyncClient() as client:
        res = await client.post("https://www.strava.com/oauth/token", data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "refresh_token": profile.strava_refresh_token,
            "grant_type": "refresh_token"
        })
        
        if res.status_code != 200:
            logger.error(f"Failed to refresh Strava token: {res.text}")
            return None
            
        data = res.json()
        profile.strava_access_token = data.get("access_token")
        profile.strava_refresh_token = data.get("refresh_token")
        profile.strava_expires_at = data.get("expires_at")
        
        await db.commit()
        return profile.strava_access_token

@router.get("/status")
async def get_strava_status(user_id: str):
    """Check if the user has connected their Strava account."""
    async with async_session_maker() as db:
        result = await db.execute(select(Profile).where(Profile.id == user_id))
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="User not found")
            
        return {
            "connected": bool(profile.strava_access_token and profile.strava_refresh_token)
        }

@router.get("/auth-url")
async def get_strava_auth_url(user_id: str, redirect_uri: str = Query(None)):
    """Returns the Strava OAuth authorization URL, embedding the user_id in the state parameter."""
    # Allow the frontend to pass its own origin (e.g. https://raw-surf.com/surf-log)
    # This prevents hardcoded localhost issues when deployed to production.
    # Strava's own OAuth dashboard will enforce security validation on this URI.
    if not redirect_uri:
        redirect_uri = f"{FRONTEND_URL}/surf-log"
        
    url = f"https://www.strava.com/oauth/authorize?client_id={STRAVA_CLIENT_ID}&response_type=code&redirect_uri={redirect_uri}&approval_prompt=force&scope=activity:read_all&state={user_id}"
    return {"url": url}

@router.get("/callback")
async def strava_callback(code: str, state: str, error: str = None):
    """Exchanges the OAuth code for an access token. Called by the frontend."""
    if error:
        raise HTTPException(status_code=400, detail=f"Strava auth error: {error}")
        
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
        
    user_id = state
    
    async with httpx.AsyncClient() as client:
        res = await client.post("https://www.strava.com/oauth/token", data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code"
        })
        
        if res.status_code != 200:
            logger.error(f"Strava token exchange failed: {res.text}")
            raise HTTPException(status_code=400, detail="Strava token exchange failed")
            
        data = res.json()
        
        # Save to database
        async with async_session_maker() as db:
            result = await db.execute(select(Profile).where(Profile.id == user_id))
            profile = result.scalar_one_or_none()
            
            if profile:
                profile.strava_access_token = data.get("access_token")
                profile.strava_refresh_token = data.get("refresh_token")
                profile.strava_expires_at = data.get("expires_at")
                await db.commit()
                
    return {"success": True, "connected": True}

@router.get("/sync-recent")
async def sync_recent_activity(user_id: str):
    """Fetches the most recent surfing activity from Strava for the user."""
    async with async_session_maker() as db:
        result = await db.execute(select(Profile).where(Profile.id == user_id))
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="User not found")
            
        access_token = await refresh_strava_token_if_needed(profile, db)
        
        if not access_token:
            raise HTTPException(status_code=401, detail="Strava account not connected or token invalid")

    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://www.strava.com/api/v3/athlete/activities?per_page=5", 
            headers={"Authorization": f"Bearer {access_token}"}
        )
            
        if res.status_code != 200:
            logger.error(f"Failed to fetch Strava activities: {res.text}")
            raise HTTPException(status_code=res.status_code, detail="Failed to fetch activities from Strava")
            
        activities = res.json()
        if not activities:
            raise HTTPException(status_code=404, detail="No recent activities found on Strava")
            
        # Try to find a Surfing activity, fallback to the most recent activity
        surf_activity = next((act for act in activities if act.get("type") == "Surfing" or act.get("sport_type") == "Surfing"), activities[0])
        
        # Calculate metrics from the Strava activity object
        distance = surf_activity.get("distance", 0)
        top_speed = surf_activity.get("max_speed", 0)
        duration_minutes = surf_activity.get("elapsed_time", 0) / 60
        
        # Simulate a realistic wave count based on distance and duration since Strava lacks it natively without fetching heavy streams
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
