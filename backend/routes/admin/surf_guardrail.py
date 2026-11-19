"""Admin · Surf Forecast · Guardrail (D-065): GET /admin/surf-forecast/guardrail — read-only (services/admin_guardrail_view).

The guardrail workflow alone writes the runtime manifest; nothing here writes it. A re-enable is the owner's
workflow_dispatch, and the response carries the link to it.
"""
import asyncio

from fastapi import APIRouter, Depends

from deps.admin_auth import get_current_admin
from models import Profile
from services.admin_guardrail_view import cached_guardrail_view

router = APIRouter()


@router.get("/admin/surf-forecast/guardrail")
async def get_guardrail(admin: Profile = Depends(get_current_admin)):
    return await asyncio.to_thread(cached_guardrail_view)   # two private-bucket reads at most once a minute, off the loop
