"""Move legacy paid gallery objects out of the public ``gallery`` bucket.

The command is dry-run by default.  Run it with ``--apply`` after provisioning
``gallery_originals``.  Set ``GALLERY_UPLOAD_ROOT`` to the deployed local
``uploads/gallery`` directory when rows contain local fallback URLs.  It reads
credentials only from environment variables and never prints their values.

Public previews remain in ``gallery``.  When an old video used its original as
its preview, the migration substitutes its distinct thumbnail; rows without one
are hidden until a protected preview can be regenerated.
"""
from __future__ import annotations

import argparse
import os
import secrets
from collections import defaultdict
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit

import httpx


PUBLIC_BUCKET = "gallery"
PRIVATE_BUCKET = "gallery_originals"
PRIVATE_SCHEME = f"supabase://{PRIVATE_BUCKET}/"
SENSITIVE_FIELDS = ("original_url", "url_web", "url_standard", "url_720p", "url_1080p")
UNAVAILABLE_PREVIEW = "/api/gallery/preview-unavailable"


def _settings() -> tuple[str, str]:
    return (
        os.environ.get("SUPABASE_URL", "").rstrip("/"),
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )


def _headers(key: str) -> dict[str, str]:
    headers = {"apikey": key}
    if key.count(".") == 2:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _public_object_key(value: object, supabase_url: str) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    expected = urlsplit(supabase_url)
    if (parsed.scheme, parsed.netloc) != (expected.scheme, expected.netloc):
        return None
    marker = f"/storage/v1/object/public/{PUBLIC_BUCKET}/"
    if not parsed.path.startswith(marker):
        return None
    key = unquote(parsed.path[len(marker):]).lstrip("/")
    if not key or ".." in PurePosixPath(key).parts:
        return None
    return key


def _local_object_key(value: object) -> str | None:
    prefix = "/api/uploads/gallery/"
    if not isinstance(value, str) or not value.startswith(prefix):
        return None
    key = unquote(value[len(prefix):]).lstrip("/")
    if not key or ".." in PurePosixPath(key).parts:
        return None
    return key


def _extension(key: str) -> str:
    suffix = PurePosixPath(key).suffix.lower()
    return suffix if suffix and len(suffix) <= 10 else ".bin"


def _content_type(key: str) -> str:
    return {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
        ".mov": "video/quicktime", ".webm": "video/webm",
    }.get(_extension(key), "application/octet-stream")


def _rows(client: httpx.Client, base_url: str, headers: dict[str, str]):
    offset = 0
    page_size = 500
    fields = "id,photographer_id,is_for_sale,is_public,preview_url,thumbnail_url," + ",".join(SENSITIVE_FIELDS)
    while True:
        response = client.get(
            f"{base_url}/rest/v1/gallery_items",
            headers={**headers, "Range": f"{offset}-{offset + page_size - 1}"},
            params={"select": fields, "order": "id.asc"},
        )
        response.raise_for_status()
        page = response.json()
        yield from page
        if len(page) < page_size:
            return
        offset += page_size


def _read_source(
    client: httpx.Client,
    *,
    value: str,
    public_key: str | None,
    local_key: str | None,
    local_root: Path | None,
) -> bytes:
    if public_key:
        response = client.get(value)
        response.raise_for_status()
        return response.content
    if local_key and local_root:
        root = local_root.resolve()
        source = (root / local_key).resolve()
        if root not in source.parents:
            raise ValueError("local gallery object escaped the configured root")
        return source.read_bytes()
    raise ValueError("legacy original is not a migratable gallery object")


def _upload_private(
    client: httpx.Client,
    *,
    base_url: str,
    headers: dict[str, str],
    owner_id: str,
    source_key: str,
    content: bytes,
) -> tuple[str, str]:
    destination = f"{owner_id}/migrated/{secrets.token_hex(24)}{_extension(source_key)}"
    response = client.post(
        f"{base_url}/storage/v1/object/{PRIVATE_BUCKET}/{quote(destination, safe='/')}",
        headers={
            **headers,
            "Content-Type": _content_type(source_key),
            "x-upsert": "false",
        },
        content=content,
    )
    response.raise_for_status()
    return f"{PRIVATE_SCHEME}{destination}", destination


