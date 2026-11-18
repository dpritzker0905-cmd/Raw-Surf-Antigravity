"""Erasure reaches the files too (T1 P3, advisor limit on #1022): a deleted account's go-live / condition photos and
videos are removed from the PUBLIC `conditions` bucket and from the server's local copy.

Before this, `/compliance/delete-my-data` deleted the database rows that POINT at the media (observation_media,
condition_reports) but the files stayed public: anyone holding a link could still see where and when the person
surfed. Storage is not transactional, so this runs AFTER the database commit, best effort, and reports what it did;
a failure is logged loudly and returned to the caller, never hidden.

What is removed: every object under `conditions/<user_id>/` (the upload route's only layout) and the local
directory `<UPLOAD_DIR>/conditions/<user_id>`. A deleted row's URL is CLIENT-SUPPLIED (condition_reports.media_url
comes from the request body), so a URL is only ever used to find a key under the leaver's OWN prefix; a URL naming
anyone else's object is ignored and counted in `foreign_ignored` (advisor hold on #1049: otherwise a user could file
a report naming another person's photo, delete their account, and the server would delete that person's file).
Blocking (HTTP and disk): call off the event loop.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import unquote

logger = logging.getLogger(__name__)

BUCKET = "conditions"
PAGE = 1000
DELETE_BATCH = 100


def conditions_key(url: Optional[str]) -> Optional[str]:
    """The object key of a public `conditions` URL (…/storage/v1/object/public/conditions/<key>), else None."""
    marker = f"/storage/v1/object/public/{BUCKET}/"
    if not url or marker not in url:
        return None
    key = unquote(url.split(marker, 1)[1].split("?", 1)[0])
    return key or None


class _Storage:
    def __init__(self):
        from services.private_media import _storage_auth_headers, _storage_settings
        self.base, key = _storage_settings()
        if not self.base or not key:
            raise RuntimeError("storage is not configured")
        self.headers = _storage_auth_headers(key)

    def list_prefix(self, prefix: str) -> list:
        import requests
        out, offset = [], 0
        while True:
            r = requests.post(f"{self.base}/storage/v1/object/list/{BUCKET}", headers=self.headers, timeout=20,
                              json={"prefix": prefix, "limit": PAGE, "offset": offset})
            r.raise_for_status()
            page = r.json() if isinstance(r.json(), list) else []
            out += [f"{prefix}{o['name']}" for o in page if o.get("id") is not None]
            if len(page) < PAGE:
                return out
            offset += PAGE

    def delete(self, keys: list) -> None:
        import requests
        for i in range(0, len(keys), DELETE_BATCH):
            r = requests.delete(f"{self.base}/storage/v1/object/{BUCKET}", headers=self.headers, timeout=30,
                                json={"prefixes": keys[i:i + DELETE_BATCH]})
            if r.status_code not in (200, 204):
                raise RuntimeError(f"storage refused the delete (status {r.status_code})")


def own_key(user_id: str, key: Optional[str]) -> bool:
    """True when `key` is an object under `<user_id>/` with no path tricks (no empty, `.` or `..` segments)."""
    if not key or not user_id:
        return False
    parts = key.split("/")
    return parts[0] == user_id and len(parts) > 1 and all(p not in ("", ".", "..") for p in parts[1:])


def delete_account_media(user_id: str, urls: Iterable[Optional[str]], upload_dir: Optional[Path] = None,
                         store=None) -> dict:
    """Remove the account's `conditions` media. Returns {deleted, foreign_ignored, local_removed, error}; never raises."""
    result = {"deleted": 0, "foreign_ignored": 0, "local_removed": False, "error": None}
    url_keys = {k for k in (conditions_key(u) for u in urls) if k}
    foreign = {k for k in url_keys if not own_key(user_id, k)}
    if foreign:
        result["foreign_ignored"] = len(foreign)
        logger.warning("[erasure] %d media URL(s) on the deleted account's rows point outside its own folder; "
                       "left in place", len(foreign))
    if upload_dir is not None:
        local = Path(upload_dir) / BUCKET / user_id
        if local.is_dir():
            shutil.rmtree(local, ignore_errors=True)
            result["local_removed"] = not local.exists()
    try:
        store = store or _Storage()
        keys = {k for k in store.list_prefix(f"{user_id}/") if own_key(user_id, k)}
        keys |= url_keys - foreign
        if keys:
            store.delete(sorted(keys))
        result["deleted"] = len(keys)
    except Exception as exc:  # noqa: BLE001 - reported, not hidden: the caller returns it and the log says so
        result["error"] = type(exc).__name__
        logger.error("[erasure] media for a deleted account NOT removed from public storage: %s", type(exc).__name__)
    return result
