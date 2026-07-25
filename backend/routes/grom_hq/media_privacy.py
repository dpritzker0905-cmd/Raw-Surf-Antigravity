"""JWT-bound guardian controls for Grom post and story visibility."""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user_id
from database import get_db
from models import Post, Profile, RoleEnum, Story
from services.grom_media_policy import (
    apply_guardian_visibility_cap,
    audience_is_within_cap,
    effective_visibility_cap,
    enforce_sitewide_visibility_cap,
    is_verified_guardian,
    mark_guardian_approval,
    normalize_controls,
)

router = APIRouter()
Audience = Literal['guardian_only', 'followers', 'public']
PublishAudience = Literal['followers', 'public']


class GromMediaPolicyUpdate(BaseModel):
    can_post: Optional[bool] = None
    sitewide_media_max_visibility: Optional[Audience] = None
    # Deprecated input retained only so existing clients cannot silently bypass the canonical control.
    media_max_visibility: Optional[Audience] = None
    require_media_approval: Optional[bool] = None


class GromMediaPrivacyCap(BaseModel):
    max_visibility: Audience


class GromMediaApproval(BaseModel):
    visibility: Optional[PublishAudience] = None


async def _grom_or_404(db: AsyncSession, grom_id: str) -> Profile:
    result = await db.execute(select(Profile).where(Profile.id == grom_id))
    grom = result.scalar_one_or_none()
    if not grom or grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=404, detail='Grom profile not found')
    return grom


async def _require_guardian(db: AsyncSession, grom: Profile, actor_id: str) -> None:
    if not await is_verified_guardian(db, grom, actor_id):
        raise HTTPException(status_code=403, detail='Verified guardian authorization required')


async def _media_or_404(db: AsyncSession, model, media_id: str, grom_id: str):
    result = await db.execute(select(model).where(model.id == media_id, model.author_id == grom_id))
    media = result.scalar_one_or_none()
    if not media:
        raise HTTPException(status_code=404, detail='Grom media not found')
    return media


