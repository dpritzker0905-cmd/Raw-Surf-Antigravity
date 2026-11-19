#!/usr/bin/env python3
"""icon_rain_collector.py: save DWD ICON's NATIVE TOT_PREC over the US domain, once a day, for the MRMS radar test of ICON rain
sampling (2026-11-19). Research only: nothing here is served, no Render call, no manifest write.

WHY. The research lead's ruling on ICON rain (keep today's 0.125-degree AREA MEAN until a radar test says otherwise) scores
three arms against NOAA MRMS radar QPE: the area mean, the nearest native cell (A'), and a quantile-mapped area mean. Each arm
is rebuilt from ICON's native cells, but DWD's open-data server keeps only about a day of runs and the publisher stores only the
area-mean frames, so the native field must be collected FORWARD. MRMS is archived publicly (NOAA open data on AWS), so only ICON
is collected. Owner: "Yes, start the ICON rain collection" (David, 2026-11-19 ~00:50Z, typed in the director's session).

WHAT. For each 00Z run it saves, in ONE compressed .npz under a private bucket prefix:
  - `cell`: the native cell indices inside the US domain plus a margin (US_BOX), int32, from the run's own CLAT / CLON;
  - `clat`, `clon`: those cells' centres, float32 degrees;
  - `tp_<fff>`: TOT_PREC (kg m-2 = mm since the run began) at each lead in LEADS, float32. The registered leads f006 / f024 / f048
    / f078 / f120 and the step before each (the hour before, or 3 h before past f078), so every arm de-accumulates exactly as
    the publisher does, on UTC hour ends that MRMS hours match.
RULES (the pre-registration, set before any collection):
  - EVERY day in the window is a case; nothing is picked after the fact. The window is WINDOW_DAYS from the first stored run and
    the collector refuses to store anything past it, whatever the counts.
  - Idempotent: a run already stored is skipped. Each invocation tries today's and yesterday's 00Z (DWD keeps about a day), so
    one missed schedule loses nothing.
  - Size-capped: an object over MAX_BYTES is refused (logged), never uploaded. Bytes are written to the step summary.
  - Private: the products bucket is private; the prefix is not a product name, so the product GC never lists it
    (product_object_gc.is_product_object). Delete the prefix after the scored look.
Credentials by NAME only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
"""
from __future__ import annotations

import bz2
import datetime as dt
import io
import json
import os
import sys

BASE = "https://opendata.dwd.de/weather/nwp/icon/grib"
SINGLE = "icon_global_icosahedral_single-level"
INVAR = "icon_global_icosahedral_time-invariant"
BUCKET = "weather-products"
PREFIX = "research/icon_tot_prec_us"
# the registered leads (G2's five) and the step before each one (hourly to 78 h, 3-hourly after, as ICON publishes)
LEADS = (5, 6, 23, 24, 47, 48, 77, 78, 117, 120)
# the contiguous US plus a margin wider than a 5-cell neighbourhood at 0.125 deg (MRMS CONUS is 20-55N, 130-60W)
US_BOX = (17.0, 57.0, -133.0, -57.0)       # south, north, west, east
WINDOW_DAYS = 30
MAX_BYTES = 20 * 1024 * 1024


def cycle_name(cycle: dt.datetime) -> str:
    return cycle.strftime("%Y%m%d%H")


def object_key(cycle: dt.datetime) -> str:
    return f"{PREFIX}/{cycle_name(cycle)}.npz"


def tot_url(cycle: dt.datetime, lead: int) -> str:
    d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return f"{BASE}/{hh}/tot_prec/{SINGLE}_{d}{hh}_{lead:03d}_TOT_PREC.grib2.bz2"


def invar_url(cycle: dt.datetime, name: str) -> str:
    d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    return f"{BASE}/{hh}/{name.lower()}/{INVAR}_{d}{hh}_{name}.grib2.bz2"


