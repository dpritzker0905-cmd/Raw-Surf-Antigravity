"""Private Supabase media primitives for access-controlled product lanes.

Database rows keep an opaque, durable ``supabase://bucket/object-key`` reference.
Only an already-authorized API response may resolve that reference to a short-lived
Supabase signed URL.  This keeps delivery credentials out of persisted rows and
prevents a bucket-level public-read setting from becoming the authorization model.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote, unquote, urlsplit

import httpx


logger = logging.getLogger(__name__)

PRIVATE_MEDIA_SCHEME = "supabase://"
PRIVATE_MEDIA_BUCKETS = frozenset({"chat_media", "crew_chat"})
DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60


@dataclass(frozen=True)
class PrivateMediaRef:
    bucket: str
    object_key: str

    @property
    def value(self) -> str:
        return f"{PRIVATE_MEDIA_SCHEME}{self.bucket}/{self.object_key}"


def _storage_settings() -> tuple[str, str]:
    return (
        os.environ.get("SUPABASE_URL", "").rstrip("/"),
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", ""),
    )


def make_private_media_ref(bucket: str, object_key: str) -> str:
    """Create a durable reference for one explicitly private bucket."""
    bucket = bucket.strip()
    object_key = object_key.strip().lstrip("/")
    if bucket not in PRIVATE_MEDIA_BUCKETS:
        raise ValueError(f"{bucket!r} is not an approved private-media bucket")
    if not object_key or ".." in object_key.split("/"):
        raise ValueError("private-media object key is invalid")
    return PrivateMediaRef(bucket=bucket, object_key=object_key).value


def parse_private_media_ref(value: Optional[str]) -> Optional[PrivateMediaRef]:
    """Parse only the durable references owned by this private-media subsystem."""
    if not value or not value.startswith(PRIVATE_MEDIA_SCHEME):
        return None
    parsed = urlsplit(value)
    bucket = parsed.netloc
    object_key = unquote(parsed.path.lstrip("/"))
    if bucket not in PRIVATE_MEDIA_BUCKETS or not object_key or ".." in object_key.split("/"):
        return None
    return PrivateMediaRef(bucket=bucket, object_key=object_key)


def legacy_public_url_to_private_ref(value: Optional[str], bucket: str) -> Optional[str]:
    """Mechanically map a legacy Supabase public object URL to its durable key.

    The actual bucket flip happens only after this conversion is run against the
    database.  Query strings are deliberately discarded because they are delivery
    credentials/cache controls, not part of the object identity.
    """
    if bucket not in PRIVATE_MEDIA_BUCKETS or not value:
        return None
    marker = f"/storage/v1/object/public/{bucket}/"
    if marker not in value:
        return None
    object_key = unquote(value.split(marker, 1)[1].split("?", 1)[0]).lstrip("/")
    try:
        return make_private_media_ref(bucket, object_key)
    except ValueError:
        return None


async def upload_private_media(
    *,
    bucket: str,
    object_key: str,
    content: bytes,
    content_type: str,
) -> Optional[str]:
    """Upload with the service role and return a durable reference, never a public URL."""
    reference = make_private_media_ref(bucket, object_key)
    supabase_url, service_key = _storage_settings()
    if not supabase_url or not service_key:
        logger.warning("Private media storage is unavailable; no persistent media reference was created")
        return None

    encoded_key = quote(object_key, safe="/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{supabase_url}/storage/v1/object/{bucket}/{encoded_key}",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "Content-Type": content_type or "application/octet-stream",
                    "x-upsert": "false",
                },
                content=content,
            )
        if response.status_code in (200, 201):
            return reference
        logger.error("Private media upload failed for bucket=%s status=%s", bucket, response.status_code)
    except httpx.HTTPError:
        logger.exception("Private media upload request failed for bucket=%s", bucket)
    return None


async def signed_private_media_url(
    value: Optional[str], *, expires_in: int = DEFAULT_SIGNED_URL_TTL_SECONDS
) -> Optional[str]:
    """Mint a short-lived delivery URL for an already-authorized response path."""
    reference = parse_private_media_ref(value)
    if not reference:
        return None
    supabase_url, service_key = _storage_settings()
    if not supabase_url or not service_key:
        logger.error("Cannot sign private media: Supabase service credentials are unavailable")
        return None

    expires_in = max(60, min(int(expires_in), 24 * 60 * 60))
    encoded_key = quote(reference.object_key, safe="/")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{supabase_url}/storage/v1/object/sign/{reference.bucket}/{encoded_key}",
                headers={"Authorization": f"Bearer {service_key}"},
                json={"expiresIn": expires_in},
            )
        response.raise_for_status()
        signed_path = response.json().get("signedURL")
        if not signed_path:
            logger.error("Private media signer returned no signed URL for bucket=%s", reference.bucket)
            return None
        if signed_path.startswith("http://") or signed_path.startswith("https://"):
            return signed_path
        if signed_path.startswith("/storage/v1/"):
            return f"{supabase_url}{signed_path}"
        return f"{supabase_url}/storage/v1{signed_path if signed_path.startswith('/') else '/' + signed_path}"
    except (httpx.HTTPError, ValueError):
        logger.exception("Private media signing failed for bucket=%s", reference.bucket)
        return None


async def delivery_url_for_media(value: Optional[str]) -> Optional[str]:
    """Resolve a private reference; leave legacy/local URLs untouched during migration."""
    if parse_private_media_ref(value):
        return await signed_private_media_url(value)
    return value
