"""admin_ops_bucket_io.py - the bucket half of the admin's ops snapshot. Standard library only, run as `python3 -I -S`.

The ONE step of `admin-ops-snapshot.yml` that holds SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (by name; the
gust_bucket_io.py / emos_bucket_io.py pattern). It READS counts and sizes, never a record's contents beyond the skill
queue's length, then writes exactly one object: `admin/ops-snapshot.json` in the weather bucket (upsert).

  python3 -I -S admin_ops_bucket_io.py --snapshot snap.json [--dry-run]

What it adds under `verification`:
  skill_pending   calibration/skill/pending.json: entries vs the cap (the cap is read from forecast_skill.py by the
                  repo half), fill %, and how many rows target more than 48 h ahead (the ones the cap evicts first).
  gust_verify     calibration/gust_verify/{cycles,obs}: object counts and the newest object's time.
  served_wave     + sampler: object count under the point archive (truth snapshots counted apart) and the newest;
                  + scores: the published score tables in the public frames bucket (none until SERVED_WAVE_VERIFY=1
                  and the LOCKED list is frozen: the scorer reads nothing before that).
Errors print an HTTP status or an exception CLASS only, never the text (it can carry the project host).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

WEATHER_BUCKET = "weather-products"
FRAMES_BUCKET = "weather-frames"
ARCHIVE_ROOT = "verify/point-archive/v1"
SNAPSHOT_KEY = "admin/ops-snapshot.json"
MAX_LISTED = 50000


def _headers(key):
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


def _cfg():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("storage credentials absent")
    return url, key


def _req(method, path, body=None, ctype=None, extra=None, timeout=120):
    url, key = _cfg()
    h = _headers(key)
    if ctype:
        h["Content-Type"] = ctype
    h.update(extra or {})
    r = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:  # noqa: BLE001 - class only, never the text
        print(f"storage call failed: {type(e).__name__}")
        return 0, b""


def list_folder(bucket, prefix):
    """[(name, is_folder, updated_at)] directly under `prefix`."""
    out, offset = [], 0
    while True:
        body = json.dumps({"prefix": prefix.rstrip("/") + "/", "limit": 1000, "offset": offset,
                           "sortBy": {"column": "name", "order": "asc"}}).encode()
        st, data = _req("POST", f"/storage/v1/object/list/{bucket}", body, "application/json")
        if st != 200:
            raise RuntimeError(f"list {prefix}: HTTP {st}")
        items = json.loads(data or b"[]")
        out += [(i.get("name"), i.get("id") is None, i.get("updated_at") or i.get("created_at")) for i in items]
        if len(items) < 1000:
            return out
        offset += 1000


def count_tree(bucket, prefix, skip=()):
    """{objects, newest, truncated} for every object under `prefix` (folders walked), stopping at MAX_LISTED."""
    n, newest, todo, truncated = 0, None, [prefix.rstrip("/")], False
    while todo:
        folder = todo.pop()
        for name, is_folder, at in list_folder(bucket, folder):
            if is_folder:
                if name not in skip:
                    todo.append(f"{folder}/{name}")
                continue
            n += 1
            if at and (newest is None or at > newest):
                newest = at
            if n >= MAX_LISTED:
                return {"objects": n, "newest": newest, "truncated": True}
    return {"objects": n, "newest": newest, "truncated": truncated}


def _safe(fn, *a, **k):
    try:
        return fn(*a, **k)
    except Exception as e:  # noqa: BLE001 - class only
        return {"error": f"{type(e).__name__}" + (f": {e}" if isinstance(e, RuntimeError) else "")}


def pending_rows(doc):
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict):
        for k in ("pending", "entries", "rows"):
            if isinstance(doc.get(k), list):
                return doc[k]
    return None


def pending_stats(doc, cap, now=None):
    rows = pending_rows(doc)
    if rows is None:
        return {"error": "unrecognised pending.json shape"}
    now = now or datetime.now(timezone.utc)
    far = (now + timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M")
    beyond = sum(1 for r in rows if isinstance(r, dict) and str(r.get("target_time", ""))[:16] > far)
    out = {"entries": len(rows), "cap": cap, "beyond_48h": beyond}
    if cap:
        out["fill_pct"] = round(100.0 * len(rows) / cap, 1)
        out["headroom"] = cap - len(rows)
    return out


def skill_pending(cap):
    st, data = _req("GET", f"/storage/v1/object/{WEATHER_BUCKET}/calibration/skill/pending.json", timeout=300)
    if st in (400, 404):
        return {"entries": 0, "cap": cap, "note": "no pending.json"}
    if st != 200:
        return {"error": f"HTTP {st}"}
    return pending_stats(json.loads(data or b"[]"), cap)


def collect(snap):
    v = snap.setdefault("verification", {})
    cap = (v.get("skill_pending") or {}).get("cap")
    v["skill_pending"] = _safe(skill_pending, cap)
    v["gust_verify"] = {sub: _safe(count_tree, WEATHER_BUCKET, f"calibration/gust_verify/{sub}")
                        for sub in ("cycles", "obs")}
    sw = v.setdefault("served_wave", {})
    archive = os.environ.get("POINT_ARCHIVE_BUCKET") or "point-archive"
    sw["sampler"] = _safe(count_tree, archive, ARCHIVE_ROOT, skip=("truth",))
    sw["truth_snapshots"] = _safe(count_tree, archive, ARCHIVE_ROOT + "/truth")
    sw["scores"] = _safe(count_tree, FRAMES_BUCKET, "verify/served-wave/v1/scores")
    snap["bucket_read_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return snap


def upload(snap):
    body = json.dumps(snap, sort_keys=True).encode()
    st, _ = _req("POST", f"/storage/v1/object/{WEATHER_BUCKET}/{SNAPSHOT_KEY}", body, "application/json",
                 {"x-upsert": "true", "Cache-Control": "no-cache"})
    if st not in (200, 201):
        raise SystemExit(f"upload failed: HTTP {st}")
    print(f"[ops-snapshot] uploaded {len(body)} bytes to {SNAPSHOT_KEY}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    with open(a.snapshot, encoding="utf-8") as fh:
        snap = json.load(fh)
    collect(snap)
    with open(a.snapshot, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, indent=1, sort_keys=True)
    sp = snap["verification"]["skill_pending"]
    print(f"[ops-snapshot] skill pending {sp.get('entries')} of {sp.get('cap')}")
    if not a.dry_run:
        upload(snap)
    return 0


if __name__ == "__main__":
    sys.exit(main())
