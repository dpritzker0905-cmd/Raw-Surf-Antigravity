from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
import os
import httpx
import logging
from database import get_db, async_session_maker
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from models import Profile, StravaOAuthState
from core.security import get_current_user_id
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
import hashlib
import secrets
import time

logger = logging.getLogger(__name__)

router = APIRouter()

STRAVA_CLIENT_ID = os.environ.get("STRAVA_CLIENT_ID", "")
STRAVA_CLIENT_SECRET = os.environ.get("STRAVA_CLIENT_SECRET", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

def require_strava_configuration():
    if not STRAVA_CLIENT_ID or not STRAVA_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Strava integration is not configured")


async def refresh_strava_token_if_needed(profile: Profile, db: AsyncSession) -> str:
    """Checks if the access token is expired, refreshes it if necessary, and returns the valid access token."""
    if not profile.strava_access_token or not profile.strava_refresh_token:
        return None
    require_strava_configuration()
        
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
            logger.warning("Strava refresh failed status=%s", res.status_code)
            return None
            
        data = res.json()
        profile.strava_access_token = data.get("access_token")
        profile.strava_refresh_token = data.get("refresh_token")
        profile.strava_expires_at = data.get("expires_at")
        
        await db.commit()
        return profile.strava_access_token

@router.get("/status")
async def get_strava_status(user_id: str, current_user_id: str = Depends(get_current_user_id)):
    """Check if the user has connected their Strava account."""
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this user")
    async with async_session_maker() as db:
        result = await db.execute(select(Profile).where(Profile.id == user_id))
        profile = result.scalar_one_or_none()
        
        if not profile:
            raise HTTPException(status_code=404, detail="User not found")
            
        return {
            "connected": bool(profile.strava_access_token and profile.strava_refresh_token)
        }

def _redirect_target(redirect_uri):
    target = redirect_uri or f"{FRONTEND_URL.rstrip('/')}/surf-log"
    origins = os.environ.get("STRAVA_REDIRECT_ORIGINS", FRONTEND_URL).split(",")
    allowed = {f"{origin.strip().rstrip('/')}/surf-log" for origin in origins if origin.strip()}
    parsed = urlsplit(target)
    if target not in allowed or parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Invalid Strava redirect URI")
    return target


@router.get("/auth-url")
async def get_strava_auth_url(user_id: str, redirect_uri: str = Query(None),
                             current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """Issue a short-lived, opaque state bound to the verified linking account."""
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this user")
    require_strava_configuration()
    redirect_uri = _redirect_target(redirect_uri)
    profile = (await db.execute(select(Profile).where(Profile.id == current_user_id))).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    state = secrets.token_urlsafe(32)
    db.add(StravaOAuthState(state_hash=hashlib.sha256(state.encode()).hexdigest(), user_id=current_user_id,
                           expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)))
    await db.commit()
    query = urlencode({"client_id": STRAVA_CLIENT_ID, "response_type": "code", "redirect_uri": redirect_uri,
                       "approval_prompt": "force", "scope": "activity:read_all", "state": state})
    return {"url": "https://www.strava.com/oauth/authorize?" + query}


@router.get("/callback")
async def strava_callback(code: str, state: str, error: str = None,
                          current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """Frontend callback: verified session plus atomic, expiring one-use linking state."""
    require_strava_configuration()
    if error:
        raise HTTPException(status_code=400, detail="Strava authorization was denied")
    if not code or not state or len(state) < 32 or len(state) > 128:
        raise HTTPException(status_code=400, detail="Invalid or expired Strava authorization state")
    profile = (await db.execute(select(Profile).where(Profile.id == current_user_id))).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    now = datetime.now(timezone.utc)
    claim = await db.execute(update(StravaOAuthState).where(
        StravaOAuthState.state_hash == hashlib.sha256(state.encode()).hexdigest(),
        StravaOAuthState.user_id == current_user_id,
        StravaOAuthState.expires_at > now,
        StravaOAuthState.consumed_at.is_(None),
    ).values(consumed_at=now).returning(StravaOAuthState.user_id))
    if claim.scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="Invalid or expired Strava authorization state")
    # Persist the one-use claim before provider I/O: concurrent callbacks and failed exchanges
    # cannot reuse it. A provider failure requires starting a new authorization flow.
    await db.commit()
    async with httpx.AsyncClient() as client:
        res = await client.post("https://www.strava.com/oauth/token", data={
            "client_id": STRAVA_CLIENT_ID, "client_secret": STRAVA_CLIENT_SECRET,
            "code": code, "grant_type": "authorization_code"})
    if res.status_code != 200:
        logger.warning("Strava token exchange failed status=%s", res.status_code)
        raise HTTPException(status_code=400, detail="Strava token exchange failed; please reconnect")
    try:
        data = res.json()
    except ValueError:
        data = None
    if not isinstance(data, dict) or any(not isinstance(data.get(k), str) or not data[k].strip()
                                         for k in ("access_token", "refresh_token")):
        raise HTTPException(status_code=502, detail="Invalid Strava token response")
    expires_at = data.get("expires_at")
    if isinstance(expires_at, bool) or not isinstance(expires_at, int) or expires_at <= int(time.time()):
        raise HTTPException(status_code=502, detail="Invalid Strava token response")
    profile.strava_access_token = data["access_token"]
    profile.strava_refresh_token = data["refresh_token"]
    profile.strava_expires_at = expires_at
    await db.commit()
    return {"success": True, "connected": True}

@router.get("/sync-recent")
async def sync_recent_activity(user_id: str, current_user_id: str = Depends(get_current_user_id)):
    """Fetches the most recent surfing activity from Strava for the user."""
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Not authorized for this user")
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
            logger.warning("Strava activities fetch failed status=%s", res.status_code)
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
