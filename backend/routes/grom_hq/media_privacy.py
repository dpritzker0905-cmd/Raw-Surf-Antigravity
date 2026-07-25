"""JWT-bound guardian controls for Grom post visibility and approval."""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user_id
from database import get_db
from models import Post, Profile, RoleEnum
from services.grom_media_policy import (
    audience_is_within_cap,
    is_verified_guardian,
    mark_guardian_approval,
    normalize_controls,
)


router = APIRouter()


class GromMediaPolicyUpdate(BaseModel):
    can_post: Optional[bool] = None
    media_max_visibility: Optional[Literal['guardian_only', 'followers', 'public']] = None
    require_media_approval: Optional[bool] = None


class GromPostApproval(BaseModel):
    visibility: Optional[Literal['followers', 'public']] = None


async def _grom_or_404(db: AsyncSession, grom_id: str) -> Profile:
    result = await db.execute(select(Profile).where(Profile.id == grom_id))
    grom = result.scalar_one_or_none()
    if not grom or grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=404, detail='Grom profile not found')
    return grom


async def _require_guardian(db: AsyncSession, grom: Profile, actor_id: str) -> None:
    if not await is_verified_guardian(db, grom, actor_id):
        raise HTTPException(status_code=403, detail='Verified guardian authorization required')


@router.get('/groms/{grom_id}/media-policy')
async def get_grom_media_policy(
    grom_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    grom = await _grom_or_404(db, grom_id)
    if current_user_id != grom_id and not await is_verified_guardian(db, grom, current_user_id):
        raise HTTPException(status_code=403, detail='Not authorized to view Grom media policy')
    return {'grom_id': grom.id, 'controls': normalize_controls(grom)}


@router.put('/groms/{grom_id}/media-policy')
async def update_grom_media_policy(
    grom_id: str,
    update: GromMediaPolicyUpdate,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    controls = dict(grom.parental_controls or {})
    if update.can_post is not None:
        controls['can_post'] = update.can_post
    if update.media_max_visibility is not None:
        controls['media_max_visibility'] = update.media_max_visibility
    if update.require_media_approval is not None:
        controls['require_media_approval'] = update.require_media_approval
    grom.parental_controls = controls
    await db.commit()
    return {'grom_id': grom.id, 'controls': normalize_controls(grom)}


@router.get('/groms/{grom_id}/pending-media-posts')
async def pending_grom_media_posts(
    grom_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    result = await db.execute(
        select(Post)
        .where(Post.author_id == grom_id, Post.guardian_approval_status == 'pending_parent_approval')
        .order_by(Post.created_at.desc())
    )
    return {'posts': [
        {'id': post.id, 'requested_visibility': post.requested_visibility, 'caption': post.caption,
         'media_type': post.media_type, 'created_at': post.created_at}
        for post in result.scalars().all()
    ]}


@router.post('/groms/{grom_id}/media-posts/{post_id}/approve')
async def approve_grom_media_post(
    grom_id: str,
    post_id: str,
    approval: GromPostApproval,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    grom = await _grom_or_404(db, grom_id)
    await _require_guardian(db, grom, current_user_id)
    post_result = await db.execute(select(Post).where(Post.id == post_id, Post.author_id == grom_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail='Grom post not found')
    controls = normalize_controls(grom)
    visibility = approval.visibility or post.requested_visibility
    if not visibility or not audience_is_within_cap(visibility, controls['media_max_visibility']):
        raise HTTPException(status_code=400, detail='Requested audience exceeds guardian policy')
    mark_guardian_approval(post, guardian_id=current_user_id, visibility=visibility)
    await db.commit()
    return {'post_id': post.id, 'visibility': post.visibility, 'status': post.guardian_approval_status}


@router.post('/groms/{grom_id}/media-posts/{post_id}/make-private')
async def make_grom_media_post_private(
    grom_id: str,
    post_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    grom = await _grom_or_404(db, grom_id)
    is_owner = current_user_id == grom_id
    if not is_owner:
        await _require_guardian(db, grom, current_user_id)
    post_result = await db.execute(select(Post).where(Post.id == post_id, Post.author_id == grom_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail='Grom post not found')
    post.visibility = 'guardian_only'
    post.guardian_approval_status = 'self_private' if is_owner else 'restricted_by_guardian'
    post.visibility_changed_at = datetime.now(timezone.utc)
    await db.commit()
    return {'post_id': post.id, 'visibility': post.visibility, 'status': post.guardian_approval_status}
