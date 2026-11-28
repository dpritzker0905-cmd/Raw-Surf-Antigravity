"""Private storage and delivery policy for saleable gallery media.

Gallery rows persist opaque references to originals.  Public preview URLs are
allowed only when they are distinct from the original; every original or paid
quality asset must be resolved after an entitlement check by the calling route.
"""
from __future__ import annotations

from typing import Optional

from services.private_media import parse_private_media_ref, signed_private_media_url


GALLERY_ORIGINALS_BUCKET = "gallery_originals"
GALLERY_DOWNLOAD_TTL_SECONDS = 5 * 60


def is_private_gallery_asset(value: Optional[str], *, owner_id: Optional[str] = None) -> bool:
    """Return whether ``value`` is an approved private gallery object reference."""
    reference = parse_private_media_ref(value)
    if not reference or reference.bucket != GALLERY_ORIGINALS_BUCKET:
        return False
    if owner_id is None:
        return True
    return reference.object_key.startswith(f"{owner_id}/")


def has_safe_gallery_storage(
    *,
    original_url: Optional[str],
    preview_url: Optional[str],
    thumbnail_url: Optional[str],
    owner_id: Optional[str],
) -> bool:
    """Require one private original and public-only preview surfaces."""
    if not is_private_gallery_asset(original_url, owner_id=owner_id):
        return False
    for public_value in (preview_url, thumbnail_url):
        if public_value and (
            public_value == original_url or is_private_gallery_asset(public_value)
        ):
            return False
    return bool(preview_url)


def is_safe_gallery_delivery_reference(
    value: Optional[str],
    *,
    original_url: Optional[str],
    preview_url: Optional[str],
    owner_id: Optional[str],
) -> bool:
    """Accept private paid assets or a genuinely distinct public preview.

    Lower quality tiers currently fall back to the watermarked preview.  That
    compatibility path is safe only when the preview is not also the original.
    Legacy public originals fail closed until the migration has moved them.
    """
    if is_private_gallery_asset(value, owner_id=owner_id):
        return True
    return bool(value and value == preview_url and preview_url != original_url)


async def authorized_gallery_delivery_url(
    value: Optional[str],
    *,
    original_url: Optional[str],
    preview_url: Optional[str],
    owner_id: Optional[str],
) -> Optional[str]:
    """Resolve one already-authorized gallery asset without accepting legacy originals."""
    if not is_safe_gallery_delivery_reference(
        value,
        original_url=original_url,
        preview_url=preview_url,
        owner_id=owner_id,
    ):
        return None
    if is_private_gallery_asset(value, owner_id=owner_id):
        return await signed_private_media_url(value, expires_in=GALLERY_DOWNLOAD_TTL_SECONDS)
    return value
