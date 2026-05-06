"""
Meta Graph API Integration for Direct Facebook/Instagram Sharing
Allows users to connect their Meta accounts and post directly to their feeds.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import os
import httpx

from database import get_db
from models import Profile, Post

router = APIRouter()

# Meta App Credentials
META_APP_ID = os.environ.get('META_APP_ID')
META_APP_SECRET = os.environ.get('META_APP_SECRET')
APP_URL = os.environ.get('APP_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Meta OAuth endpoints
META_OAUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth"
META_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token"
META_GRAPH_URL = "https://graph.facebook.com/v19.0"


class MetaTokenResponse(BaseModel):
    """Response from Meta token exchange"""
    access_token: str
    token_type: str = "bearer"
    expires_in: Optional[int] = None


class ShareToFeedRequest(BaseModel):
    """Request to share a post to Facebook or Instagram"""
    post_id: str
    platform: str  # 'facebook' or 'instagram'
    message: Optional[str] = None  # Custom caption override


class MetaAccountInfo(BaseModel):
    """User's connected Meta account info"""
    facebook_connected: bool = False
    facebook_name: Optional[str] = None
    instagram_connected: bool = False
    instagram_username: Optional[str] = None
    pages: list = []


@router.get("/meta/oauth-url")
async def get_meta_oauth_url(
    user_id: str,
    redirect_uri: Optional[str] = None
):
    """
    Generate the Meta OAuth authorization URL.
    User will be redirected to Facebook to grant permissions.
    
    Required permissions for direct posting:
    - pages_manage_posts: Post to Facebook Pages
    - pages_read_engagement: Read Page info
    - instagram_basic: Access Instagram Business account
    - instagram_content_publish: Publish to Instagram
    - business_management: Access Business accounts
    """
    if not META_APP_ID:
        raise HTTPException(status_code=500, detail="Meta App ID not configured")
    
    # Default redirect URI
    final_redirect = redirect_uri or f"{APP_URL}/settings/meta-callback"
    
    # Required scopes for direct posting
    scopes = [
        "pages_manage_posts",
        "pages_read_engagement", 
        "instagram_basic",
        "instagram_content_publish",
        "business_management",
        "public_profile"
    ]
    
    # Build OAuth URL
    oauth_url = (
        f"{META_OAUTH_URL}"
        f"?client_id={META_APP_ID}"
        f"&redirect_uri={final_redirect}"
        f"&scope={','.join(scopes)}"
        f"&state={user_id}"  # Pass user_id in state for callback
        f"&response_type=code"
    )
    
    return {
        "oauth_url": oauth_url,
        "redirect_uri": final_redirect
    }


