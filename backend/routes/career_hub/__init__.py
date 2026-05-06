"""Career Hub package — career progression, gamification, challenges, leaderboard, impact, passport."""
from fastapi import APIRouter

from .career import router as career_router
from .gamification import router as gamification_router
from .challenges import router as challenges_router
from .leaderboard import router as leaderboard_router
from .impact import router as impact_router
from .passport import router as passport_router

router = APIRouter()
router.include_router(career_router)
router.include_router(gamification_router)
router.include_router(challenges_router)
router.include_router(leaderboard_router)
router.include_router(impact_router)
router.include_router(passport_router)
