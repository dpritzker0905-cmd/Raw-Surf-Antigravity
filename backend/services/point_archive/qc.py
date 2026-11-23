"""The ONE QC module for buoy truth (gate served-wave-verify-v1 sections 0.1 and 7; LESSONS L-S30). PURE.

Adopted from #1156's `nearshore_lite/truth.py` rules, moved here so the two purposes cannot diverge:
  * the text sentinel `MM` is the ONLY global missing token;
  * a NUMERIC value is rejected by its own field's physical range (WVHT 0-30 m, DPD / APD 1-40 s, MWD 0-360 deg, and the
    same ranges for the .spec partitions). NDBC's numeric fills (99.00 m / s, 999 deg) all fall outside their own field's
    range, so each field rejects only its own fill: a valid 99 deg MWD is never a hole (the first draft's global
    "99.00, 999, 9999" list would have dropped it);
  * a value equal to each of the previous 6 consecutive reports of that field is a STUCK sensor and is flagged, on the
    CONTINUOUS fields only (WVHT, APD, SwH, WWH): the binned periods (DPD, SwP, WWP) and the binned / compass directions
    (MWD, SwD, WWD) repeat honestly under a steady swell and are never flagged stuck (amendment 1, A1);
  * directions are used only when Hs >= 0.3 m;
  * collocation: the report nearest the valid time within +/- 30 min (`at_hour`); on an exact tie the EARLIER report.

What each outcome becomes on a scored row (served_scorer): `MM` = the field is absent (`no_obs`, cause `no_report`); out of
range or stuck = `buoy_qc_fail`. Nothing is silently dropped.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

NDBC_HOST = "www.ndbc.noaa.gov"
MISSING_TOKENS = frozenset({"MM"})
# Per-field physical ranges, inclusive. The ONLY numeric rejection rule (L-S30).
FIELD_RANGES = {
    "WVHT": (0.0, 30.0), "DPD": (1.0, 40.0), "APD": (1.0, 40.0), "MWD": (0.0, 360.0),
    "SwH": (0.0, 30.0), "SwP": (1.0, 40.0), "WWH": (0.0, 30.0), "WWP": (1.0, 40.0),
    "SwD": (0.0, 360.0), "WWD": (0.0, 360.0),
}
STUCK_RUN = 6            # a value equal to each of the previous 6 consecutive reports is stuck
# The stuck rule applies to CONTINUOUS fields only (advisor ruling on #1177, amendment 1 item A1). NDBC reports DPD, SwP and WWP
# as spectral-BIN periods, and MWD, SwD and WWD are binned or 16-point compass directions: a steady swell repeats them for hours,
# and that is a real report, not a stuck sensor. So WVHT, APD, SwH and WWH are flagged; the binned and compass fields never are.
STUCK_EXEMPT = frozenset({"DPD", "SwP", "WWP", "MWD", "SwD", "WWD"})
DIR_MIN_HS_M = 0.3       # directions only when Hs >= 0.3 m
COLLOCATE_MIN = 30       # +/- minutes
# .spec gives SwD / WWD as 16-point compass text; each maps to its point's centre bearing (deg true, FROM).
COMPASS = {p: i * 22.5 for i, p in enumerate(
    ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"))}

# The scorer's variable -> (truth file, column) map (gate section 7).
STDMET_MAP = {"hs_m": "WVHT", "tp_s": "DPD", "tm_s": "APD", "dir_deg": "MWD"}
SPEC_MAP = {"swell_h_m": "SwH", "swell_t_s": "SwP", "swell_dir_deg": "SwD",
            "ww_h_m": "WWH", "ww_t_s": "WWP", "ww_dir_deg": "WWD"}


def realtime_url(station_id, kind="txt"):
    """NDBC realtime2 standard met (`txt`) or spectral summary (`spec`); https on the NDBC host only."""
    if kind not in ("txt", "spec"):
        raise ValueError(kind)
    return f"https://{NDBC_HOST}/data/realtime2/{str(station_id).upper()}.{kind}"


def check_value(field, tok):
    """(value or None, reason or None). reason: 'missing' (MM / absent), 'range' (outside the field's range)."""
    if tok is None or tok in MISSING_TOKENS:
        return None, "missing"
    lo, hi = FIELD_RANGES[field]
    if field in ("SwD", "WWD") and tok in COMPASS:
        return COMPASS[tok], None
    try:
        x = float(tok)
    except ValueError:
        return None, "range"
    if not math.isfinite(x) or not (lo <= x <= hi):
        return None, "range"
    return x, None


def _rows(text, fields):
    cols, out = None, []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        if line.startswith("#"):
            if cols is None:
                cols = line.lstrip("#").split()
            continue
        if cols is None:
            raise ValueError("NDBC text has no column header line")
        v = dict(zip(cols, line.split()))
        try:
            yr = int(v.get("YY") or v["YYYY"])
            t = datetime(yr if yr > 99 else 2000 + yr, int(v["MM"]), int(v["DD"]), int(v["hh"]), int(v.get("mm", 0)),
                         tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        row = {"time": t, "qc": {}}
        for name, col in fields.items():
            val, why = check_value(col, v.get(col))
            row[name] = val
            if why:
                row["qc"][name] = why
        out.append(row)
    if cols is None:
        raise ValueError("NDBC text has no column header line")
    out.sort(key=lambda r: r["time"])
    return out


def stuck_fields(mapping):
    """The row keys of `mapping` the stuck rule applies to (every field but the binned / compass ones)."""
    return tuple(k for k, col in mapping.items() if col not in STUCK_EXEMPT)


def parse_stdmet(text):
    """Rows {time, hs_m, tp_s, tm_s, dir_deg, qc: {field: 'missing'|'range'|'stuck'}} sorted by time (realtime2 is newest
    first). Only hs_m and tm_s can be 'stuck' (STUCK_EXEMPT)."""
    return flag_stuck(_rows(text, STDMET_MAP), stuck_fields(STDMET_MAP))


def parse_spec(text):
    """Rows {time, swell_h_m, swell_t_s, swell_dir_deg, ww_h_m, ww_t_s, ww_dir_deg, qc} from a realtime2 `.spec`. Only the
    two heights can be 'stuck' (STUCK_EXEMPT)."""
    return flag_stuck(_rows(text, SPEC_MAP), stuck_fields(SPEC_MAP))


def flag_stuck(rows, fields, run=STUCK_RUN):
    """Mark qc[field] = 'stuck' where a value equals each of the previous `run` consecutive reports of that field (rows
    sorted by time; a missing report breaks the run). The value stays on the row, so the census can count it. PURE."""
    for f in fields:
        streak, prev = 0, None
        for r in rows:
            v = r.get(f)
            if v is None:
                streak, prev = 0, None
                continue
            if prev is not None and v == prev:
                streak += 1
            else:
                streak = 0
            prev = v
            if streak >= run:
                r["qc"][f] = "stuck"
    return rows


def at_hour(rows, when, tol_min=COLLOCATE_MIN):
    """The report nearest `when` within +/- tol_min minutes, else None. Exact tie -> the earlier report."""
    best, best_d = None, None
    for r in rows:
        d = abs((r["time"] - when).total_seconds()) / 60.0
        if d <= tol_min and (best_d is None or d < best_d or (d == best_d and r["time"] < best["time"])):
            best, best_d = r, d
    return best


def merge_snapshots(texts, parser):
    """Rows from several snapshots of one station, de-duplicated by time (the LATER snapshot wins: NDBC can correct a
    report), then re-flagged for stuck values over the merged series. `texts` = [(fetched_at, text)]."""
    by_time = {}
    for _fetched, text in sorted(texts, key=lambda x: x[0]):
        for r in parser(text):
            r["qc"] = {k: v for k, v in r["qc"].items() if v != "stuck"}
            by_time[r["time"]] = r
    rows = [by_time[t] for t in sorted(by_time)]
    for r in rows:
        r["qc"] = {k: v for k, v in r["qc"].items() if v != "stuck"}
    keys = set(rows[0]) if rows else set()
    mapping = STDMET_MAP if "hs_m" in keys else SPEC_MAP
    return flag_stuck(rows, stuck_fields(mapping))
