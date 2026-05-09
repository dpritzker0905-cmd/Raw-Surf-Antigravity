"""Content package -- stories, notes, note reactions, meta/OG sharing."""
from fastapi import APIRouter

from .stories import router as stories_router
from .notes import router as notes_router
from .note_reactions import router as note_reactions_router
from .meta_sharing import router as meta_sharing_router

router = APIRouter()
router.include_router(stories_router)
router.include_router(notes_router)
router.include_router(note_reactions_router)
router.include_router(meta_sharing_router)
