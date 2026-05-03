"""Auth package -- authentication, registration, password reset."""
from fastapi import APIRouter

from .auth import router as auth_router
from .password_reset import router as password_reset_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(password_reset_router)
