"""wind_lr2_archive.py - copy workflow artifacts and their sha256 to the weather bucket, for the long-range wind v2 evidence.

Actions artifacts expire after 90 days and TEST scoring is February 2027 or later, so every collected file, snapshot and
report is copied to the `weather-products` bucket under `calibration/wind-lr2/<run id>/` with a SHA256SUMS file, and the
hashes are written to the job log (a hash is not a secret). Credentials by NAME (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
CI only, in the `supabase-service` environment. Never overwrites: an existing object stops the job.

  python scripts/wind_lr2_archive.py --src DIR --prefix calibration/wind-lr2/<run id>
"""
import argparse
import hashlib
import mimetypes
import os
import re
import sys
from typing import Callable, Dict, List, Optional

BUCKET = "weather-products"
PREFIX_ROOT = "calibration/"
KEY_OK = re.compile(r"^[A-Za-z0-9._/-]+$")          # object keys: nothing else is ever uploaded
SUMS = "SHA256SUMS"


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def plan(src: str, prefix: str) -> List[dict]:
    """Every file under src: {path, key, sha256, size}. Keys keep the relative path under `prefix`."""
    if not prefix.startswith(PREFIX_ROOT) or ".." in prefix or not KEY_OK.match(prefix):
        raise ValueError(f"prefix must live under {PREFIX_ROOT!r}: {prefix!r}")
    out = []
    for root, _dirs, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(root, f)
            rel = os.path.relpath(p, src).replace(os.sep, "/")
            key = f"{prefix.rstrip('/')}/{rel}"
            if not KEY_OK.match(key):
                raise ValueError(f"object key has characters outside [A-Za-z0-9._/-]: {key!r}")
            out.append({"path": p, "key": key, "sha256": sha256_of(p), "size": os.path.getsize(p)})
    return sorted(out, key=lambda r: r["key"])


def sums_text(items: List[dict], prefix: str) -> str:
    return "".join(f"{r['sha256']}  {r['key'][len(prefix.rstrip('/')) + 1:]}\n" for r in items)


def upload_http(base: str, key: str, bucket: str = BUCKET) -> Callable[[str, bytes, str], None]:
    import requests

    def put(obj_key: str, data: bytes, ctype: str) -> None:
        r = requests.post(f"{base}/storage/v1/object/{bucket}/{obj_key}", data=data, timeout=300,
                          headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": ctype, "x-upsert": "false"})
        if r.status_code not in (200, 201):
            raise RuntimeError(f"upload {obj_key}: HTTP {r.status_code}")      # the body may echo request details: not printed
    return put


def archive(src: str, prefix: str, put: Callable[[str, bytes, str], None], log: Callable[[str], None] = print) -> List[dict]:
    items = plan(src, prefix)
    for r in items:
        ctype = mimetypes.guess_type(r["path"])[0] or "application/octet-stream"
        put(r["key"], open(r["path"], "rb").read(), ctype)
        log(f"{r['sha256']}  {r['key']}  ({r['size']} bytes)")
    text = sums_text(items, prefix)
    put(f"{prefix.rstrip('/')}/{SUMS}", text.encode(), "text/plain")        # written LAST: no SUMS file = INCOMPLETE archive
    log(f"archived {len(items)} files; SHA256SUMS sha256 {hashlib.sha256(text.encode()).hexdigest()}")
    return items


def verify(directory: str) -> List[str]:
    """Problems with an archive copy downloaded to `directory` (empty = complete). An archive WITHOUT its SHA256SUMS file is
    INCOMPLETE (the job died before finishing) and is never read as evidence; a listed file that is missing or whose sha256
    differs is a problem; a file not listed is a problem."""
    sums_path = os.path.join(directory, SUMS)
    if not os.path.exists(sums_path):
        return ["INCOMPLETE: no SHA256SUMS"]
    listed, bad = {}, []
    for line in open(sums_path, encoding="utf-8").read().splitlines():
        h, _, name = line.partition("  ")
        listed[name] = h
    for name, h in listed.items():
        p = os.path.join(directory, name)
        if not os.path.exists(p):
            bad.append(f"missing {name}")
        elif sha256_of(p) != h:
            bad.append(f"sha256 differs {name}")
    for root, _d, files in os.walk(directory):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), directory).replace(os.sep, "/")
            if rel != SUMS and rel not in listed:
                bad.append(f"unlisted {rel}")
    return bad


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--prefix", required=True)
    a = ap.parse_args(argv)
    base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    archive(a.src, a.prefix, upload_http(base, key))
    return 0


if __name__ == "__main__":
    sys.exit(main())
