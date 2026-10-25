"""Auth package -- authentication, registration, password reset, two-factor."""
from fastapi import APIRouter

from .auth import router as auth_router
from .password_reset import router as password_reset_router
from .mfa import router as mfa_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(password_reset_router)
router.include_router(mfa_router)
