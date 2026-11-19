"""G4 daily REFERENCE ARCHIVE (G4 item 6, 2026-11-17 23:59 EST; the advisor's FINAL edit 2, 2026-11-18 07:25Z).

Open-Meteo documents no retention for previous runs, so the TEST-ONLY references are saved as the window runs:
C = sea_level_height_msl (latest run, lead 0-24 h) and D = previous_day1 / previous_day2 (leads 24-48 / 48-72 h) at
the 26 gauge positions, plus, once, the 365 days of previous_day1 before the START that D's datum is computed from.

- References only, NEVER observed water: it cannot break the G4 embargo.
- Each run asks for the last 3 UTC days and keeps the FIRST value seen for an hour, so a missed run loses nothing and
  a later answer never rewrites an earlier one.
- The archive is CUMULATIVE: the workflow downloads the newest artifact, this script adds to it, and the workflow
  re-uploads it (retention 90 days, the repo maximum; the longest window, 84 + 3 days, fits). The newest artifact
  always holds everything. It is a plain Actions artifact: in a public repo any signed-in user can download it, and
  Open-Meteo values are not sensitive.
- Before the committed START (g4_rules.START is None until G4 FINAL) it does nothing.
Standard library plus g4_rules. Nothing here is served.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g4_rules as R4                                            # noqa: E402

OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
COOPS_META = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{sid}.json"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def get_json(url, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-tide-g4-archive"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:                               # noqa: BLE001 - one station failing must not end the run
            log(f"GET failed ({type(e).__name__}) try {k + 1}: {url[:120]}")
            time.sleep(2 + 3 * k)
    return {}


def om_hourly(lat, lng, first, last, variables):
    """{variable: {iso hour 'YYYY-MM-DDTHH:00': value}} over [first, last] (dates), as G3t asked (lat/lon to 0.1)."""
    url = (f"{OM_MARINE}?latitude={lat}&longitude={lng}&hourly={','.join(variables)}"
           f"&start_date={first:%Y-%m-%d}&end_date={last:%Y-%m-%d}&timezone=GMT")
    h = get_json(url).get("hourly") or {}
    times = h.get("time", [])
    return {v: {t: x for t, x in zip(times, h.get(v, [])) if x is not None} for v in variables}


def empty_archive():
    return {"registration": R4.REGISTRATION, "kind": "reference archive (Open-Meteo C and D; test only)",
            "start": R4.START.isoformat() if R4.START else None, "len_days": R4.LEN_DAYS,
            "positions": {}, "datum_previous_day1": {}, "series": {}, "runs": []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev", default="prev/g4_reference_archive.json")
    ap.add_argument("--out", default="g4_reference_archive.json")
    ap.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    args = ap.parse_args()
    now = datetime.now(timezone.utc)
    phase = R4.archive_phase(now, R4.START, R4.LEN_DAYS)
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as fh:
            fh.write(f"phase={phase}\n")
    log(f"phase {phase}")
    if phase != "archiving":
        return

    prev = Path(args.prev)
    if not prev.exists() and not R4.fresh_archive_allowed(now, R4.START):
        # A failed download must not silently start a new, partial archive that then becomes "the newest".
        raise SystemExit("no previous archive found after the first days of the window; failing so the next run retries")
    arc = json.loads(prev.read_text(encoding="utf-8")) if prev.exists() else empty_archive()
    if arc.get("start") != R4.START.isoformat():
        raise SystemExit("the downloaded archive belongs to a different START; refusing to mix them")
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    for sid in R4.GAUGES:                                # positions: CO-OPS METADATA only (no water value)
        if sid not in arc["positions"]:
            m = (get_json(COOPS_META.format(sid=sid)).get("stations") or [{}])[0]
            if m.get("lat") is not None:
                arc["positions"][sid] = [round(float(m["lat"]), 1), round(float(m["lng"]), 1)]

    d0 = R4.START.replace(hour=0, minute=0, second=0, microsecond=0)
    for sid, (la, lo) in arc["positions"].items():      # D's datum, once per gauge (a reference fetch, not truth)
        if not arc["datum_previous_day1"].get(sid):
            v = R4.ARCHIVE_VARS[1]
            got = om_hourly(la, lo, (d0 - timedelta(days=R4.DATUM_DAYS)).date(), (d0 - timedelta(days=1)).date(), [v])
            arc["datum_previous_day1"][sid] = {"fetched_at": stamp, "hourly": got[v]}

    days = R4.archive_days(now, R4.START)
    new_total = 0
    if days:
        for sid, (la, lo) in arc["positions"].items():
            got = om_hourly(la, lo, days[0].date(), days[-1].date(), list(R4.ARCHIVE_VARS))
            ser = arc["series"].setdefault(sid, {v: {} for v in R4.ARCHIVE_VARS})
            for v in R4.ARCHIVE_VARS:
                new_total += R4.merge_first_seen(ser.setdefault(v, {}), got.get(v, {}), stamp)
            time.sleep(0.3)
    arc["runs"].append({"fetched_at": stamp, "days": [d.strftime("%Y-%m-%d") for d in days], "new_hours": new_total,
                        "gauges": len(arc["positions"])})
    Path(args.out).write_text(json.dumps(arc, separators=(",", ":")), encoding="utf-8")
    log(f"archived: {len(arc['positions'])} gauges, {new_total} new hourly values, {len(arc['runs'])} runs so far")


if __name__ == "__main__":
    main()