async def _set_media_cap(db: AsyncSession, model, *, grom: Profile, media_id: str, guardian_id: str, cap: str):
    media = await _media_or_404(db, model, media_id, grom.id)
    controls = normalize_controls(grom)
    try:
        effective_cap = apply_guardian_visibility_cap(
            media, guardian_id=guardian_id, controls=controls, cap=cap
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return {'media_id': media.id, 'max_visibility': cap, 'effective_max_visibility': effective_cap,
            'visibility': media.visibility, 'status': media.guardian_approval_status}


async def _approve_media(db: AsyncSession, model, *, grom: Profile, media_id: str, guardian_id: str, visibility: str | None):
    media = await _media_or_404(db, model, media_id, grom.id)
    controls = normalize_controls(grom)
    requested = visibility or media.requested_visibility
    cap = effective_visibility_cap(controls, media.guardian_visibility_cap)
    if not requested or not audience_is_within_cap(requested, cap):
        raise HTTPException(status_code=400, detail='Requested audience exceeds guardian policy')
    mark_guardian_approval(media, guardian_id=guardian_id, visibility=requested)
    await db.commit()
    return {'media_id': media.id, 'visibility': media.visibility, 'status': media.guardian_approval_status}


async def _make_media_private(db: AsyncSession, model, *, grom: Profile, media_id: str, actor_id: str):
    media = await _media_or_404(db, model, media_id, grom.id)
    is_owner = actor_id == grom.id
    if not is_owner:
        await _require_guardian(db, grom, actor_id)
    media.visibility = 'guardian_only'
    media.guardian_approval_status = 'self_private' if is_owner else 'restricted_by_guardian'
    media.visibility_changed_at = datetime.now(timezone.utc)
    await db.commit()
    return {'media_id': media.id, 'visibility': media.visibility, 'status': media.guardian_approval_status}


@router.get('/groms/{grom_id}/media-policy')
async def get_grom_media_policy(grom_id: str, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    if current_user_id != grom_id and not await is_verified_guardian(db, grom, current_user_id):
        raise HTTPException(status_code=403, detail='Not authorized to view Grom media policy')
    return {'grom_id': grom.id, 'controls': normalize_controls(grom)}


@router.put('/groms/{grom_id}/media-policy')
async def update_grom_media_policy(grom_id: str, update: GromMediaPolicyUpdate, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    controls = dict(grom.parental_controls or {})
    if update.can_post is not None:
        controls['can_post'] = update.can_post
    requested_cap = update.sitewide_media_max_visibility or update.media_max_visibility
    if requested_cap is not None:
        controls['sitewide_media_max_visibility'] = requested_cap
        controls.pop('media_max_visibility', None)
    if update.require_media_approval is not None:
        controls['require_media_approval'] = update.require_media_approval
    grom.parental_controls = controls
    normalized = normalize_controls(grom)
    if requested_cap is not None:
        for model in (Post, Story):
            result = await db.execute(select(model).where(model.author_id == grom.id))
            for media in result.scalars().all():
                enforce_sitewide_visibility_cap(media, controls=normalized)
    await db.commit()
    return {'grom_id': grom.id, 'controls': normalized}


@router.get('/groms/{grom_id}/pending-media-posts')
async def pending_grom_media(grom_id: str, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    posts = (await db.execute(select(Post).where(Post.author_id == grom_id, Post.guardian_approval_status == 'pending_parent_approval').order_by(Post.created_at.desc()))).scalars().all()
    stories = (await db.execute(select(Story).where(Story.author_id == grom_id, Story.guardian_approval_status == 'pending_parent_approval').order_by(Story.created_at.desc()))).scalars().all()
    return {
        'posts': [{'id': item.id, 'requested_visibility': item.requested_visibility, 'caption': item.caption, 'media_type': item.media_type, 'created_at': item.created_at} for item in posts],
        'stories': [{'id': item.id, 'requested_visibility': item.requested_visibility, 'caption': item.caption, 'media_type': item.media_type, 'created_at': item.created_at} for item in stories],
    }


@router.put('/groms/{grom_id}/media-posts/{post_id}/privacy-cap')
async def set_post_privacy_cap(grom_id: str, post_id: str, override: GromMediaPrivacyCap, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    return await _set_media_cap(db, Post, grom=grom, media_id=post_id, guardian_id=current_user_id, cap=override.max_visibility)


@router.put('/groms/{grom_id}/media-stories/{story_id}/privacy-cap')
async def set_story_privacy_cap(grom_id: str, story_id: str, override: GromMediaPrivacyCap, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    return await _set_media_cap(db, Story, grom=grom, media_id=story_id, guardian_id=current_user_id, cap=override.max_visibility)


@router.post('/groms/{grom_id}/media-posts/{post_id}/approve')
async def approve_grom_media_post(grom_id: str, post_id: str, approval: GromMediaApproval, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    return await _approve_media(db, Post, grom=grom, media_id=post_id, guardian_id=current_user_id, visibility=approval.visibility)


@router.post('/groms/{grom_id}/media-stories/{story_id}/approve')
async def approve_grom_media_story(grom_id: str, story_id: str, approval: GromMediaApproval, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    return await _approve_media(db, Story, grom=grom, media_id=story_id, guardian_id=current_user_id, visibility=approval.visibility)


@router.post('/groms/{grom_id}/media-posts/{post_id}/make-private')
async def make_grom_media_post_private(grom_id: str, post_id: str, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    return await _make_media_private(db, Post, grom=grom, media_id=post_id, actor_id=current_user_id)


@router.post('/groms/{grom_id}/media-stories/{story_id}/make-private')
async def make_grom_media_story_private(grom_id: str, story_id: str, current_user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    grom = await _grom_or_404(db, grom_id)
    return await _make_media_private(db, Story, grom=grom, media_id=story_id, actor_id=current_user_id)
