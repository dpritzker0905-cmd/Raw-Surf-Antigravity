"""
Gallery package — aggregates all gallery domain sub-routers.

This replaces the 6,600-line gallery.py monolith with focused modules:
  - items.py:              Gallery item CRUD (create, get, update, delete, move, copy, assign)
  - collections.py:        Gallery collection management (create, list, get, update, delete)
  - purchases.py:          (inline in items for now — purchase, download, watermark, claim)
  - distribution.py:       Distribution pipeline (distribute, tag, untag, participants)
  - sales.py:              Sales dashboards, bulk purchase, quality previews
  - grom.py:               Cross-profile grom tagging
  - ai_match.py:           AI lineup match
  - surfer_locker.py:      Surfer locker and public gallery
  - admin.py:              Operational/admin (cleanup, heal, thumbnails, conditions)
  - gallery_find_me.py:    AI "Find Me" surfer identification (v85 split from admin.py)
  - gallery_migrations.py: Batch title migrations, cleanup, date healing (v85 split from admin.py)

The __init__.py exports a single `router` so that `routes/__init__.py` can
continue to do `from .gallery import router as gallery_router` unchanged.
"""

from fastapi import APIRouter

router = APIRouter()

# Import and include all sub-routers
from .items import router as items_router
from .collections import router as collections_router
from .grom import router as grom_router
from .ai_match import router as ai_match_router
from .sales import router as sales_router
from .distribution import router as distribution_router
from .surfer_locker import router as surfer_locker_router
from .admin import router as admin_router
from .gallery_find_me import router as find_me_router
from .gallery_migrations import router as migrations_router
from .gallery_purchases import router as purchases_router
from .gallery_conditions import router as conditions_router
from .collections_roster import router as collections_roster_router
from .distribution_tagging import router as distribution_tagging_router
from .gallery_pricing import router as pricing_router

router.include_router(items_router)
router.include_router(collections_router)
router.include_router(grom_router)
router.include_router(ai_match_router)
router.include_router(sales_router)
router.include_router(distribution_router)
router.include_router(surfer_locker_router)
router.include_router(admin_router)
router.include_router(find_me_router)
router.include_router(migrations_router)
router.include_router(purchases_router)
router.include_router(conditions_router)
router.include_router(collections_roster_router)
router.include_router(distribution_tagging_router)
router.include_router(pricing_router)


