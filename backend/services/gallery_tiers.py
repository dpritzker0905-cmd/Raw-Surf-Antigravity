"""Delivery tiers shared by checkout, downloads, transfers and migration."""
from services.private_media import parse_private_media_ref


PHOTO_FIELDS = {"web": "url_web", "standard": "url_standard", "high": "original_url"}
VIDEO_FIELDS = {"720p": "url_720p", "1080p": "url_1080p", "4k": "original_url"}


def tier_fields(media_type):
    return VIDEO_FIELDS if media_type == "video" else PHOTO_FIELDS


def highest_tier(media_type, tiers):
    return next((tier for tier in reversed(tier_fields(media_type)) if tier in tiers), None)


def tier_reference(item, tier):
    field = tier_fields(item.media_type).get(tier)
    if field is None:
        return None
    value = getattr(item, field)
    if field != "original_url":
        variant = parse_private_media_ref(value)
        if not variant or variant == parse_private_media_ref(item.original_url):
            return None
    return value
