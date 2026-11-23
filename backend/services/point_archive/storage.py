"""The stores the point archive runs on (gate served-wave-verify-v1 section 9).

  LocalStore      a folder (tests and offline runs)
  SupabaseStore   one Supabase Storage bucket over its REST API; CI only. Credentials by NAME (SUPABASE_URL,
                  SUPABASE_SERVICE_ROLE_KEY), held in GitHub Actions; the key authenticates WRITES to the private archive
                  bucket and the scorer's reads of it. Never constructed on the Render box.
  PublicFrames    the anonymous public read of the `weather-frames` bucket, the same path the client uses
                  (staticFrames.js: <SUPABASE_URL>/storage/v1/object/public/weather-frames/). No key is ever sent (L-S32).

Every store answers read(path) -> bytes | None (None ONLY for "no such object"; any other failure raises), write(path, data,
content_type, cache_control, upsert), list(prefix) -> sorted object paths.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

ARCHIVE_BUCKET_DEFAULT = "point-archive"     # NON-public (section 9); override with POINT_ARCHIVE_BUCKET
FRAMES_BUCKET = "weather-frames"            # public; the score tables go under verify/served-wave/v1/scores/
RETRY_STATUS = (429, 500, 502, 503, 504, 520, 521, 522, 523, 524)
BACKOFF_S = (2.0, 5.0, 12.0)
_sleep = time.sleep


class LocalStore:
    def __init__(self, root):
        self.root = Path(root)

    def read(self, path):
        p = self.root / path
        return p.read_bytes() if p.is_file() else None

    def write(self, path, data, content_type="application/octet-stream", cache_control="no-cache", upsert=True):
        dest = self.root / path
        if dest.exists() and not upsert:
            raise FileExistsError(f"{path} exists (immutable)")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    def list(self, prefix):
        base = self.root / prefix
        if not base.exists():
            return []
        return sorted(p.relative_to(self.root).as_posix() for p in base.rglob("*") if p.is_file())


def _is_not_found(status, body):
    if status == 404:
        return True
    return status == 400 and (b"not_found" in body.lower() or b"nosuchkey" in body.lower() or b"not found" in body.lower())


class SupabaseStore:
    def __init__(self, bucket=None, requests_mod=None, env=None):
        env = os.environ if env is None else env
        if requests_mod is None:
            import requests as requests_mod
        from core.supabase_auth import supabase_headers
        self.requests = requests_mod
        self.bucket = bucket or env.get("POINT_ARCHIVE_BUCKET") or ARCHIVE_BUCKET_DEFAULT
        self.base = (env.get("SUPABASE_URL") or "").rstrip("/")
        key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
        if not self.base or not key:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (by name, in GitHub Actions)")
        self.auth = supabase_headers(key)

    def ensure_private_bucket(self):
        """Create the archive bucket NON-public if it does not exist. Refuses to run against the public frames bucket."""
        if self.bucket == FRAMES_BUCKET:
            raise ValueError("the raw archive never lives in the public frames bucket")
        resp = self.requests.post(f"{self.base}/storage/v1/bucket", headers=self.auth, timeout=30,
                                  json={"id": self.bucket, "name": self.bucket, "public": False})
        if resp.status_code not in (200, 201) and "already exists" not in resp.text.lower():
            raise RuntimeError(f"create bucket {self.bucket}: HTTP {resp.status_code}")

    def _call(self, method, url, **kw):
        for attempt, wait in enumerate(BACKOFF_S + (None,)):
            try:
                resp = getattr(self.requests, method)(url, timeout=60, **kw)
            except (self.requests.ConnectionError, self.requests.Timeout) as e:
                if wait is None:
                    raise RuntimeError(f"{method} {url.split('/object/')[-1]}: {type(e).__name__}")
                _sleep(wait)
                continue
            if resp.status_code in RETRY_STATUS and wait is not None:
                _sleep(wait)
                continue
            return resp

    def read(self, path):
        resp = self._call("get", f"{self.base}/storage/v1/object/{self.bucket}/{path}?cb={int(time.time() * 1000)}",
                          headers=self.auth)
        if resp.status_code == 200:
            return resp.content
        if _is_not_found(resp.status_code, resp.content):
            return None
        raise RuntimeError(f"read {self.bucket}/{path}: HTTP {resp.status_code}")

    def write(self, path, data, content_type="application/octet-stream", cache_control="no-cache", upsert=True):
        headers = dict(self.auth, **{"Content-Type": content_type, "cache-control": cache_control,
                                     "x-upsert": "true" if upsert else "false"})
        resp = self._call("post", f"{self.base}/storage/v1/object/{self.bucket}/{path}", headers=headers, data=data)
        if resp.status_code in (200, 201):
            return
        if not upsert and resp.status_code in (400, 409) and b"exist" in resp.content.lower():
            raise FileExistsError(f"{path} exists (immutable)")
        raise RuntimeError(f"write {self.bucket}/{path}: HTTP {resp.status_code}")

    def list(self, prefix):
        out, todo = [], [prefix.rstrip("/")]
        while todo:
            folder, offset = todo.pop(), 0
            while True:
                resp = self._call("post", f"{self.base}/storage/v1/object/list/{self.bucket}", headers=self.auth,
                                  json={"prefix": folder + "/", "limit": 1000, "offset": offset})
                if resp.status_code != 200:
                    raise RuntimeError(f"list {self.bucket}/{folder}: HTTP {resp.status_code}")
                rows = resp.json() or []
                for row in rows:
                    (out if row.get("id") else todo).append(f"{folder}/{row['name']}")
                if len(rows) < 1000:
                    break
                offset += 1000
        return sorted(out)


class PublicFrames:
    """Anonymous read of the public frames bucket (what the client reads). get(path) -> bytes | None (404)."""

    def __init__(self, base_url=None, requests_mod=None, env=None):
        env = os.environ if env is None else env
        if requests_mod is None:
            import requests as requests_mod
        self.requests = requests_mod
        base = (base_url or env.get("SUPABASE_URL") or "").rstrip("/")
        if not base:
            raise SystemExit("SUPABASE_URL must be set (the project URL; public, but read by name)")
        self.root = f"{base}/storage/v1/object/public/{FRAMES_BUCKET}/"

    def get(self, path, bust=False):
        url = self.root + path + (f"?cb={int(time.time() * 1000)}" if bust else "")
        for wait in BACKOFF_S + (None,):
            try:
                resp = self.requests.get(url, timeout=60)      # no auth header, ever
            except (self.requests.ConnectionError, self.requests.Timeout):
                if wait is None:
                    raise
                _sleep(wait)
                continue
            if resp.status_code == 200:
                return resp.content
            if _is_not_found(resp.status_code, resp.content):
                return None
            if resp.status_code not in RETRY_STATUS or wait is None:
                raise RuntimeError(f"public read {path}: HTTP {resp.status_code}")
            _sleep(wait)