def migrate(*, apply: bool) -> dict[str, int]:
    base_url, service_key = _settings()
    if not base_url or not service_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    local_setting = os.environ.get("GALLERY_UPLOAD_ROOT")
    local_root = Path(local_setting) if local_setting else None
    headers = _headers(service_key)
    counts = defaultdict(int)
    migrated: dict[tuple[str, str], str] = {}
    public_keys_to_delete: set[str] = set()
    local_keys_to_delete: set[str] = set()
    public_reference_replacements: dict[str, str] = {}

    with httpx.Client(timeout=120.0) as client:
        rows = list(_rows(client, base_url, headers))
        counts["rows_scanned"] = len(rows)
        sensitive_public_keys = {
            key
            for row in rows
            for field in SENSITIVE_FIELDS
            for key in [_public_object_key(row.get(field), base_url)]
            if key
        }
        sensitive_values = {
            value
            for row in rows
            for field in SENSITIVE_FIELDS
            for value in [row.get(field)]
            if isinstance(value, str) and value
        }
        for row in rows:
            owner_id = str(row["photographer_id"])
            patch: dict[str, object] = {}

            for field in SENSITIVE_FIELDS:
                value = row.get(field)
                if not isinstance(value, str) or not value or value.startswith(PRIVATE_SCHEME):
                    continue
                public_key = _public_object_key(value, base_url)
                local_key = _local_object_key(value)
                source_key = public_key or local_key
                if not source_key:
                    if field == "original_url" and row.get("is_for_sale"):
                        patch["is_for_sale"] = False
                        counts["unsupported_sale_rows"] += 1
                    continue

                cache_key = (owner_id, value)
                private_ref = migrated.get(cache_key)
                if apply and not private_ref:
                    content = _read_source(
                        client,
                        value=value,
                        public_key=public_key,
                        local_key=local_key,
                        local_root=local_root,
                    )
                    private_ref, _ = _upload_private(
                        client,
                        base_url=base_url,
                        headers=headers,
                        owner_id=owner_id,
                        source_key=source_key,
                        content=content,
                    )
                    migrated[cache_key] = private_ref
                elif not apply:
                    private_ref = f"{PRIVATE_SCHEME}{owner_id}/migrated/<opaque>{_extension(source_key)}"

                patch[field] = private_ref
                if public_key:
                    public_keys_to_delete.add(public_key)
                if local_key:
                    local_keys_to_delete.add(local_key)
                counts["asset_references"] += 1

            preview_key = _public_object_key(row.get("preview_url"), base_url)
            if row.get("preview_url") in sensitive_values or preview_key in sensitive_public_keys:
                thumbnail = row.get("thumbnail_url")
                thumbnail_key = _public_object_key(thumbnail, base_url)
                if (
                    isinstance(thumbnail, str)
                    and thumbnail
                    and thumbnail != row.get("preview_url")
                    and thumbnail not in sensitive_values
                    and thumbnail_key not in sensitive_public_keys
                    and not thumbnail.startswith(PRIVATE_SCHEME)
                ):
                    patch["preview_url"] = thumbnail
                else:
                    patch["preview_url"] = UNAVAILABLE_PREVIEW
                    patch["thumbnail_url"] = None
                    patch["is_public"] = False
                    counts["rows_hidden_for_preview"] += 1

            thumbnail_key = _public_object_key(row.get("thumbnail_url"), base_url)
            if (
                row.get("thumbnail_url") in sensitive_values
                or thumbnail_key in sensitive_public_keys
            ):
                patch["thumbnail_url"] = None

            private_original = patch.get("original_url")
            if not private_original and str(row.get("original_url", "")).startswith(PRIVATE_SCHEME):
                private_original = row["original_url"]
            if apply and private_original:
                # Purchased personal-media rows are an entitlement-backed view
                # of the same asset and must retain the private ref. Running this
                # for already-migrated rows makes interrupted runs recoverable.
                response = client.patch(
                    f"{base_url}/rest/v1/user_media",
                    headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                    params={
                        "source_gallery_item_id": f"eq.{row['id']}",
                        "source_type": "eq.photographer_transfer",
                    },
                    json={"media_url": private_original},
                )
                response.raise_for_status()
                response = client.patch(
                    f"{base_url}/rest/v1/surfer_gallery_items",
                    headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                    params={"gallery_item_id": f"eq.{row['id']}"},
                    json={"preserved_original_url": private_original},
                )
                response.raise_for_status()

            if patch:
                counts["rows_changed"] += 1
                if apply:
                    response = client.patch(
                        f"{base_url}/rest/v1/gallery_items",
                        headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                        params={"id": f"eq.{row['id']}"},
                        json=patch,
                    )
                    response.raise_for_status()

            safe_preview = str(patch.get("preview_url") or row.get("preview_url") or "")
            if safe_preview:
                for field in SENSITIVE_FIELDS:
                    old_value = row.get(field)
                    if isinstance(old_value, str) and old_value and not old_value.startswith(PRIVATE_SCHEME):
                        public_reference_replacements[old_value] = safe_preview

        if apply:
            # Preserve public promotional behavior without leaving secondary
            # tables pointing at paid originals that are about to be removed.
            for old_value, safe_preview in public_reference_replacements.items():
                for table, field in (
                    ("condition_reports", "media_url"),
                    ("condition_reports", "thumbnail_url"),
                    ("galleries", "cover_image_url"),
                ):
                    response = client.patch(
                        f"{base_url}/rest/v1/{table}",
                        headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
                        params={field: f"eq.{old_value}"},
                        json={field: safe_preview},
                    )
                    response.raise_for_status()
            for start in range(0, len(public_keys_to_delete), 100):
                batch = sorted(public_keys_to_delete)[start:start + 100]
                response = client.delete(
                    f"{base_url}/storage/v1/object/{PUBLIC_BUCKET}",
                    headers=headers,
                    json={"prefixes": batch},
                )
                response.raise_for_status()
                counts["public_objects_deleted"] += len(batch)
            if local_keys_to_delete and local_root:
                root = local_root.resolve()
                for local_key in sorted(local_keys_to_delete):
                    source = (root / local_key).resolve()
                    if root not in source.parents:
                        raise ValueError("local gallery object escaped the configured root")
                    source.unlink(missing_ok=True)
                    counts["local_objects_deleted"] += 1

    return dict(counts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="copy, rewrite, and delete instead of reporting")
    args = parser.parse_args()
    counts = migrate(apply=args.apply)
    mode = "applied" if args.apply else "dry-run"
    print(mode, " ".join(f"{key}={value}" for key, value in sorted(counts.items())))


if __name__ == "__main__":
    main()
