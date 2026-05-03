"""Surf Data package — conditions, reports, alerts, waves, surf log, surfboards."""
from fastapi import APIRouter

from .conditions import router as conditions_router
from .surf_reports import router as surf_reports_router
from .alerts import router as alerts_router
from .waves import router as waves_router
from .surf_log import router as surf_log_router
from .surfboards import router as surfboards_router

router = APIRouter()
router.include_router(conditions_router)
router.include_router(surf_reports_router)
router.include_router(alerts_router)
router.include_router(waves_router)
router.include_router(surf_log_router)
router.include_router(surfboards_router)
