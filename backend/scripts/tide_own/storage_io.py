"""The ONLY step of tide-own-series.yml that holds the Supabase service-role key. Standard library only; the workflow
runs it as `python3 -I -S`. Credentials come from the environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and are
never printed; a failure prints an HTTP status or an exception class only.

  spots OUT          active surf spots' [lat, lng] (coordinates only) -> OUT (JSON list), paged (PostgREST caps 1000)
  get NAME OUT       weather-products/tide_own/NAME -> OUT (a missing object is not an error: OUT is not written)
  put FILE NAME      FILE -> weather-products/tide_own/NAME (upsert; only names under tide_own/ are allowed)
"""
import json
import os
import sys
import urllib.error
import urllib.request


def _supabase_headers(key):
    """Supabase API-key headers. sb_ keys are not JWTs and are rejected as Bearer, so the Bearer copy is
    sent only for a legacy JWT key (inline copy of core.supabase_auth: this script runs by path)."""
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


BUCKET = "weather-products"
PREFIX = "tide_own/"
ALLOWED = {"series.json.gz", "series.prev.json.gz", "m.json"}   # prev: the last good table, kept on every publish


def _cfg():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("storage_io: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return base, key


def _req(url, key, data=None, method="GET", ctype=None):
    h = _supabase_headers(key)
    if ctype:
        h["Content-Type"] = ctype
    if method == "POST":
        h["x-upsert"] = "true"
    return urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h), timeout=120)


def spots(out):
    base, key = _cfg()
    rows, off = [], 0
    while True:
        url = (f"{base}/rest/v1/surf_spots?select=latitude,longitude&is_active=eq.true&latitude=not.is.null"
               f"&longitude=not.is.null&order=id&limit=1000&offset={off}")
        try:
            batch = json.loads(_req(url, key).read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            sys.exit(f"storage_io spots: HTTP {e.code}")
        rows += [[r["latitude"], r["longitude"]] for r in batch]
        if len(batch) < 1000:
            break
        off += 1000
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh)
    print(f"spots: {len(rows)}")


def is_not_found(code, body):
    """True only for a real "object does not exist" (the advisor, 2026-11-20: an auth or request fault must fail the
    step, not silently recompute everything). Observed on this project 2026-11-20, no key, known-absent paths:
      missing object:  HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
      bucket unseen:   HTTP 400 {"statusCode":"404","error":"Bucket not found",...,"code":"NoSuchBucket"}
    The second also says statusCode "404" but means the key cannot see the bucket, so statusCode alone is NOT enough:
    only NoSuchKey / not_found count, and NoSuchBucket fails."""
    if code == 404:
        return True
    if code != 400:
        return False
    try:
        d = json.loads(body.decode("utf-8", "replace") if isinstance(body, bytes) else body)
    except ValueError:
        return False
    if not isinstance(d, dict) or str(d.get("code", "")) == "NoSuchBucket":
        return False
    return str(d.get("code", "")) == "NoSuchKey" or str(d.get("error", "")).lower() == "not_found"


def get(name, out):
    if name not in ALLOWED:
        sys.exit("storage_io: name not allowed")
    base, key = _cfg()
    try:
        body = _req(f"{base}/storage/v1/object/{BUCKET}/{PREFIX}{name}", key).read()
    except urllib.error.HTTPError as e:
        try:
            err = e.read()
        except Exception:                                     # noqa: BLE001 - the body is only used to classify
            err = b""
        if is_not_found(e.code, err):
            print(f"get {name}: HTTP {e.code} not found (absent)")
            return
        sys.exit(f"get {name}: HTTP {e.code} (not a not-found; failing the step)")
    with open(out, "wb") as fh:
        fh.write(body)
    print(f"get {name}: {len(body)} bytes")


def put(path, name):
    if name not in ALLOWED:
        sys.exit("storage_io: name not allowed")
    base, key = _cfg()
    with open(path, "rb") as fh:
        body = fh.read()
    ctype = "application/gzip" if name.endswith(".gz") else "application/json"
    try:
        r = _req(f"{base}/storage/v1/object/{BUCKET}/{PREFIX}{name}", key, data=body, method="POST", ctype=ctype)
        print(f"put {name}: HTTP {r.status}, {len(body)} bytes")
    except urllib.error.HTTPError as e:
        sys.exit(f"storage_io put {name}: HTTP {e.code}")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    {"spots": spots, "get": get, "put": put}[cmd](*rest)
