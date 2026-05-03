"""Live package — social live streaming, LiveKit, WebSocket."""
from fastapi import APIRouter

from .social_live import router as social_live_router
from .livekit import router as livekit_router
from .websocket import router as websocket_router

router = APIRouter()
router.include_router(social_live_router)
router.include_router(livekit_router)
router.include_router(websocket_router)
