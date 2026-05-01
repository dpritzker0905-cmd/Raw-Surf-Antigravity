"""
Messages package — modular decomposition of the messages domain.

Modules:
  - schemas.py:        Pydantic models, helpers, constants
  - conversations.py:  Thread management, send, list, accept, pin, mute, family
  - features.py:       Reactions, typing, voice notes, media upload, cleanup

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter()

from .conversations import router as conversations_router
from .features import router as features_router

router.include_router(conversations_router)
router.include_router(features_router)
