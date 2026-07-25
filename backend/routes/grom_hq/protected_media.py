"""JWT-bound protected Grom-media upload and delivery endpoints.

Rows retain ``supabase://grom_media/...`` references. This module is the sole
place that turns those references into short-lived delivery URLs for Grom posts
and stories, after applying the same guardian and audience policy as content
routes. It intentionally does not expose arbitrary bucket/object-key signing.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.security import get_current_user_id
from database import get_db
from models import Follow, Post, Profile, RoleEnum, Story
from services.grom_media_policy import is_verified_guardian
from services.private_media import (
    parse_private_media_ref,
    signed_private_media_url,
    upload_private_media_stream,
)

router = APIRouter()
MAX_GROM_MEDIA_BYTES = 100 * 1024 * 1024
STREAM_CHUNK_BYTES = 1024 * 1024
MediaKind = Literal['post', 'story']
ALLOWED_MEDIA_TYPES = frozenset({
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/3gpp',
})


async def _grom_or_404(db: AsyncSession, grom_id: str) -> Profile:
    grom = (await db.execute(select(Profile).where(Profile.id == grom_id))).scalar_one_or_none()
    if not grom or grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=404, detail='Grom profile not found')
    return grom


async def _bounded_upload_chunks(file: UploadFile) -> AsyncIterator[bytes]:
    """Yield bounded chunks and reject oversized uploads before completion."""
    total = 0
    while chunk := await file.read(STREAM_CHUNK_BYTES):
        total += len(chunk)
        if total > MAX_GROM_MEDIA_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f'Grom media must be {MAX_GROM_MEDIA_BYTES // (1024 * 1024)}MB or smaller',
            )
        yield chunk


def _safe_extension(filename: str | None, content_type: str) -> str:
    extension = (filename or '').rsplit('.', 1)[-1].lower() if filename and '.' in filename else ''
    allowed_extensions = {
        'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif',
        'mp4', 'mov', 'webm', 'mpeg', '3gp',
    }
    if extension in allowed_extensions:
        return f'.{extension}'
    return '.mp4' if content_type.startswith('video/') else '.jpg'


async def can_view_grom_media(
    db: AsyncSession, *, media, grom: Profile, viewer_id: str,
) -> bool:
    """Authorize Grom post/story delivery without disclosing an object key."""
    if viewer_id == grom.id or await is_verified_guardian(db, grom, viewer_id):
        return True
    if media.guardian_approval_status != 'approved':
        return False
    if media.visibility == 'public':
        return True
    if media.visibility != 'followers':
        return False
    follows = await db.execute(
        select(Follow.id).where(Follow.follower_id == viewer_id, Follow.following_id == grom.id)
    )
    return follows.scalar_one_or_none() is not None


@router.post('/groms/{grom_id}/media')
async def upload_grom_media(
    grom_id: str,
    file: UploadFile = File(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Persist a Grom upload in the private bucket under the authenticated Grom."""
    if current_user_id != grom_id:
        raise HTTPException(status_code=403, detail='Grom media uploads must use the Grom account')
    await _grom_or_404(db, grom_id)
    content_type = (file.content_type or '').lower()
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail='Unsupported Grom media type')
    if getattr(file, 'size', None) is not None and file.size > MAX_GROM_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail='Grom media file is too large')

    object_key = f'{grom_id}/{uuid4()}{_safe_extension(file.filename, content_type)}'
    try:
        media_ref = await upload_private_media_stream(
            bucket='grom_media',
            object_key=object_key,
            content=_bounded_upload_chunks(file),
            content_type=content_type,
        )
    finally:
        await file.close()
    if not media_ref:
        raise HTTPException(status_code=503, detail='Protected media storage is temporarily unavailable')
    return {'media_ref': media_ref, 'media_type': 'video' if content_type.startswith('video/') else 'image'}


@router.get('/groms/{grom_id}/media/{kind}/{media_id}/delivery')
async def get_grom_media_delivery_url(
    grom_id: str,
    kind: MediaKind,
    media_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Return a short-lived URL only for a viewable Grom post or story."""
    model = Post if kind == 'post' else Story
    media = (
        await db.execute(
            select(model)
            .options(selectinload(model.author))
            .where(model.id == media_id, model.author_id == grom_id)
        )
    ).scalar_one_or_none()
    if not media or not media.author or media.author.role != RoleEnum.GROM:
        raise HTTPException(status_code=404, detail='Grom media not found')
    reference = parse_private_media_ref(media.media_url)
    if not reference or reference.bucket != 'grom_media':
        raise HTTPException(status_code=409, detail='Grom media is not yet protected-delivery eligible')
    if not await can_view_grom_media(db, media=media, grom=media.author, viewer_id=current_user_id):
        raise HTTPException(status_code=404, detail='Grom media not found')
    signed_url = await signed_private_media_url(media.media_url)
    if not signed_url:
        raise HTTPException(status_code=503, detail='Protected media delivery is temporarily unavailable')
    return {'url': signed_url, 'expires_in': 3600}