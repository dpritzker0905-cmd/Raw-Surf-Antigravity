"""nwps_teacher_archive.py - keep NOAA's nearshore wave forecasts before NOAA drops them. GitHub Actions only.

WHY (owner, 2026-11-19, typed in the director's session and relayed: "start the NWPS archive, but if we can be more
SOTA than NOAA, we need to use their forecast to help us, not just parrot what they say"). NOAA's Nearshore Wave
Prediction System (NWPS) runs a nearshore wave model per coastal forecast office and publishes it openly, for about
FIVE DAYS. It is the TEACHER for the per-spot nearshore transfer (step 4): we learn from it, we never serve it. A
teacher needs a season of history, and that history exists only if someone keeps it.

WHAT IT DOES. For each office and cycle still on NOAA's server and not yet archived, it downloads the outer-grid GRIB2
file, keeps the messages whose lead time is at or under --keep-hours, and writes them BYTE FOR BYTE with a small index
beside them. It decodes nothing: a GRIB2 message is self-delimiting, and the lead time sits at a fixed place in its
product section, so the split is done on the bytes (no eccodes, no pygrib, no third-party package at all).

WHAT IT IS NOT. It serves no number, calls nothing of the Raw Surf backend, and writes no manifest or product.

NO CREDENTIAL (the #948 / #951 pattern). This process never touches the bucket and has no key in its environment. A
storage-only step (nwps_archive_bucket_io.py, standard library, `python3 -I -S`) first writes the list of keys already
stored; this script writes `<cache>/out/<key>.new`; a second storage-only step uploads those, create-only.

BOUNDED. --max-kept-mb caps what one run adds to the bucket and --max-download-mb caps what it pulls from NOAA. When
a cap is reached the run stops cleanly and says how many cycles it left. The order of offices rotates by date, so the
same offices are not the ones left out every day. Requests are sequential with a pause between them.
Kill: NWPS_TEACHER_ARCHIVE=0 (the script exits at once, having fetched nothing).

  python3 scripts/nwps_teacher_archive.py --cache C [--days-back 3] [--keep-hours 12] [--max-kept-mb 200]
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod"
REGIONS = ("ar", "er", "pr", "sr", "wr")          # Alaska, Eastern, Pacific, Southern, Western (NOAA's own folders)
PREFIX = "calibration/nwps_teacher/v1"            # a namespaced key: the product clean-up never looks here
GRID = "CG1"                                       # the outer grid of each office
FLAG = "NWPS_TEACHER_ARCHIVE"
ATTRIBUTION = ("NOAA / National Weather Service, Nearshore Wave Prediction System (NWPS). "
               "A work of the U.S. Government. Source: " + BASE)
USER_AGENT = "raw-surf-nwps-teacher-archive/1 (research archive, one request at a time)"
_HREF = re.compile(r'href="([^"?#]+)"')
# GRIB2 code table 4.4 (indicator of unit of time range) -> hours. An unlisted unit is kept and counted, never guessed.
_UNIT_HOURS = {0: 1.0 / 60.0, 1: 1.0, 2: 24.0, 10: 3.0, 11: 6.0, 12: 12.0, 13: 1.0 / 3600.0}


def enabled(env=None) -> bool:
    return (os.environ if env is None else env).get(FLAG, "1") != "0"


def parse_index(html: str) -> list:
    """Entry names of an Apache directory listing, in page order. Folders keep their trailing slash. PURE."""
    out = []
    for href in _HREF.findall(html or ""):
        if href.startswith(("/", "?", "http:", "https:")) or href.startswith(".."):
            continue                                   # the parent link, sort links, absolute links
        if href not in out:
            out.append(href)
    return out


def iter_messages(blob: bytes):
    """(start, end) of each COMPLETE GRIB2 message in `blob`. Stops, without raising, at the first thing that is not
    a whole GRIB2 message (a truncated download, trailing junk, another edition). PURE."""
    pos, n = 0, len(blob)
    while pos + 16 <= n:
        if blob[pos:pos + 4] != b"GRIB" or blob[pos + 7] != 2:
            return
        total = int.from_bytes(blob[pos + 8:pos + 16], "big")
        if total < 20 or pos + total > n or blob[pos + total - 4:pos + total] != b"7777":
            return
        yield pos, pos + total
        pos += total


def field_info(msg: bytes):
    """(discipline, category, number, lead_hours) of a message's FIRST field; lead_hours is None when the time unit
    is not in the table or the product section is missing. Read from fixed octets; nothing is decoded. PURE."""
    discipline = msg[6]
    pos, end = 16, len(msg) - 4
    while pos + 5 <= end:
        length = int.from_bytes(msg[pos:pos + 4], "big")
        if length < 5 or pos + length > end:
            break
        if msg[pos + 4] == 4 and length >= 22:        # section 4, the product definition
            category, number = msg[pos + 9], msg[pos + 10]
            unit = msg[pos + 17]
            raw = int.from_bytes(msg[pos + 18:pos + 22], "big")
            hours = _UNIT_HOURS.get(unit)
            return discipline, category, number, (None if hours is None else raw * hours)
        pos += length
    return discipline, None, None, None


def select(blob: bytes, keep_hours: float):
    """(kept bytes, stats). Keeps, in file order and unchanged, every message whose lead is <= keep_hours, and every
    message whose lead could not be read (it is counted, so an unreadable file is visible, not silently empty). PURE."""
    kept, fields, leads = [], {}, []
    stats = {"messages": 0, "kept": 0, "unknown_lead": 0, "parsed_bytes": 0}
    for start, end in iter_messages(blob):
        msg = blob[start:end]
        stats["messages"] += 1
        stats["parsed_bytes"] = end
        discipline, category, number, lead = field_info(msg)
        if lead is None:
            stats["unknown_lead"] += 1
        elif lead > keep_hours:
            continue
        else:
            leads.append(lead)
        kept.append(msg)
        stats["kept"] += 1
        key = "%s.%s.%s" % (discipline, category, number)
        fields[key] = fields.get(key, 0) + 1
    stats["fields_kept"] = fields
    stats["lead_hours_kept"] = [min(leads), max(leads)] if leads else None
    stats["unparsed_tail_bytes"] = len(blob) - stats["parsed_bytes"]
    return b"".join(kept), stats


def object_key(day: str, wfo: str, cycle: str, keep_hours: float) -> str:
    return "%s/%s/%s/t%sz.%s.f000-%03d.grib2" % (PREFIX, day, wfo, cycle, GRID.lower(), int(keep_hours))


def source_url(region: str, day: str, wfo: str, cycle: str) -> str:
    return "%s/%s.%s/%s/%s/%s/nwps.t%sz.%s.%s.grib2" % (BASE, region, day, wfo, cycle, GRID, cycle, GRID.lower(), wfo)


def plan(listing, days, existing, keep_hours, wfos=None, rotate=0) -> list:
    """Jobs still to do: (day, region, wfo, cycle, key, url), offices rotated by `rotate`. `listing(url)` returns the
    entry names of a folder ([] when it is absent). Never plans a key that is already stored. PURE given `listing`."""
    jobs = []
    for day in days:
        for region in REGIONS:
            root = "%s/%s.%s/" % (BASE, region, day)
            for entry in listing(root):
                wfo = entry.rstrip("/")
                if not entry.endswith("/") or (wfos and wfo not in wfos):
                    continue
                for c in listing(root + entry):
                    cycle = c.rstrip("/")
                    if not c.endswith("/") or not (len(cycle) == 2 and cycle.isdigit()):
                        continue
                    key = object_key(day, wfo, cycle, keep_hours)
                    if key in existing or key[len(PREFIX) + 1:] in existing:
                        continue
                    jobs.append((day, region, wfo, cycle, key, source_url(region, day, wfo, cycle)))
    offices = sorted({j[2] for j in jobs})
    if offices and rotate:
        shift = rotate % len(offices)
        rank = {w: i for i, w in enumerate(offices[shift:] + offices[:shift])}
        jobs.sort(key=lambda j: (rank[j[2]], j[0], j[3]))
    return jobs


def run(listing, fetch, cache, days, existing, keep_hours, max_kept, max_download, wfos=None, rotate=0, now=None, log=print):
    """Do the plan within the two caps. `fetch(url)` returns the file's bytes, or None when it is absent or failed.
    Writes `<cache>/out/<key>.new` and its `.index.json.new`. Returns a summary. Never raises for one bad file."""
    now = now or datetime.now(timezone.utc)
    jobs = plan(listing, days, existing, keep_hours, wfos, rotate)
    summary = {"planned": len(jobs), "saved": 0, "kept_bytes": 0, "downloaded_bytes": 0, "skipped_absent": 0,
               "skipped_empty": 0, "left_for_next_run": 0, "stopped": None, "kept_bytes_by_day": {}}
    for i, (day, region, wfo, cycle, key, url) in enumerate(jobs):
        if summary["kept_bytes"] >= max_kept or summary["downloaded_bytes"] >= max_download:
            summary["stopped"] = "kept cap" if summary["kept_bytes"] >= max_kept else "download cap"
            summary["left_for_next_run"] = len(jobs) - i
            break
        blob = fetch(url)
        if blob is None:
            summary["skipped_absent"] += 1               # the cycle folder exists before its file does
            continue
        summary["downloaded_bytes"] += len(blob)
        kept, stats = select(blob, keep_hours)
        if not kept:
            summary["skipped_empty"] += 1
            log("%s %s t%sz: nothing kept of %d bytes (%d messages)" % (day, wfo, cycle, len(blob), stats["messages"]))
            continue
        rel = key[len(PREFIX) + 1:]
        path = os.path.join(cache, "out", *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".new", "wb") as fh:
            fh.write(kept)
        index = {"key": key, "source": url, "region": region, "office": wfo, "day": day, "cycle": cycle, "grid": GRID,
                 "keep_hours": keep_hours, "source_bytes": len(blob), "source_sha256": hashlib.sha256(blob).hexdigest(),
                 "kept_bytes": len(kept), "kept_sha256": hashlib.sha256(kept).hexdigest(),
                 "retrieved_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "attribution": ATTRIBUTION,
                 "unaltered": "each kept GRIB2 message is byte-identical to the source; only whole messages are dropped",
                 **stats}
        with open(path[:-len(".grib2")] + ".index.json.new", "w", encoding="utf-8") as fh:
            json.dump(index, fh, sort_keys=True)
        summary["saved"] += 1
        summary["kept_bytes"] += len(kept)
        summary["kept_bytes_by_day"][day] = summary["kept_bytes_by_day"].get(day, 0) + len(kept)
        log("%s %s t%sz: kept %d of %d messages, %.1f of %.1f MB" % (
            day, wfo, cycle, stats["kept"], stats["messages"], len(kept) / 1e6, len(blob) / 1e6))
    return summary


def _http(url: str, pause: float, limit=None):
    """GET one URL. None for a 404 or any failure (the class is logged, never the text)."""
    time.sleep(pause)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.read() if limit is None else resp.read(limit)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print("GET failed: HTTP %d" % e.code)
        return None
    except Exception as e:  # noqa: BLE001 - class only
        print("GET failed: %s" % type(e).__name__)
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--days-back", type=int, default=3)
    ap.add_argument("--keep-hours", type=float, default=12.0)
    ap.add_argument("--max-kept-mb", type=float, default=200.0)
    ap.add_argument("--max-download-mb", type=float, default=2500.0)
    ap.add_argument("--offices", default="", help="comma-separated office codes; empty = every office listed")
    ap.add_argument("--pause", type=float, default=0.5)
    a = ap.parse_args(argv)
    if not enabled():
        print("%s=0: the archive is switched off; nothing fetched" % FLAG)
        return 0
    try:
        with open(os.path.join(a.cache, "existing.json"), encoding="utf-8") as fh:
            existing = set(json.load(fh))
    except (OSError, ValueError):
        print("no existing.json in the cache: refusing to run (it would re-download what is stored)")
        return 2
    now = datetime.now(timezone.utc)
    days = [(now - timedelta(days=d)).strftime("%Y%m%d") for d in range(a.days_back + 1)]
    wfos = {w.strip().lower() for w in a.offices.split(",") if w.strip()} or None

    def listing(url):
        body = _http(url, a.pause, limit=2_000_000)
        return parse_index(body.decode("utf-8", "replace")) if body else []

    s = run(listing, lambda u: _http(u, a.pause), a.cache, days, existing, a.keep_hours,
            int(a.max_kept_mb * 1e6), int(a.max_download_mb * 1e6), wfos, rotate=now.toordinal(), now=now)
    print("NWPS teacher archive: planned %d, saved %d, kept %.1f MB, downloaded %.1f MB, not yet published %d, "
          "empty %d, left for the next run %d%s" % (
              s["planned"], s["saved"], s["kept_bytes"] / 1e6, s["downloaded_bytes"] / 1e6, s["skipped_absent"],
              s["skipped_empty"], s["left_for_next_run"], (" (stopped: %s)" % s["stopped"]) if s["stopped"] else ""))
    for day in sorted(s["kept_bytes_by_day"]):
        print("  kept for %s: %.1f MB" % (day, s["kept_bytes_by_day"][day] / 1e6))
    with open(os.path.join(a.cache, "collect_report_nwps.json"), "w", encoding="utf-8") as fh:
        json.dump(s, fh, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
