"""Crew package — crew chat, leaderboard, saved crews."""
from fastapi import APIRouter

from .crew_chat import router as crew_chat_router
from .crew_chat_media import router as crew_chat_media_router
from .crew_leaderboard import router as crew_leaderboard_router
from .saved_crews import router as saved_crews_router

router = APIRouter()
router.include_router(crew_chat_router)
router.include_router(crew_chat_media_router)
router.include_router(crew_leaderboard_router)
router.include_router(saved_crews_router)

