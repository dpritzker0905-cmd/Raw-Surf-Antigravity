"""Fetch the published tidal datums of every NOAA CO-OPS station that has them (READ-ONLY; offline; run by hand).

WHY: the US tide display above MLLW (services/weather_pipeline/tide_datum.py) needs MSL - MLLW at each point. CO-OPS
publishes station datums (public-domain U.S. Government data) for about 2,200 stations, including Hawaii, Puerto Rico,
the U.S. Virgin Islands and the Pacific territories. This script reads ONLY:
  - the station list   https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=datums
  - each station's datums  .../stations/{id}/datums.json?units=metric
and writes one compact JSON (`backend/data/tide_datum/coops_datums.json`) with, per station that publishes BOTH MSL
and MLLW: id, name, state, lat, lng, msl_minus_mllw_m, epoch, accepted. Nothing else is called; no water levels.

Politeness: one request at a time with a pause between them (default 0.25 s), a retry on a transient error, and a
resumable cache file so a re-run never re-asks a station it already has.

Usage (from backend/):  python scripts/tide_datum/fetch_coops_datums.py --out data/tide_datum/coops_datums.json
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi"
UA = "raw-surf-tide-datum/1 (offline datum table build)"


def _get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if i == tries - 1:
                raise
            print(f"  retry {url}: {type(e).__name__}", file=sys.stderr)
            time.sleep(2.0 * (i + 1))


def offset_from_datums(doc):
    """PURE: (msl_minus_mllw_m, epoch, accepted) from a CO-OPS datums document, or None when MSL or MLLW is absent."""
    vals = {d.get("name"): d.get("value") for d in (doc or {}).get("datums") or [] if isinstance(d, dict)}
    msl, mllw = vals.get("MSL"), vals.get("MLLW")
    if not isinstance(msl, (int, float)) or not isinstance(mllw, (int, float)):
        return None
    return round(float(msl) - float(mllw), 4), (doc.get("epoch") or "").strip(), (doc.get("accepted") or "").strip()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/tide_datum/coops_datums.json")
    ap.add_argument("--cache", default=None, help="raw per-station cache (default: <out>.cache.json)")
    ap.add_argument("--pause", type=float, default=0.25)
    a = ap.parse_args(argv)
    out = Path(a.out)
    cache_p = Path(a.cache) if a.cache else out.with_suffix(".cache.json")
    cache = json.loads(cache_p.read_text("utf-8")) if cache_p.exists() else {}

    stations = _get(f"{API}/stations.json?type=datums")["stations"]
    print(f"{len(stations)} stations publish datums", file=sys.stderr)
    for n, s in enumerate(stations, 1):
        sid = str(s["id"])
        if sid in cache:
            continue
        try:
            cache[sid] = _get(f"{API}/stations/{sid}/datums.json?units=metric")
        except Exception as e:                       # noqa: BLE001 - record and move on; a gap is not a value
            cache[sid] = {"error": type(e).__name__}
        if n % 100 == 0:
            cache_p.write_text(json.dumps(cache), "utf-8")
            print(f"  {n}/{len(stations)}", file=sys.stderr)
        time.sleep(a.pause)
    cache_p.write_text(json.dumps(cache), "utf-8")

    rows = []
    for s in stations:
        sid = str(s["id"])
        got = offset_from_datums(cache.get(sid))
        if got is None or s.get("greatlakes"):       # Great Lakes stations use LWD, not MLLW
            continue
        d, epoch, accepted = got
        rows.append({"id": sid, "name": s.get("name"), "state": s.get("state") or "", "lat": round(float(s["lat"]), 5),
                     "lng": round(float(s["lng"]), 5), "d": d, "epoch": epoch, "accepted": accepted})
    rows.sort(key=lambda r: r["id"])
    doc = {"schema": "raw-surf/coops-datums/1", "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "NOAA CO-OPS station datums (public domain), " + API,
           "field_d": "MSL - MLLW in metres, on the station's published epoch", "stations": rows}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), "utf-8")
    print(f"wrote {len(rows)} stations with MSL and MLLW to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