@router.get("/meta/callback")
async def handle_meta_callback(
    code: str,
    state: str,  # Contains user_id
    redirect_uri: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Handle OAuth callback from Meta.
    Exchange authorization code for access token and store it.
    """
    if not META_APP_ID or not META_APP_SECRET:
        raise HTTPException(status_code=500, detail="Meta credentials not configured")
    
    user_id = state
    final_redirect = redirect_uri or f"{APP_URL}/settings/meta-callback"
    
    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        try:
            token_response = await client.get(
                META_TOKEN_URL,
                params={
                    "client_id": META_APP_ID,
                    "client_secret": META_APP_SECRET,
                    "redirect_uri": final_redirect,
                    "code": code
                }
            )
            
            if token_response.status_code != 200:
                error_data = token_response.json()
                raise HTTPException(
                    status_code=400, 
                    detail=f"Meta token exchange failed: {error_data.get('error', {}).get('message', 'Unknown error')}"
                )
            
            token_data = token_response.json()
            access_token = token_data.get("access_token")
            
            # Get long-lived token (60 days instead of 1 hour)
            long_token_response = await client.get(
                f"{META_GRAPH_URL}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": META_APP_ID,
                    "client_secret": META_APP_SECRET,
                    "fb_exchange_token": access_token
                }
            )
            
            if long_token_response.status_code == 200:
                long_token_data = long_token_response.json()
                access_token = long_token_data.get("access_token", access_token)
            
            # Get user's Facebook Pages and Instagram accounts
            pages_response = await client.get(
                f"{META_GRAPH_URL}/me/accounts",
                params={"access_token": access_token}
            )
            pages = pages_response.json().get("data", []) if pages_response.status_code == 200 else []
            
            # For each page, get connected Instagram Business account
            instagram_accounts = []
            for page in pages:
                page_id = page.get("id")
                page_token = page.get("access_token")
                
                ig_response = await client.get(
                    f"{META_GRAPH_URL}/{page_id}",
                    params={
                        "access_token": page_token,
                        "fields": "instagram_business_account"
                    }
                )
                
                if ig_response.status_code == 200:
                    ig_data = ig_response.json()
                    ig_account = ig_data.get("instagram_business_account")
                    if ig_account:
                        # Get Instagram account details
                        ig_details_response = await client.get(
                            f"{META_GRAPH_URL}/{ig_account['id']}",
                            params={
                                "access_token": page_token,
                                "fields": "username,name,profile_picture_url"
                            }
                        )
                        if ig_details_response.status_code == 200:
                            ig_details = ig_details_response.json()
                            instagram_accounts.append({
                                "ig_id": ig_account["id"],
                                "page_id": page_id,
                                "page_token": page_token,
                                "username": ig_details.get("username"),
                                "name": ig_details.get("name"),
                                "profile_picture": ig_details.get("profile_picture_url")
                            })
            
            # Store tokens in user profile
            result = await db.execute(select(Profile).where(Profile.id == user_id))
            profile = result.scalar_one_or_none()
            
            if not profile:
                raise HTTPException(status_code=404, detail="User not found")
            
            # Store Meta connection data as JSON in a new field
            # We'll use the profile's existing settings or create a meta_connections dict
            meta_data = {
                "access_token": access_token,
                "connected_at": datetime.now(timezone.utc).isoformat(),
                "pages": [{"id": p["id"], "name": p["name"], "token": p["access_token"]} for p in pages],
                "instagram_accounts": instagram_accounts
            }
            
            # Store in profile (we'll add meta_connections field)
            profile.meta_connections = meta_data
            await db.commit()
            
            return {
                "success": True,
                "message": "Meta accounts connected successfully",
                "pages_connected": len(pages),
                "instagram_connected": len(instagram_accounts) > 0,
                "instagram_accounts": [
                    {"username": ig["username"], "name": ig["name"]} 
                    for ig in instagram_accounts
                ]
            }
            
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Failed to connect to Meta: {str(e)}")


@router.get("/meta/status")
async def get_meta_connection_status(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if user has connected their Meta (Facebook/Instagram) accounts.
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    meta_data = getattr(profile, 'meta_connections', None) or {}
    
    pages = meta_data.get("pages", [])
    instagram_accounts = meta_data.get("instagram_accounts", [])
    
    return MetaAccountInfo(
        facebook_connected=len(pages) > 0,
        facebook_name=pages[0]["name"] if pages else None,
        instagram_connected=len(instagram_accounts) > 0,
        instagram_username=instagram_accounts[0]["username"] if instagram_accounts else None,
        pages=[{"id": p["id"], "name": p["name"]} for p in pages]
    )


@router.delete("/meta/disconnect")
async def disconnect_meta_account(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Disconnect Meta accounts from user profile.
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    profile.meta_connections = None
    await db.commit()
    
    return {"success": True, "message": "Meta accounts disconnected"}


@router.post("/meta/share-to-facebook")
async def share_to_facebook(
    user_id: str,
    data: ShareToFeedRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Share a post directly to the user's Facebook Page.
    Requires pages_manage_posts permission.
    """
    # Get user profile with Meta connections
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    meta_data = getattr(profile, 'meta_connections', None)
    if not meta_data or not meta_data.get("pages"):
        raise HTTPException(
            status_code=400, 
            detail="No Facebook Page connected. Please connect your Meta account first."
        )
    
    # Get the post to share
    post_result = await db.execute(select(Post).where(Post.id == data.post_id))
    post = post_result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get page token (use first connected page)
    page = meta_data["pages"][0]
    page_id = page["id"]
    page_token = page["token"]
    
    # Build the message
    message = data.message or post.caption or "Check out this surf session! 🏄"
    
    # Add location if available
    if post.location:
        message += f"\n📍 {post.location}"
    
    # Add conditions if available
    conditions = []
    if post.wave_height_ft:
        conditions.append(f"{post.wave_height_ft}ft waves")
    if post.wind_speed_mph:
        conditions.append(f"{post.wind_speed_mph}mph wind")
    if conditions:
        message += f"\n🌊 {' | '.join(conditions)}"
    
    message += "\n\n#RawSurf #SurfSession"
    
    async with httpx.AsyncClient() as client:
        try:
            # Post with photo to Facebook Page
            if post.media_url:
                # Use photo posting endpoint
                response = await client.post(
                    f"{META_GRAPH_URL}/{page_id}/photos",
                    data={
                        "url": post.media_url,
                        "message": message,
                        "access_token": page_token
                    }
                )
            else:
                # Text-only post
                response = await client.post(
                    f"{META_GRAPH_URL}/{page_id}/feed",
                    data={
                        "message": message,
                        "access_token": page_token
                    }
                )
            
            if response.status_code != 200:
                error_data = response.json()
                error_msg = error_data.get("error", {}).get("message", "Unknown error")
                raise HTTPException(status_code=400, detail=f"Facebook posting failed: {error_msg}")
            
            result_data = response.json()
            
            return {
                "success": True,
                "platform": "facebook",
                "post_id": result_data.get("id") or result_data.get("post_id"),
                "message": "Successfully posted to Facebook!"
            }
            
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Failed to post to Facebook: {str(e)}")


@router.post("/meta/share-to-instagram")
async def share_to_instagram(
    user_id: str,
    data: ShareToFeedRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Share a post directly to the user's Instagram Business account.
    Requires instagram_content_publish permission.
    
    Instagram Content Publishing API flow:
    1. Create a media container with the image URL
    2. Publish the media container to the feed
    """
    # Get user profile with Meta connections
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    meta_data = getattr(profile, 'meta_connections', None)
    instagram_accounts = meta_data.get("instagram_accounts", []) if meta_data else []
    
    if not instagram_accounts:
        raise HTTPException(
            status_code=400, 
            detail="No Instagram Business account connected. Please connect your Meta account first."
        )
    
    # Get the post to share
    post_result = await db.execute(select(Post).where(Post.id == data.post_id))
    post = post_result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if not post.media_url:
        raise HTTPException(status_code=400, detail="Post must have an image to share to Instagram")
    
    # Get Instagram account info
    ig_account = instagram_accounts[0]
    ig_user_id = ig_account["ig_id"]
    access_token = ig_account["page_token"]  # Use the Page token for IG API
    
    # Build the caption
    caption = data.message or post.caption or "Epic surf session! 🏄"
    
    if post.location:
        caption += f"\n📍 {post.location}"
    
    # Add conditions
    conditions = []
    if post.wave_height_ft:
        conditions.append(f"{post.wave_height_ft}ft waves")
    if post.wind_speed_mph:
        conditions.append(f"{post.wind_speed_mph}mph wind")
    if conditions:
        caption += f"\n🌊 {' | '.join(conditions)}"
    
    caption += "\n\n#RawSurf #SurfSession #Surfing #Waves"
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            # Step 1: Create media container
            # For images, use image_url. For videos (Reels), use video_url and media_type=REELS
            is_video = post.media_type == 'video'
            
            if is_video:
                # Create Reels container
                container_response = await client.post(
                    f"{META_GRAPH_URL}/{ig_user_id}/media",
                    data={
                        "video_url": post.media_url,
                        "caption": caption,
                        "media_type": "REELS",
                        "access_token": access_token
                    }
                )
            else:
                # Create image container
                container_response = await client.post(
                    f"{META_GRAPH_URL}/{ig_user_id}/media",
                    data={
                        "image_url": post.media_url,
                        "caption": caption,
                        "access_token": access_token
                    }
                )
            
            if container_response.status_code != 200:
                error_data = container_response.json()
                error_msg = error_data.get("error", {}).get("message", "Unknown error")
                raise HTTPException(status_code=400, detail=f"Instagram container creation failed: {error_msg}")
            
            container_data = container_response.json()
            creation_id = container_data.get("id")
            
            if not creation_id:
                raise HTTPException(status_code=400, detail="Failed to create Instagram media container")
            
            # For videos, we need to wait for processing
            if is_video:
                # Poll for container status
                import asyncio
                for _ in range(30):  # Max 5 minutes (30 * 10 seconds)
                    await asyncio.sleep(10)
                    status_response = await client.get(
                        f"{META_GRAPH_URL}/{creation_id}",
                        params={
                            "fields": "status_code",
                            "access_token": access_token
                        }
                    )
                    if status_response.status_code == 200:
                        status_data = status_response.json()
                        status_code = status_data.get("status_code")
                        if status_code == "FINISHED":
                            break
                        elif status_code == "ERROR":
                            raise HTTPException(status_code=400, detail="Instagram video processing failed")
            
            # Step 2: Publish the container
            publish_response = await client.post(
                f"{META_GRAPH_URL}/{ig_user_id}/media_publish",
                data={
                    "creation_id": creation_id,
                    "access_token": access_token
                }
            )
            
            if publish_response.status_code != 200:
                error_data = publish_response.json()
                error_msg = error_data.get("error", {}).get("message", "Unknown error")
                raise HTTPException(status_code=400, detail=f"Instagram publishing failed: {error_msg}")
            
            publish_data = publish_response.json()
            
            return {
                "success": True,
                "platform": "instagram",
                "media_id": publish_data.get("id"),
                "username": ig_account["username"],
                "message": f"Successfully posted to Instagram (@{ig_account['username']})!"
            }
            
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Failed to post to Instagram: {str(e)}")