def candidate_cycles(now: dt.datetime) -> list:
    """Today's and yesterday's 00Z runs, oldest first (DWD keeps about a day; a missed day is recovered on the next run)."""
    today = now.astimezone(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return [today - dt.timedelta(days=1), today]


def in_window(cycle: dt.datetime, first: dt.datetime | None, days: int = WINDOW_DAYS) -> bool:
    """Inside the pre-registered window: from the first stored run, `days` runs (00Z daily), and never past it."""
    return first is None or (cycle - first) < dt.timedelta(days=days)


def first_stored(keys) -> dt.datetime | None:
    """The earliest stored run among the prefix's object names (None before the first)."""
    runs = []
    for k in keys:
        base = k.rsplit("/", 1)[-1]
        if base.endswith(".npz") and len(base) == 14 and base[:10].isdigit():
            runs.append(dt.datetime.strptime(base[:10], "%Y%m%d%H").replace(tzinfo=dt.timezone.utc))
    return min(runs) if runs else None


def domain_cells(clat, clon, box=US_BOX):
    """Indices of the native cells whose centres fall in the box (longitudes compared in -180..180)."""
    import numpy as np
    south, north, west, east = box
    lon = ((np.asarray(clon, dtype=float) + 180.0) % 360.0) - 180.0
    lat = np.asarray(clat, dtype=float)
    return np.nonzero((lat >= south) & (lat <= north) & (lon >= west) & (lon <= east))[0].astype(np.int32)


def pack(cells, clat, clon, fields: dict) -> bytes:
    """One compressed .npz: the domain's cells and centres, and TOT_PREC per lead (tp_<fff>)."""
    import numpy as np
    out = io.BytesIO()
    arrays = {"cell": cells, "clat": np.asarray(clat, dtype=np.float32)[cells], "clon": np.asarray(clon, dtype=np.float32)[cells]}
    for lead, values in fields.items():
        arrays[f"tp_{lead:03d}"] = np.asarray(values, dtype=np.float32)[cells]
    np.savez_compressed(out, **arrays)
    return out.getvalue()


def decode_grib(raw: bytes):
    """The one message's values (missing -> NaN), via ECMWF's eccodes."""
    import eccodes
    import numpy as np
    gid = eccodes.codes_new_from_message(raw)
    try:
        values = np.asarray(eccodes.codes_get_array(gid, "values"), dtype=float)
        if eccodes.codes_get(gid, "bitmapPresent"):
            values[values == eccodes.codes_get_double(gid, "missingValue")] = np.nan
    finally:
        eccodes.codes_release(gid)
    return values


class Storage:
    """The products bucket through the Storage REST API (credentials by environment-variable name only)."""

    def __init__(self, http, url: str, key: str):
        self.http, self.base, self.key = http, url.rstrip("/") + "/storage/v1", key

    def _h(self, extra=None):
        h = {"Authorization": f"Bearer {self.key}", "apikey": self.key}
        h.update(extra or {})
        return h

    def list_keys(self) -> list:
        r = self.http.post(f"{self.base}/object/list/{BUCKET}", headers=self._h({"Content-Type": "application/json"}),
                           data=json.dumps({"prefix": PREFIX + "/", "limit": 1000, "offset": 0}), timeout=60)
        r.raise_for_status()
        return [f"{PREFIX}/{o['name']}" for o in r.json() if o.get("name")]

    def upload(self, key: str, body: bytes) -> None:
        r = self.http.post(f"{self.base}/object/{BUCKET}/{key}", data=body, timeout=300,
                           headers=self._h({"Content-Type": "application/octet-stream", "x-upsert": "false"}))
        r.raise_for_status()


def fetch(http, url: str) -> bytes:
    r = http.get(url, timeout=300)
    r.raise_for_status()
    return bz2.decompress(r.content)


def collect(http, storage, now: dt.datetime, log=print) -> list:
    """Store each candidate run not stored yet and inside the window; return one record per candidate."""
    keys = storage.list_keys()
    first = first_stored(keys)
    records = []
    for cycle in candidate_cycles(now):
        key = object_key(cycle)
        rec = {"run": cycle_name(cycle), "key": key}
        if key in keys:
            rec["status"] = "already stored"
        elif not in_window(cycle, first):
            rec["status"] = f"past the {WINDOW_DAYS}-day window (first run {cycle_name(first)}): not stored"
        else:
            try:
                clat, clon = decode_grib(fetch(http, invar_url(cycle, "CLAT"))), decode_grib(fetch(http, invar_url(cycle, "CLON")))
                cells = domain_cells(clat, clon)
                fields = {lead: decode_grib(fetch(http, tot_url(cycle, lead))) for lead in LEADS}
                body = pack(cells, clat, clon, fields)
                rec.update(cells=int(cells.size), bytes=len(body))
                if len(body) > MAX_BYTES:
                    rec["status"] = f"REFUSED: {len(body)} bytes over the {MAX_BYTES}-byte cap"
                else:
                    storage.upload(key, body)
                    rec["status"] = "stored"
                    if first is None:
                        first = cycle
            except Exception as exc:                 # one run's failure (not published yet, gone) never stops the other
                rec["status"] = f"failed: {type(exc).__name__}: {exc}"[:300]
        records.append(rec)
        log(json.dumps(rec))
    return records


def summary(records) -> str:
    lines = ["### ICON rain collection (research; nothing served)", "", "| run | status | cells | bytes |", "|---|---|---|---|"]
    for r in records:
        lines.append(f"| {r['run']} | {r['status']} | {r.get('cells', '')} | {r.get('bytes', '')} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    import requests
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        return 2
    http = requests.Session()
    records = collect(http, Storage(http, url, key), dt.datetime.now(dt.timezone.utc))
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(summary(records))
    failed = [r for r in records if r["status"].startswith(("failed", "REFUSED"))]
    for r in failed:
        print(f"::warning title=ICON rain collection::{r['run']}: {r['status']}")
    return 1 if len(failed) == len(records) else 0     # red only when nothing could be collected or confirmed


if __name__ == "__main__":
    sys.exit(main())
