"""PR B's served before/after, measured INSIDE the daily build (the owner, 2026-11-20: "we dont need to let people
download anything, they can view info within the app"). No file leaves the job: the table is compared in place with
what users see today (Open-Meteo `sea_level_height_msl`, the current served tide; used here only as the BEFORE side of
an internal test, never served by this script) and ONLY summary numbers are written to the run's step summary.

Per key, over the 72 hours from 00Z today: the mean level offset (ours - before), the shape difference after removing
that offset (RMS), the tidal range ratio, and the timing of highs and lows (each of ours matched to the nearest same-type
extreme of the before series within 3 h). The rating's tide_fit and the depth-cap moves are NOT measured here.
Standard library only, so it runs with `python3 -I -S` beside the build.
"""
import argparse
import base64
import gzip
import json
import math
import struct
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

OM = "https://marine-api.open-meteo.com/v1/marine"
MISSING = -32768
WINDOW_H = 72
MATCH_H = 3


def decode_i16(s):
    """base64 little-endian int16 (the table's compact form) -> [mm or None]."""
    raw = base64.b64decode(s)
    vals = struct.unpack(f"<{len(raw) // 2}h", raw)
    return [None if v == MISSING else v for v in vals]


def series(v):
    """A table series in either form (compact string or list) -> [mm or None]."""
    return decode_i16(v) if isinstance(v, str) else list(v)


def extrema(levels):
    """[(index, 'high'|'low')] at strict local maxima/minima of a series with no gaps around the point."""
    out = []
    for i in range(1, len(levels) - 1):
        a, b, c = levels[i - 1], levels[i], levels[i + 1]
        if a is None or b is None or c is None:
            continue
        if b > a and b >= c:
            out.append((i, "high"))
        elif b < a and b <= c:
            out.append((i, "low"))
    return out


def compare(ours, before):
    """Metrics for one key from two equal-length hourly series in metres (None = missing); None if < 24 paired hours."""
    pairs = [(o, b) for o, b in zip(ours, before) if o is not None and b is not None]
    if len(pairs) < 24:
        return None
    d = [o - b for o, b in pairs]
    off = sum(d) / len(d)
    rms = math.sqrt(sum((x - off) ** 2 for x in d) / len(d))
    ro = max(o for o, _ in pairs) - min(o for o, _ in pairs)
    rb = max(b for _, b in pairs) - min(b for _, b in pairs)
    eb = extrema(before)
    shifts = []
    for i, kind in extrema(ours):
        near = [abs(i - j) for j, k in eb if k == kind and abs(i - j) <= MATCH_H]
        if near:
            shifts.append(min(near))
    return {"offset_m": off, "shape_rms_m": rms, "range_ratio": (ro / rb) if rb > 0 else None,
            "timing_h": (sorted(shifts)[len(shifts) // 2] if shifts else None), "n_extrema": len(shifts)}


def quantile(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def summarize(rows, n_table, n_before):
    """The step-summary markdown: counts and the median / 90th percentile of each metric. No per-key values."""
    lines = ["## Tide served before/after (summary only; no file kept)", "",
             f"- keys in today's table: {n_table}; with a before (current served) series: {n_before}; compared: "
             f"{len(rows)}", "",
             "| metric (ours - current) | median | 90th pct |", "|---|---|---|"]
    for name, key, fmt in (("mean level offset, m", "offset_m", "{:+.3f}"), ("|mean level offset|, m", "abs_off", "{:.3f}"),
                           ("shape RMS after the offset, m", "shape_rms_m", "{:.3f}"),
                           ("tidal range ratio", "range_ratio", "{:.2f}"), ("high/low timing shift, h", "timing_h", "{:.0f}")):
        vals = [abs(r["offset_m"]) for r in rows] if key == "abs_off" else [r[key] for r in rows]
        med, p90 = quantile(vals, 0.5), quantile(vals, 0.9)
        lines.append(f"| {name} | {fmt.format(med) if med is not None else 'n/a'} | "
                     f"{fmt.format(p90) if p90 is not None else 'n/a'} |")
    lines += ["", "Not measured here: the rating's tide_fit and the depth-cap moves."]
    return "\n".join(lines) + "\n"


def fetch_before(keys, start):
    """{key: [m or None] * WINDOW_H} from the current served source, batched (100 locations per request), retried."""
    out = {}
    for i in range(0, len(keys), 100):
        chunk = keys[i:i + 100]
        url = (f"{OM}?latitude={','.join(k.split(',')[0] for k in chunk)}"
               f"&longitude={','.join(k.split(',')[1] for k in chunk)}"
               f"&hourly=sea_level_height_msl&start_date={start:%Y-%m-%d}"
               f"&end_date={(start + timedelta(hours=WINDOW_H - 1)):%Y-%m-%d}&timezone=GMT")
        data = None
        for k in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-tide-served-delta"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = json.loads(r.read().decode("utf-8"))
                break
            except Exception as e:                                       # noqa: BLE001 - a chunk failing is counted
                print(f"before chunk {i // 100}: {type(e).__name__} (try {k + 1})", file=sys.stderr)
                time.sleep(3 + 10 * k)
        if data is None:
            continue
        for key, loc in zip(chunk, data if isinstance(data, list) else [data]):
            h = (loc or {}).get("hourly") or {}
            vals = {t: v for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", []))}
            out[key] = [vals.get(f"{start + timedelta(hours=j):%Y-%m-%dT%H:00}") for j in range(WINDOW_H)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", required=True)
    ap.add_argument("--summary", default=None)
    args = ap.parse_args()
    with gzip.open(args.table, "rt", encoding="utf-8") as fh:
        doc = json.load(fh)
    start = datetime.strptime(doc["start"], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    day0 = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    off = int((day0 - start).total_seconds() // 3600)
    ours = {k: [None if v is None else v / 1000.0 for v in series(s)[off:off + WINDOW_H]] for k, s in doc["keys"].items()}
    before = fetch_before(sorted(ours), day0)
    rows = [r for r in (compare(ours[k], before[k]) for k in ours if k in before) if r]
    md = summarize(rows, len(ours), sum(1 for v in before.values() if any(x is not None for x in v)))
    print(md)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(md)


if __name__ == "__main__":
    main()
