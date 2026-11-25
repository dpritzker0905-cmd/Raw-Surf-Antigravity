"""Resolve URL-based covers, including covers selected from another folder."""
from sqlalchemy import and_, case, or_, select, update

from models import Gallery, GalleryItem


def matching_media(photographer_id, url):
    return select(GalleryItem.id).where(
        GalleryItem.photographer_id == photographer_id,
        or_(GalleryItem.preview_url == url, GalleryItem.thumbnail_url == url,
            GalleryItem.original_url == url, GalleryItem.url_web == url,
            GalleryItem.url_standard == url, GalleryItem.url_720p == url,
            GalleryItem.url_1080p == url),
    ).correlate_except(GalleryItem)


def archived_media_only(photographer_id, url):
    matches = matching_media(photographer_id, url)
    return and_(
        matches.where(GalleryItem.is_deleted.is_(True)).exists(),
        ~matches.where(GalleryItem.is_deleted.is_not(True)).exists(),
    )


async def archived_cover_selection(db, photographer_id, url):
    if not url:
        return False
    matches = matching_media(photographer_id, url)
    source_ids = (await db.scalars(matches)).all()
    if not source_ids:
        return False  # An independent custom cover.
    # If a source disappears while waiting for its lock, it cannot turn into a custom cover.
    locked = (matches.where(GalleryItem.id.in_(source_ids)).with_only_columns(GalleryItem.is_deleted)
              .order_by(GalleryItem.id).with_for_update())
    states = (await db.scalars(locked)).all()
    return all(states)


def display_media_url(photographer_id, url):
    # A custom upload or condition-report cover need not have a gallery item.
    return case(
        (url.is_(None), None),
        (archived_media_only(photographer_id, url), None),
        else_=url,
    )


def display_cover_url():
    return display_media_url(Gallery.photographer_id, Gallery.cover_image_url)


async def clear_covers_before_purge(db, item):
    """Once the last source row is gone, an obsolete URL would look like a custom cover."""
    urls = {item.preview_url, item.thumbnail_url, item.original_url, item.url_web,
            item.url_standard, item.url_720p, item.url_1080p} - {None, ""}
    # Serialize purges of copies sharing a cover. The source folder's count is
    # updated next, so acquire it and all referencing folders in the same order.
    await db.execute(select(Gallery.id).where(
        Gallery.photographer_id == item.photographer_id,
        or_(Gallery.id == item.gallery_id, Gallery.cover_image_url.in_(urls)),
    ).order_by(Gallery.id).with_for_update())
    other_sources = matching_media(Gallery.photographer_id, Gallery.cover_image_url).where(
        GalleryItem.id != item.id,
    )
    await db.execute(update(Gallery).where(
        Gallery.photographer_id == item.photographer_id,
        Gallery.cover_image_url.in_(urls),
        ~other_sources.exists(),
    ).values(cover_image_url=None).execution_options(synchronize_session=False))
