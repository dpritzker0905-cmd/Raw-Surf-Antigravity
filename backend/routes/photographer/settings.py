"""
Photographer settings — on-demand configuration and watermark customization.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import Profile, RoleEnum
from .schemas import OnDemandSettingsRequest, WatermarkSettingsRequest

router = APIRouter()


# ============ ON-DEMAND SETTINGS ============

@router.get("/photographer/{photographer_id}/on-demand-settings")
async def get_on_demand_settings(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's On-Demand settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    claimed_spots = []
    if profile.on_demand_claimed_spots:
        try:
            claimed_spots = json.loads(profile.on_demand_claimed_spots) if isinstance(profile.on_demand_claimed_spots, str) else profile.on_demand_claimed_spots
        except (ValueError, TypeError):
            claimed_spots = []
    
    return {
        "base_rate": profile.on_demand_hourly_rate or 75.0,
        "peak_pricing_enabled": profile.on_demand_peak_enabled or False,
        "peak_multiplier": profile.on_demand_peak_multiplier or 1.5,
        "claimed_spots": claimed_spots,
        "latitude": profile.on_demand_latitude,
        "longitude": profile.on_demand_longitude,
        "on_demand_photos_included": profile.on_demand_photos_included or 3,
        "on_demand_full_gallery": profile.on_demand_full_gallery or False,
        "on_demand_price_web": profile.on_demand_price_web or 5.0,
        "on_demand_price_standard": profile.on_demand_price_standard or 10.0,
        "on_demand_price_high": profile.on_demand_price_high or 18.0,
        "on_demand_video_720p": profile.on_demand_video_720p or 12.0,
        "on_demand_video_1080p": profile.on_demand_video_1080p or 20.0,
        "on_demand_video_4k": profile.on_demand_video_4k or 40.0,
        "on_demand_cancellation_fee_pct": profile.on_demand_cancellation_fee_pct if profile.on_demand_cancellation_fee_pct is not None else 100,
    }


@router.post("/photographer/{photographer_id}/on-demand-settings")
async def save_on_demand_settings(
    photographer_id: str,
    data: OnDemandSettingsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Save photographer's On-Demand settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="On-Demand settings are only available for photographers")
    
    profile.on_demand_hourly_rate = data.base_rate
    profile.on_demand_peak_enabled = data.peak_pricing_enabled
    profile.on_demand_peak_multiplier = data.peak_multiplier
    profile.on_demand_claimed_spots = json.dumps(data.claimed_spots)

    if data.on_demand_photos_included is not None:
        profile.on_demand_photos_included = max(0, data.on_demand_photos_included)
    if data.on_demand_full_gallery is not None:
        profile.on_demand_full_gallery = data.on_demand_full_gallery

    if data.on_demand_price_web is not None:
        profile.on_demand_price_web = max(0, data.on_demand_price_web)
    if data.on_demand_price_standard is not None:
        profile.on_demand_price_standard = max(0, data.on_demand_price_standard)
    if data.on_demand_price_high is not None:
        profile.on_demand_price_high = max(0, data.on_demand_price_high)
    if data.on_demand_video_720p is not None:
        profile.on_demand_video_720p = max(0, data.on_demand_video_720p)
    if data.on_demand_video_1080p is not None:
        profile.on_demand_video_1080p = max(0, data.on_demand_video_1080p)
    if data.on_demand_video_4k is not None:
        profile.on_demand_video_4k = max(0, data.on_demand_video_4k)

    if data.latitude and data.longitude:
        profile.on_demand_latitude = data.latitude
        profile.on_demand_longitude = data.longitude
    
    if data.on_demand_cancellation_fee_pct is not None:
        profile.on_demand_cancellation_fee_pct = max(0, min(100, data.on_demand_cancellation_fee_pct))
    
    await db.commit()
    return {"success": True, "message": "On-Demand settings saved successfully"}


# ============ WATERMARK SETTINGS ============

@router.put("/photographer/{photographer_id}/watermark-settings")
async def update_watermark_settings(
    photographer_id: str,
    data: WatermarkSettingsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's watermark customization settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="Only photographers can set watermark settings")
    
    if data.watermark_style not in ['text', 'logo', 'both']:
        raise HTTPException(status_code=400, detail="Invalid watermark style")
    
    valid_positions = ['center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled']
    if data.watermark_position not in valid_positions:
        raise HTTPException(status_code=400, detail="Invalid watermark position")
    
    if not 0.1 <= data.watermark_opacity <= 1.0:
        raise HTTPException(status_code=400, detail="Opacity must be between 0.1 and 1.0")
    
    profile.watermark_style = data.watermark_style
    profile.watermark_text = data.watermark_text or profile.full_name
    profile.watermark_logo_url = data.watermark_logo_url
    profile.watermark_opacity = data.watermark_opacity
    profile.watermark_position = data.watermark_position
    
    if data.default_watermark_in_selection is not None:
        profile.default_watermark_in_selection = data.default_watermark_in_selection
    
    await db.commit()
    return {
        "success": True,
        "message": "Watermark settings saved successfully",
        "settings": {
            "watermark_style": profile.watermark_style,
            "watermark_text": profile.watermark_text,
            "watermark_logo_url": profile.watermark_logo_url,
            "watermark_opacity": profile.watermark_opacity,
            "watermark_position": profile.watermark_position,
            "default_watermark_in_selection": profile.default_watermark_in_selection
        }
    }


@router.get("/photographer/{photographer_id}/watermark-settings")
async def get_watermark_settings(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's watermark customization settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    return {
        "watermark_style": profile.watermark_style or 'text',
        "watermark_text": profile.watermark_text or profile.full_name or 'Watermark',
        "watermark_logo_url": profile.watermark_logo_url,
        "watermark_opacity": profile.watermark_opacity or 0.5,
        "watermark_position": profile.watermark_position or 'bottom-right',
        "default_watermark_in_selection": profile.default_watermark_in_selection if profile.default_watermark_in_selection is not None else True
    }
