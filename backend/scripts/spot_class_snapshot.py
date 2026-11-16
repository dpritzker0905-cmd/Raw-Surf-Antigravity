"""B2 spot classes, step 1: a read-only snapshot of the active surf-spot catalogue (docs/weather-program/log/2026-11-16-claude-surf-spot-classes.md).

STANDARD LIBRARY ONLY, run as `python3 -I -S` in Actions: this is the one process that holds the Supabase credential (read from the
environment by NAME: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). It only GETs; it never writes to the database. The description text is
NOT copied: only the keyword classes it matches are kept, so the snapshot holds what the public map already shows (name, position,
catalogue wave type) plus the resolved geometry the classifier reads.

    python3 -I -S scripts/spot_class_snapshot.py --out data/spot_catalogue_snapshot.json
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

COLS = ("id,name,latitude,longitude,country,region,wave_type,description,is_active,shore_normal_spread_deg,break_depth_m")

# Keyword classes (pre-registered 2026-11-16, before any classification ran; the same patterns drew the validation strata).
KEYWORDS = (
    ("inlet_jetty", r"(jetty|inlet|pier|groyne|groin|breakwater)"),
    ("river_mouth", r"(river ?mouth|rivermouth|estuary)"),
    ("reef", r"(\breef\b|\bledge\b|\bslab\b)"),
    ("point_headland", r"(\bpoint\b|punta|headland|\bcape\b|\bcabo\b)"),
    ("beach", r"(beach|playa|praia|plage)"),
)


def keyword_classes(name, description):
    text = f"{name or ''} {description or ''}".lower()
    return [cls for cls, pat in KEYWORDS if re.search(pat, text)]


def fetch(url, key, page=1000):
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"select": COLS, "order": "id", "offset": offset, "limit": page})
        req = urllib.request.Request(f"{url.rstrip('/')}/rest/v1/surf_spots?{q}",
                                     headers={"apikey": key, "Authorization": "Bearer " + key, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        rows += batch
        offset += len(batch)
        if len(batch) < page:
            return rows


def snapshot(rows):
    out = []
    for r in rows:
        if r.get("is_active") is False or r.get("latitude") is None or r.get("longitude") is None:
            continue
        out.append({
            "id": str(r["id"]), "name": r.get("name") or "", "lat": round(float(r["latitude"]), 5),
            "lng": round(float(r["longitude"]), 5), "country": r.get("country") or "", "region": r.get("region") or "",
            "wave_type": (r.get("wave_type") or "").strip(),
            "kw": keyword_classes(r.get("name"), r.get("description")),
            "spread_deg": r.get("shore_normal_spread_deg"), "break_depth_m": r.get("break_depth_m"),
        })
    out.sort(key=lambda s: s["id"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 2
    try:
        spots = snapshot(fetch(url, key))
    except Exception as e:   # never print the request (it carries the key); the class name is enough
        print(f"snapshot failed: {type(e).__name__}", file=sys.stderr)
        return 1
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"version": 1, "n": len(spots), "spots": spots}, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print(f"snapshot: {len(spots)} active spots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
