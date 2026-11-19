"""Route-side helpers that write an upload's PUBLIC copy without embedded metadata (T1 P3 part 7).

Every bucket these routes store into is public (general, stories, feed, user-gallery), so a phone photo or MP4/MOV
video would otherwise publish where and when it was taken. The work is in services/media_metadata; these wrappers run
it off the event loop and turn a file that cannot be checked into a 400, so it is never published unchecked.
"""
from __future__ import annotations

import asyncio

from fastapi import HTTPException

from services.media_metadata import MetadataError, strip_stored_video, write_public_copy

UNREADABLE = "Could not read this file. Please try another photo or video."


async def store_public(content: bytes, content_type: str, is_video: bool, path) -> int:
    """Write `content` to `path` as its public copy (metadata stripped). Returns the stored size in bytes."""
    try:
        public = await asyncio.to_thread(write_public_copy, content, content_type, is_video, path)
    except MetadataError:
        raise HTTPException(status_code=400, detail=UNREADABLE)
    return public.size


async def strip_public_video(path) -> bool:
    """Strip a video already on disk (transcoded or kept raw) before it is stored publicly."""
    try:
        return await asyncio.to_thread(strip_stored_video, path)
    except MetadataError:
        raise HTTPException(status_code=400, detail=UNREADABLE)
