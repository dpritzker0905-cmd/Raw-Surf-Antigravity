"""
Uploads package — modular decomposition of the uploads domain.

Modules:
  - core.py:          Diagnostics, general upload, story, conditions, avatar, static serving
  - media.py:         Feed uploads, wave videos
  - media_gallery.py: User/photographer galleries, watermark test, session photos

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter()

from .core import router as core_router
from .media import router as media_router
from .media_gallery import router as media_gallery_router
from .comments import router as comments_router

router.include_router(core_router)
router.include_router(media_router)
router.include_router(media_gallery_router)
router.include_router(comments_router)
