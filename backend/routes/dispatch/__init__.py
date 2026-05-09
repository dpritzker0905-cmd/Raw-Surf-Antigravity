"""
Dispatch package -- on-demand photographer dispatch system.

Replaces the 3,690-line dispatch.py monolith with focused modules:
  - schemas.py:      Pydantic models + shared helpers (get_available_pros, etc.)
  - sessions.py:     Core request lifecycle (create, pay, checkout, payment-success)
  - lifecycle.py:    Session lifecycle (accept, decline, arrived, complete, cancel)
  - exceptions.py:   Cancellation exception requests and resolution
  - status.py:       Status queries (get dispatch, active, pending, crew-status)
  - crew.py:         Crew management (invites, decline, crew pay, checkout)
  - boost.py:        Request boost and photographer on-demand stats/history
  - progress.py:     Crew payment progress (cover remaining, remind crew)

Exports a single `router` so routes/__init__.py can import unchanged.
"""

from fastapi import APIRouter

router = APIRouter()

from .sessions import router as sessions_router
from .lifecycle import router as lifecycle_router
from .dispatch_transitions import router as dispatch_transitions_router
from .exceptions import router as exceptions_router
from .status import router as status_router
from .crew import router as crew_router
from .boost import router as boost_router
from .progress import router as progress_router
from .dispatch_matching import router as dispatch_matching_router

router.include_router(sessions_router)
router.include_router(lifecycle_router)
router.include_router(dispatch_transitions_router)
router.include_router(exceptions_router)
router.include_router(status_router)
router.include_router(crew_router)
router.include_router(boost_router)
router.include_router(progress_router)
router.include_router(dispatch_matching_router)
