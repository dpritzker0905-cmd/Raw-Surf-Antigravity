"""sst_bucket_io.py - the ONLY code that touches the weather bucket for the G4 SST record (the emos_bucket_io.py pattern).

Standard library only, so the workflow runs it as `python3 -I -S` (no site-packages, no project imports) in short steps that
alone hold SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. The collector (sst_collect.py) runs with NO credential and reads and
writes local files only.

  python3 -I -S sst_bucket_io.py fetch  --dir D    # sst_stations.json (if frozen) and the existing run-key list
  python3 -I -S sst_bucket_io.py upload --dir D    # create-only uploads of what the collector wrote (*.new)

Errors print an HTTP status or an exception CLASS only, never the exception text (it can carry the project host).
Objects live under calibration/sst_g4/ (namespaced calibration state; no manifest or product writes, nothing served).
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
PREFIX = "calibration/sst_g4"


def _cfg():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("storage credentials absent")
    return url, key


def _req(method, path, body=None, ctype=None, extra=None):
    url, key = _cfg()
    h = _supabase_headers(key)
    if ctype:
        h["Content-Type"] = ctype
    h.update(extra or {})
    r = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:  # noqa: BLE001 - class only, never the text
        print(f"storage call failed: {type(e).__name__}")
        return 0, b""


def list_keys(prefix):
    names, offset = [], 0
    while True:
        body = json.dumps({"prefix": prefix, "limit": 1000, "offset": offset}).encode()
        st, data = _req("POST", f"/storage/v1/object/list/{BUCKET}", body, "application/json")
        if st != 200:
            print(f"list {prefix}: HTTP {st}")
            return names
        page = json.loads(data or b"[]")
        names += [p["name"] for p in page if p.get("name")]
        if len(page) < 1000:
            return names
        offset += 1000


def get(key):
    st, data = _req("GET", f"/storage/v1/object/{BUCKET}/{key}")
    return data if st == 200 else None


def put_new(key, blob):
    """Create-only (no upsert): an existing object is never overwritten."""
    st, _ = _req("POST", f"/storage/v1/object/{BUCKET}/{key}", blob, "application/octet-stream", {"x-upsert": "false"})
    return st


def main(argv):
    if len(argv) < 4 or argv[1] not in ("fetch", "upload") or argv[2] != "--dir":
        raise SystemExit(__doc__)
    d = argv[3]
    os.makedirs(os.path.join(d, "runs"), exist_ok=True)
    if argv[1] == "fetch":
        st = get(f"{PREFIX}/stations.json")
        if st:
            open(os.path.join(d, "sst_stations.json"), "wb").write(st)
        keys = list_keys(f"{PREFIX}/runs")
        json.dump(sorted(keys), open(os.path.join(d, "existing_runs.json"), "w"))
        print(f"stations {'present' if st else 'absent'}; {len(keys)} run files stored")
        return 0
    sent = 0
    sp = os.path.join(d, "sst_stations.json.new")
    if os.path.exists(sp):
        print(f"stations upload: HTTP {put_new(f'{PREFIX}/stations.json', open(sp, 'rb').read())}")
    for name in sorted(os.listdir(os.path.join(d, "runs"))):
        if name.endswith(".json.gz.new"):
            st = put_new(f"{PREFIX}/runs/{name[:-4]}", open(os.path.join(d, "runs", name), "rb").read())
            print(f"{name[:-4]}: HTTP {st}")
            sent += st in (200, 201)
    print(f"uploaded {sent} run files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
