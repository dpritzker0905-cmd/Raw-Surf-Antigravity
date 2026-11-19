"""nwps_archive_bucket_io.py - the ONLY code that touches the weather bucket for the NWPS teacher archive.

Standard library only, so the workflow runs it as `python3 -I -S` (no site-packages, no project imports) in short
steps that alone hold SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the #948 / #951 pattern, as emos_bucket_io.py). The
collector (nwps_teacher_archive.py) runs with NO credential and reads and writes local files only.

  python3 -I -S nwps_archive_bucket_io.py fetch  --dir D [--days-back N]   # D/existing.json: the keys already stored
  python3 -I -S nwps_archive_bucket_io.py upload --dir D                   # create-only uploads of D/out/**.new

Errors print an HTTP status or an exception CLASS only, never the exception text (it can carry the project host).
Objects live under calibration/nwps_teacher/v1/ (a namespaced key: no manifest or product is written, and the product
clean-up, which looks only at top-level product names, never reaches it). Nothing here deletes or overwrites.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BUCKET = "weather-products"
PREFIX = "calibration/nwps_teacher/v1"


def _cfg():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("storage credentials absent")
    return url, key


def _req(method, path, body=None, ctype=None, extra=None):
    url, key = _cfg()
    h = {"Authorization": "Bearer " + key, "apikey": key}
    if ctype:
        h["Content-Type"] = ctype
    h.update(extra or {})
    r = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:  # noqa: BLE001 - class only, never the text
        print(f"storage call failed: {type(e).__name__}")
        return 0, b""


def list_names(prefix):
    """Entry names directly under `prefix` (one level), or None when the listing itself failed."""
    names, offset = [], 0
    while True:
        body = json.dumps({"prefix": prefix, "limit": 1000, "offset": offset}).encode()
        st, data = _req("POST", f"/storage/v1/object/list/{BUCKET}", body, "application/json")
        if st != 200:
            print(f"list: HTTP {st}")
            return None
        page = json.loads(data or b"[]")
        names += [p["name"] for p in page if p.get("name")]
        if len(page) < 1000:
            return names
        offset += 1000


def put_new(key, blob):
    """Create-only (no upsert): an existing object is never overwritten."""
    st, _ = _req("POST", f"/storage/v1/object/{BUCKET}/{key}", blob, "application/octet-stream", {"x-upsert": "false"})
    return st


def existing_keys(days, lister=None):
    """Keys stored for `days` (YYYYMMDD), relative to PREFIX, as `day/office/file`. None if ANY listing failed: the
    collector must not run on a partial list (it would re-download what is stored)."""
    lister = lister or list_names
    out = []
    for day in days:
        offices = lister(f"{PREFIX}/{day}")
        if offices is None:
            return None
        for office in offices:
            files = lister(f"{PREFIX}/{day}/{office}")
            if files is None:
                return None
            out += [f"{day}/{office}/{name}" for name in files]
    return sorted(out)


def pending_uploads(root):
    """(local path, key) for every `*.new` under root/out, data files before their index files."""
    found = []
    base = os.path.join(root, "out")
    for folder, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith(".new"):
                rel = os.path.relpath(os.path.join(folder, name), base).replace(os.sep, "/")
                found.append((os.path.join(folder, name), f"{PREFIX}/{rel[:-4]}"))
    return sorted(found, key=lambda t: (t[1].endswith(".index.json"), t[1]))


def main(argv):
    if len(argv) < 4 or argv[1] not in ("fetch", "upload") or argv[2] != "--dir":
        raise SystemExit(__doc__)
    d = argv[3]
    os.makedirs(os.path.join(d, "out"), exist_ok=True)
    if argv[1] == "fetch":
        back = int(argv[argv.index("--days-back") + 1]) if "--days-back" in argv else 3
        now = datetime.now(timezone.utc)
        days = [(now - timedelta(days=i)).strftime("%Y%m%d") for i in range(back + 1)]
        keys = existing_keys(days)
        if keys is None:
            print("listing failed: no existing.json written, so the collector will refuse to run")
            return 1
        with open(os.path.join(d, "existing.json"), "w", encoding="utf-8") as fh:
            json.dump(keys, fh)
        print(f"{len(keys)} objects already stored for the last {back + 1} days")
        return 0
    sent = failed = total = 0
    stored = set()
    for path, key in pending_uploads(d):
        if key.endswith(".index.json") and key[:-len(".index.json")] + ".grib2" not in stored:
            print("index skipped: its data file was not stored this run")   # never an index without its data
            continue
        with open(path, "rb") as fh:
            blob = fh.read()
        st = put_new(key, blob)
        if st in (200, 201):
            sent += 1
            total += len(blob)
            stored.add(key)
        else:
            failed += 1
        print(f"{key[len(PREFIX) + 1:]}: HTTP {st}")
    print(f"uploaded {sent} objects, {total / 1e6:.1f} MB; {failed} not stored")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
