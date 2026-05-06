"""
Posts package — modular decomposition of the posts domain.

Modules:
  - schemas.py:       Pydantic models and constants
  - feed.py:          Create post, feed listing, spot posts, single post, grom preview
  - interactions.py:  Likes, comments CRUD, emoji reactions
  - management.py:    Post settings, edit, delete, report
  - social.py:        Recent locations, OG share page, reactions detail, mention search

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter()

from .feed import router as feed_router
from .interactions import router as interactions_router
from .management import router as management_router
from .social import router as social_router
from .post_collaboration import router as post_collaboration_router

router.include_router(feed_router)
router.include_router(interactions_router)
router.include_router(management_router)
router.include_router(social_router)
router.include_router(post_collaboration_router)
