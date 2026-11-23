"""wind_lr2_stations.py - the ONLY writer of docs/weather-program/evidence/wind-long-range-v2/wind_lr2_stations.json.

The v2 freeze (advisor ruling 2026-11-23T12:45:02Z, reading (b) binds): the list is everything that passes the CATALOGUE rules
of the old registration - NDBC/C-MAN `met=y` buoy/fixed stations within 50 km of GFS land with a known anemometer height; IEM
ASOS stations within 10 km of GFS sea, at most 60, nearest the sea first. There is NO hourly-coverage filter at freeze: this
module calls `wind_lr_obs.select_stations(..., coverage_filter=False)`, which reads no observation file. Coverage is computed per
station at SCORE time (`wind_lr2_truth.coverage_report`), reported, used for the floor counts only, and never drops a row.
Region labels (amendment A3, `wind_lr2_runs.region_of`) are added for the report; the marine-exposed flag and the spot pairing are
the later `pair` step (they need the ETOPO mask and the spot catalogue).

Blinding: the old freeze FILES of runs 44376282465, 43952101715 and 44107750669 are never read or reused: the list is built fresh
from the live catalogues, a pre-existing output or `wind_lr_stations.json` in the cache is refused, not read. Deterministic: no
randomness; NDBC ordered by id, ASOS by (sea_km, id); the file carries the registered date (`asof`) and the UTC date of the
catalogue read (`read_at`) and nothing else that varies. Its sha256 is written beside it and goes into the committing PR.
"""
import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Callable, Optional

import wind_lr2_runs as R

ASOF = "2026-11-22"                      # the registration's catalogue date
OLD_FREEZE_NAMES = ("wind_lr_stations.json",)       # the v1 freeze file name: never present in the v2 cache


def canonical(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, indent=1)


def freeze(cache: str, out: str, asof: str = ASOF, read_at: Optional[str] = None, session=None,
           selector: Optional[Callable] = None) -> dict:
    """Select by rule (no coverage filter), label regions, write `out` and `out.sha256`. Refuses an existing output or an old
    v1 freeze file in the cache (the blinded files are never read)."""
    import wind_lr_obs as O
    if os.path.exists(out):
        raise SystemExit(f"REFUSED: {out} exists; the frozen list is written once and never re-selected")
    for name in OLD_FREEZE_NAMES:
        if os.path.exists(os.path.join(cache, name)):
            raise SystemExit(f"REFUSED: {name} in the cache is an old freeze file (blinded); build fresh")
    os.makedirs(cache, exist_ok=True)
    if session is None:
        import requests
        session = requests.Session()
    sel = selector or O.select_stations
    day = datetime.fromisoformat(asof).replace(tzinfo=timezone.utc)
    tmp = os.path.join(cache, "_wind_lr2_stations_raw.json")
    doc = sel(session, cache, day, day, tmp, coverage_filter=False, frozen_at=asof)
    os.remove(tmp)
    for kind in ("ndbc", "asos"):
        for st in doc[kind]:
            st["region"] = R.region_of(st["lat"], st["lon"])
    doc["asof"] = asof
    doc["read_at"] = read_at or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc.pop("window", None)                                # there is no coverage window at freeze
    doc["counts"] = {"ndbc": len(doc["ndbc"]), "asos": len(doc["asos"]),
                     "by_region": {r: sum(1 for k in ("ndbc", "asos") for s in doc[k] if s["region"] == r)
                                   for r in sorted({s["region"] for k in ("ndbc", "asos") for s in doc[k]})}}
    body = canonical(doc)
    open(out, "w", encoding="utf-8", newline="\n").write(body)
    doc["sha256"] = hashlib.sha256(body.encode()).hexdigest()
    open(out + ".sha256", "w", encoding="utf-8", newline="\n").write(f"{doc['sha256']}  {os.path.basename(out)}\n")
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["freeze"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--asof", default=ASOF)
    a = ap.parse_args(argv)
    doc = freeze(a.cache, a.out, a.asof)
    print(f"frozen {doc['counts']['ndbc']} NDBC + {doc['counts']['asos']} ASOS (no coverage filter); "
          f"by region {doc['counts']['by_region']}; sha256 {doc['sha256']}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
