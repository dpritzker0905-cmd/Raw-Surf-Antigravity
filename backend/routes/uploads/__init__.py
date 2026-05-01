"""
Uploads package — modular decomposition of the uploads domain.

Modules:
  - core.py:   Diagnostics, general upload, story, conditions, avatar, static serving
  - media.py:  Feed uploads, wave videos, user/photographer galleries, watermark, session photos

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter()

from .core import router as core_router
from .media import router as media_router

router.include_router(core_router)
router.include_router(media_router)
