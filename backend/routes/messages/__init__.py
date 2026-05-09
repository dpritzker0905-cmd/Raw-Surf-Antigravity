"""
Messages package — modular decomposition of the messages domain.

Modules:
  - schemas.py:         Pydantic models, helpers, constants
  - conversations.py:   Thread management, send, list, accept, pin, mute
  - message_threads.py: Grom Zone, family conversations, start/decline (v90)
  - features.py:        Reactions, typing, voice notes, media upload, cleanup

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter()

from .conversations import router as conversations_router
from .message_threads import router as message_threads_router
from .features import router as features_router

router.include_router(conversations_router)
router.include_router(message_threads_router)
router.include_router(features_router)
