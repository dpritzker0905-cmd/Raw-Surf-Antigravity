"""currents_skill_archive.py - copy workflow artifacts and their sha256 to the weather bucket, for the currents-skill-v1 evidence.

Actions artifacts expire after 90 days and TEST runs 60 days plus the weekly snapshots and pass 2, so every collected file and
snapshot is copied to the `weather-products` bucket under `calibration/currents-skill/<run id>-<attempt>/` with a SHA256SUMS file, and the
hashes are written to the job log (a hash is not a secret). Credentials by NAME (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
CI only, in the `supabase-service` environment. Never overwrites: an existing object stops the job.

  python scripts/currents_skill_archive.py --src DIR --prefix calibration/currents-skill/<run id>-<attempt>
"""
import argparse
import hashlib
import mimetypes
import os
import re
import sys
from typing import Callable, Dict, List, Optional  # noqa: F401

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


def _supabase_headers(key):
    """Supabase API-key headers. sb_ keys are not JWTs and are rejected as Bearer, so the Bearer copy is
    sent only for a legacy JWT key (inline copy of core.supabase_auth: this script runs by path)."""
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


def upload_http(base: str, key: str, bucket: str = BUCKET) -> Callable[[str, bytes, str], None]:
    import requests

    def put(obj_key: str, data: bytes, ctype: str) -> None:
        r = requests.post(f"{base}/storage/v1/object/{bucket}/{obj_key}", data=data, timeout=300,
                          headers={**_supabase_headers(key), "Content-Type": ctype, "x-upsert": "false"})
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


def list_http(base: str, key: str, bucket: str = BUCKET) -> Callable[[str], List[str]]:
    """list(prefix) -> every object key under prefix (recursive; Storage lists one folder level per call)."""
    import requests

    def ls(prefix: str) -> List[str]:
        out, todo = [], [prefix.rstrip("/")]
        while todo:
            folder, offset = todo.pop(), 0
            while True:
                r = requests.post(f"{base}/storage/v1/object/list/{bucket}", timeout=120,
                                  headers=_supabase_headers(key),
                                  json={"prefix": folder + "/", "limit": 1000, "offset": offset})
                if r.status_code != 200:
                    raise RuntimeError(f"list {folder}: HTTP {r.status_code}")
                items = r.json()
                for it in items:
                    (out if it.get("id") else todo).append(f"{folder}/{it['name']}")
                if len(items) < 1000:
                    break
                offset += 1000
        return sorted(out)
    return ls


def get_http(base: str, key: str, bucket: str = BUCKET) -> Callable[[str], bytes]:
    import requests

    def get(obj_key: str) -> bytes:
        r = requests.get(f"{base}/storage/v1/object/{bucket}/{obj_key}", timeout=600,
                         headers=_supabase_headers(key))
        if r.status_code != 200:
            raise RuntimeError(f"download {obj_key}: HTTP {r.status_code}")
        return r.content
    return get


def download(prefix: str, dest: str, ls: Callable[[str], List[str]], get: Callable[[str], bytes]) -> Dict[str, List[str]]:
    """Every archive under `prefix` (one folder per run) to dest/<run>/..., then verify() each: {run: problems}. A run whose
    archive lacks SHA256SUMS is INCOMPLETE and must not be read as evidence (the scorer's leak/freeze control VOIDs it)."""
    if not prefix.startswith(PREFIX_ROOT) or ".." in prefix or not KEY_OK.match(prefix):
        raise ValueError(f"prefix must live under {PREFIX_ROOT!r}: {prefix!r}")
    runs = {}
    for k in ls(prefix):
        rel = k[len(prefix.rstrip("/")) + 1:]
        if not KEY_OK.match(rel) or ".." in rel:
            raise ValueError(f"unsafe object key {k!r}")
        p = os.path.join(dest, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(get(k))
        runs.setdefault(rel.split("/")[0], None)
    return {run: verify(os.path.join(dest, run)) for run in sorted(runs)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--download-to", default="", help="download and verify every archive under --prefix instead")
    a = ap.parse_args(argv)
    base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    if a.download_to:
        problems = download(a.prefix, a.download_to, list_http(base, key), get_http(base, key))
        for run, bad in problems.items():
            print(f"{run}: {'OK' if not bad else '; '.join(bad[:5])}")
        return 0
    archive(a.src, a.prefix, upload_http(base, key))
    return 0


if __name__ == "__main__":
    sys.exit(main())
