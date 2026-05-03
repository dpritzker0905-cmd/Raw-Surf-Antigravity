"""Profiles package — user profiles, content, username, media."""
from fastapi import APIRouter

from .profiles import router as profiles_router
from .profile_content import router as profile_content_router
from .username import router as username_router
from .user_media import router as user_media_router

router = APIRouter()
router.include_router(profiles_router)
router.include_router(profile_content_router)
router.include_router(username_router)
router.include_router(user_media_router)
