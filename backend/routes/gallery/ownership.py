"""Who may act on a photographer's gallery, and whose purchases a viewer may claim.

The gallery management routes take the photographer's id from the query or body for client
compatibility. That id is a claim: the acting photographer is the JWT subject, the claim must name
the same person, and the gallery or item must belong to them (2026-10-17 audit, LA-GAL-01).
"""
from typing import Literal, Optional

from fastapi import HTTPException

# The only access types a photographer's assignment or distribution may grant.
AssignAccessType = Literal['pending_selection', 'included', 'gifted']


def require_gallery_photographer(caller_id: str, owner_id: Optional[str], claimed_id: Optional[str]) -> None:
    """403 unless the token's subject owns the resource and the request's claimed id names them."""
    if claimed_id != caller_id or owner_id != caller_id:
        raise HTTPException(status_code=403, detail="Not authorized")


def verified_viewer(viewer_id: Optional[str], token_user_id: Optional[str]) -> Optional[str]:
    """A viewer's purchases unlock original_url only for the viewer who holds the token. A viewer_id
    query parameter on its own is a claim, so it counts as anonymous."""
    return viewer_id if viewer_id and viewer_id == token_user_id else None
