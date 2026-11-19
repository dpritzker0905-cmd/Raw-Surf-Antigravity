"""gust_bucket_io.py - the ONLY code that touches the weather bucket for the gust verification record.

Standard library only, so the workflow runs it as `python3 -I -S` (no site-packages, no project imports) in short steps that
alone hold SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the emos_bucket_io.py pattern, advisor condition on #951). The collector
and the scorer run with NO credential on local files.

  python3 -I -S gust_bucket_io.py fetch  --dir D [--all]   # stations.json, existing.json (stored keys) [, every stored file]
  python3 -I -S gust_bucket_io.py upload --dir D           # create-only uploads of the collector's *.new files

Errors print an HTTP status or an exception CLASS only, never the exception text (it can carry the project host).
Objects live under calibration/gust_verify/ (namespaced feature state; no manifest or product writes).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BUCKET = "weather-products"
PREFIX = "calibration/gust_verify"
SUBDIRS = ("cycles", "obs")


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
    for sub in SUBDIRS:
        os.makedirs(os.path.join(d, sub), exist_ok=True)
    if argv[1] == "fetch":
        st = get(f"{PREFIX}/stations.json")
        if st:
            open(os.path.join(d, "stations.json"), "wb").write(st)
        keys = []
        for sub in SUBDIRS:
            keys += [f"{sub}/{k}" for k in list_keys(f"{PREFIX}/{sub}") if k.endswith(".json.gz")]
        json.dump(sorted(keys), open(os.path.join(d, "existing.json"), "w"))
        print(f"stations {'present' if st else 'absent'}; {len(keys)} files stored")
        if "--all" in argv:
            got = 0
            for k in keys:
                p = os.path.join(d, k)
                if not os.path.exists(p):
                    b = get(f"{PREFIX}/{k}")
                    if b:
                        open(p, "wb").write(b)
                        got += 1
            print(f"downloaded {got} files")
        return 0
    sent = 0
    sp = os.path.join(d, "stations.json.new")
    if os.path.exists(sp):
        print(f"stations upload: HTTP {put_new(f'{PREFIX}/stations.json', open(sp, 'rb').read())}")
    for sub in SUBDIRS:
        for name in sorted(os.listdir(os.path.join(d, sub))):
            if name.endswith(".json.gz.new"):
                st = put_new(f"{PREFIX}/{sub}/{name[:-4]}", open(os.path.join(d, sub, name), "rb").read())
                print(f"{sub}/{name[:-4]}: HTTP {st}")
                sent += st in (200, 201)
    print(f"uploaded {sent} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
