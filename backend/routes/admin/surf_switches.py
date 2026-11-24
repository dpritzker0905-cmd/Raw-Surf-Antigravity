"""Admin · Surf Forecast · Switches and Verification (Fable inspection 2026-11-23, P0-3 / P1-4 / P1-6). READ-ONLY.

  GET /admin/surf-forecast/switches      every scanned switch and lane setting with its TRUE effective state and its
                                         source (this server's env / the runtime manifest / a repository variable / a
                                         workflow literal), the repository variables, and each guarded flag's
                                         guardrail coverage class (services/admin_switch_board).
  GET /admin/surf-forecast/verification  SCOREBOARD rows, served-wave sampler status, gust-verify record counts,
                                         tide-gate and scorer runs, skill-queue fill, overdue read-backs, and which
                                         guarded flags the guardrail is BLIND to (services/admin_ops_view).

Both require admin (get_current_admin), write nothing and flip nothing. Their only storage read is the ops snapshot
(one small object, cached a minute); the code scan runs once per process in a worker thread.
"""
import asyncio

from fastapi import APIRouter, Depends

from deps.admin_auth import get_current_admin
from models import Profile
from services import admin_ops_view, admin_switch_board

router = APIRouter()


def _switches():
    from routes.admin.surf_forecast import _RATING_FLAGS
    snap = admin_ops_view.read_snapshot()
    doc = snap.get("snapshot") or {}
    repo_vars = doc.get("repo_vars") if isinstance(doc.get("repo_vars"), dict) else None
    if snap.get("status") != "ok":
        repo_vars = None      # a stale snapshot is not the current state: its lanes read "not known here" (design review)
    out = admin_switch_board.board(repo_vars, _RATING_FLAGS, admin_ops_view.coverage_map())
    out["snapshot"] = {"status": snap.get("status"), "error": snap.get("error"), "age_h": snap.get("age_h"),
                       "generated_at": doc.get("generated_at"), "workflow": admin_ops_view.WORKFLOW}
    out["manifest"] = admin_switch_board._rf.status()
    return out


@router.get("/admin/surf-forecast/switches")
async def get_switches(admin: Profile = Depends(get_current_admin)):
    return await asyncio.to_thread(_switches)


@router.get("/admin/surf-forecast/verification")
async def get_verification(admin: Profile = Depends(get_current_admin)):
    return await asyncio.to_thread(admin_ops_view.verification_view)
