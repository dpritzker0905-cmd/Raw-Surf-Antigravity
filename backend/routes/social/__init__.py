"""Social package — social interactions, friends, blocks, shaka."""
from fastapi import APIRouter

from .social import router as social_router
from .friends import router as friends_router
from .blocks import router as blocks_router
from .shaka import router as shaka_router

router = APIRouter()
router.include_router(social_router)
router.include_router(friends_router)
router.include_router(blocks_router)
router.include_router(shaka_router)
