"""Who an upload acts for (LA-UPL-01).

Every upload route used to trust a `user_id` form field, and most had no token at all, so anyone could write
files and rows as any user and run the media processor on the shared box. The routes now take the token's
subject. The legacy `user_id` / `photographer_id` field is still accepted (the web client sends it) but may
only repeat the caller; a different value is refused.
"""
from typing import Optional

from fastapi import Depends, Form, HTTPException

from core.security import get_current_user_id


def bind_uploader(token_user_id: str, claimed_user_id: Optional[str] = None) -> str:
    """Return the id an upload acts for: the token's subject, never a form field."""
    if claimed_user_id and claimed_user_id != token_user_id:
        raise HTTPException(status_code=403, detail="You can only upload as yourself")
    return token_user_id


async def uploader_id(token_user_id: str = Depends(get_current_user_id),
                      user_id: Optional[str] = Form(None)) -> str:
    """Dependency for routes whose legacy form field is `user_id`."""
    return bind_uploader(token_user_id, user_id)


async def photographer_uploader_id(token_user_id: str = Depends(get_current_user_id),
                                   photographer_id: Optional[str] = Form(None)) -> str:
    """Dependency for the one route whose legacy form field is `photographer_id`."""
    return bind_uploader(token_user_id, photographer_id)
