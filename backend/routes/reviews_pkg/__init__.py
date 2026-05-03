"""Reviews package -- photographer and session reviews."""
from fastapi import APIRouter

from .reviews import router as reviews_router

router = APIRouter()
router.include_router(reviews_router)
