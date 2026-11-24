#!/usr/bin/env python3
"""Probe the served-wave-verify-v1 buoy POOL into a catalogue (gate section 3; run once, by hand, before the freeze).

For each pool id it reads, from NDBC only (public, no key):
  * the station page: name, owner, position, water depth;
  * realtime2 `.txt`: how many of the last 45 days' rows carry WVHT and MWD (the "active, reporting WVHT" test);
  * realtime2 `.spec`: present or not (the swell / wind-wave split the scorer reads).
Nothing about forecast skill is read. The catalogue is committed beside the pool so the freeze is reproducible offline:

  python scripts/served_wave_verify_probe_buoys.py --pool <pool.json> --out <catalogue.json>

Polite by construction: one request at a time with a pause, a plain User-Agent, https on the NDBC host only.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import buoy_holdout  # noqa: E402
from services.point_archive import qc  # noqa: E402

UA = "raw-surf-served-wave-verify/1 (offline buoy probe)"
PAUSE_S = 0.35
_POS = re.compile(r"(\d+(?:\.\d+)?)\s+([NS])\s+(\d+(?:\.\d+)?)\s+([EW])\s+\(")
_DEPTH = re.compile(r"Water depth:</b>\s*([0-9.]+)\s*m", re.I)
_OWNER = re.compile(r"Owned and maintained by\s*(?:<a[^>]*>)?([^<]+)", re.I)
_NAME = re.compile(r"<h1[^>]*>\s*Station\s+\S+\s*(?:&#8209;|-|&ndash;)?\s*([^<]*)", re.I)


def _get(url, opener):
    if not url.startswith(f"https://{qc.NDBC_HOST}/"):
        raise ValueError(url)
    if not buoy_holdout.allow_url(url):          # #1199 LOCKED: a probe after the freeze never reads a locked buoy
        return None
    return opener(url)


def urllib_opener(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def parse_station_page(text):
    """{name, owner, lat, lon, depth_m} from an NDBC station page (None for each part it does not carry). PURE."""
    out = {"name": None, "owner": None, "lat": None, "lon": None, "depth_m": None}
    if not text:
        return out
    m = _POS.search(text)
    if m:
        lat = float(m.group(1)) * (1 if m.group(2) == "N" else -1)
        lon = float(m.group(3)) * (1 if m.group(4) == "E" else -1)
        out.update(lat=lat, lon=lon)
    m = _DEPTH.search(text)
    if m:
        out["depth_m"] = float(m.group(1))
    m = _OWNER.search(text)
    if m:
        out["owner"] = html.unescape(m.group(1)).strip()
    m = _NAME.search(text)
    if m:
        out["name"] = html.unescape(m.group(1)).strip(" -") or None
    return out


def summarise_stdmet(text):
    """Counts the freeze reads from a realtime2 `.txt`: rows, rows with a QC-passing WVHT / MWD, and the last time. PURE."""
    if not text:
        return {"rows": 0, "wvht_rows": 0, "mwd_rows": 0, "last_time": None}
    try:
        rows = qc.parse_stdmet(text)
    except ValueError:
        return {"rows": 0, "wvht_rows": 0, "mwd_rows": 0, "last_time": None}
    last = max((r["time"] for r in rows), default=None)
    return {"rows": len(rows), "wvht_rows": sum(1 for r in rows if r["hs_m"] is not None),
            "mwd_rows": sum(1 for r in rows if r["dir_deg"] is not None),
            "last_time": last.strftime("%Y-%m-%dT%H:%M:%SZ") if last else None}


def probe(station_id, opener, sleep=time.sleep):
    sid = str(station_id).upper()
    page = _get(f"https://{qc.NDBC_HOST}/station_page.php?station={sid.lower()}", opener)
    sleep(PAUSE_S)
    txt = _get(qc.realtime_url(sid, "txt"), opener)
    sleep(PAUSE_S)
    spec = _get(qc.realtime_url(sid, "spec"), opener)
    sleep(PAUSE_S)
    return {"id": sid, **parse_station_page(page), **summarise_stdmet(txt), "spec": bool(spec and spec.strip())}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pool", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    pool = json.loads(Path(a.pool).read_text(encoding="utf-8"))
    ids = sorted({i for group in ("regions", "cdip") for ids in pool[group].values() for i in ids})
    rows = []
    for k, sid in enumerate(ids, 1):
        try:
            rows.append(probe(sid, urllib_opener))
        except Exception as e:  # a probe failure is recorded, never hidden
            rows.append({"id": sid, "error": f"{type(e).__name__}: {e}"})
        print(f"[probe] {k}/{len(ids)} {sid}: {rows[-1].get('wvht_rows', rows[-1].get('error'))}", flush=True)
    out = {"about": "Probe of the served-wave-verify-v1 buoy pool (NDBC station pages + realtime2). Input to the freeze.",
           "pool_version": pool["version"],
           "probed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "stations": rows}
    Path(a.out).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"[probe] wrote {a.out}: {len(rows)} stations")


if __name__ == "__main__":
    main()
