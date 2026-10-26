"""Grom HQ admin — read-only guardian exposure counts (no personal data in the response)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from services.guardian_exposure import compute_exposure

router = APIRouter()


@router.get("/admin/guardian-exposure")
async def guardian_exposure(admin=Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Counts of child accounts by age band and guardian state. Numbers only; small cells are masked."""
    return await compute_exposure(db)
