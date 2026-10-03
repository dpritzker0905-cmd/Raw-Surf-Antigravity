"""
gallery/gallery_find_me.py â€” AI "Find Me" surfer identification in galleries.

Extracted from admin.py (v85) to maintain <800 LOC per module.
Declines unavailable photo matching before scan charges or claim writes.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from core.security import get_current_user_id
from services.ai_identity_matching import MATCHING_UNAVAILABLE_MESSAGE

gallery_logger = logging.getLogger("routes.gallery")

router = APIRouter()


# ============ AI "FIND ME" IN GALLERY ============


class FindMeRequest(BaseModel):
    selfie_url: str
    board_description: Optional[str] = None
    wetsuit_description: Optional[str] = None
    rash_guard_description: Optional[str] = None
    stance: Optional[str] = None  # 'regular' or 'goofy'


@router.post("/gallery/{gallery_id}/find-me")
async def find_me_in_gallery(gallery_id: str, data: FindMeRequest,
                             user_id: Optional[str] = None,
                             current_user_id: str = Depends(get_current_user_id)):
    """Decline unavailable matching before profile reads, scan charges or notifications."""
    if user_id is not None and user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot scan photos for another account")
    raise HTTPException(status_code=503, detail=MATCHING_UNAVAILABLE_MESSAGE)
