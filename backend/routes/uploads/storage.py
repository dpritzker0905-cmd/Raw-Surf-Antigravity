"""Public Supabase Storage contract for product-public upload lanes."""
from __future__ import annotations

import logging
from pathlib import Path


# This helper returns public CDN URLs. Keep its contract disjoint from
# services.private_media, which owns signed delivery for sensitive chat media.
PUBLIC_UPLOAD_BUCKETS = frozenset({
    "avatars", "conditions", "feed", "gallery", "general", "stories", "user-gallery",
})


def upload_public_media(
    local_path: Path,
    bucket: str,
    remote_key: str,
    *,
    content_type: str,
    supabase_client: object | None,
    storage_available: bool,
) -> str | None:
    """Upload a product-public asset and return its public CDN URL.

    Bucket provisioning is deliberately outside this request path. A missing or
    private bucket is a deploy/configuration failure, not a reason to silently
    change a bucket's access model at runtime.
    """
    log = logging.getLogger(__name__)
    if bucket not in PUBLIC_UPLOAD_BUCKETS:
        log.error("Rejected non-public bucket from public upload helper: %s", bucket)
        return None
    if not storage_available or supabase_client is None:
        log.warning(
            "Supabase Storage not available (client=%s, available=%s)",
            supabase_client is not None,
            storage_available,
        )
        return None

    try:
        with open(local_path, "rb") as file_handle:
            data = file_handle.read()
        log.info("Uploading %d bytes to Supabase bucket=%s key=%s", len(data), bucket, remote_key)
        result = supabase_client.storage.from_(bucket).upload(
            remote_key,
            data,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        if hasattr(result, "error") and result.error:
            log.warning("Supabase upload returned error: %s", result.error)
            return None
        public_url = supabase_client.storage.from_(bucket).get_public_url(remote_key)
        log.info("Supabase upload success: %s", public_url)
        return public_url
    except Exception:
        log.exception("Supabase upload exception for bucket=%s key=%s", bucket, remote_key)
        return None