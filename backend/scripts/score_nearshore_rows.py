"""score_nearshore_rows.py: the S0 gate's FORCING-TRUTH half, scored from the private nearshore rows. Aggregates only.

THE RULE IS NOT MADE HERE. It is docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md (the 02:31Z
amendment, the dated section that names this file's reductions, and the advisor's items A to F after it). This module
computes that rule and nothing else:

  quantity   the chain's height AT THE STATION (friction x shoaling x exposure x refraction; no cap, no H1/10)
  truth      the nearshore buoy's significant height
  switch     a factor is switched off by dividing the row's model height by that row's factor (exact: no cap binds)
  unit       the STATION-DAY: the median over a station-day's rows of log(model / observed)
  score      the median over station-days of the absolute station-day value; lower is better
  compare    score(factor off) - score(served): positive means the factor HELPS
  interval   day-block bootstrap, 2,000 draws, the window's registered seed
  null       the two labels swapped at random within each station-day, 200 shuffles. A SANITY CHECK: for a factor
             that is the same on every row it can only fail when the factor is about 1
  cell       30 station-days over at least 7 days and 3 stations, or it prints its n and no number
  LEVEL      (item B) the chain reads LOW, so dividing by ANY factor below 1 moves toward truth. Each factor-off is
             therefore also compared with its own constant: served divided by that factor's pooled median. Unless
             factor-off beats that constant, the verdict says "level only": the chain is low, not this physics wrong
  stable     (item E) the pooled comparison re-scored with each station left out and each region left out; a verdict
             that loses its side of zero when any ONE station is left out is UNDECIDED
  extremes   (item C) a REMOVE CANDIDATE that is worse by more than 0.02 at the top tenth of truth or at offshore
             3 m and above is DISQUALIFIED
  one look   (item A) verdicts are printed only for a REGISTERED window, whole, after it has closed, from a complete
             read (item D). Anything else is a COUNTS-ONLY health run: no score, no difference, no verdict
  control    every model height in the region with the most station-days x 1.3 must read as 1.25 to 1.35 over. It is
             a constant shift through a median, so it checks the PLUMBING, not the power to detect anything

WHAT IT CANNOT JUDGE (so it never prints a verdict for them): Komar, H1/10, the cap, the magnets, the period arms,
spot classes. They act shoreward of every buoy or need inputs the rows do not carry. See the rule.

PRIVACY. The rows are our served forecasts at named stations and hours. This file prints pooled and per-REGION
aggregates only: never a row, a station id, a station-hour or a per-station number; a cell under 10 units prints no n
either. It holds the Storage service-role key while it fetches, so it is STANDARD LIBRARY ONLY, imports no project
module, and is run as `python3 -I -S` (a test pins the imports). It reads; it never writes to Storage."""
import argparse
import datetime
import json
import math
import os
import random
import sys
import urllib.parse
import urllib.request

BUCKET = "weather-products"
PREFIX = "calibration/nearshore/rows/"
# (first target time, last target time exclusive, seed). The registration's two windows; nothing else is scored.
REGISTERED_WINDOWS = (("2026-11-17T00:00:00", "2026-12-07T00:00:00", 20261207),
                      ("2027-01-11T00:00:00", "2027-02-01T00:00:00", 20270201))
SETTLE_HOURS = 24                    # a scored run waits this long after the window closes: runs made after the
#                                      close still grade its last target times. Fixed before any counts were seen.
DRAWS = 2000
SHUFFLES = 200
MIN_UNITS, MIN_DAYS, MIN_STATIONS = 30, 7, 3
HIDE_BELOW = 10                      # a cell smaller than this prints no count at all
REGION_MARGIN = 0.02                 # the rule's "no region worse by more than 0.02", and the extremes guardrail
CONTROL_FACTOR, CONTROL_BAND = 1.3, (1.25, 1.35)
EXTREME_OFFSHORE_M = 3.0

# configuration -> the factors divided out of the model height. Fixed by the rule; nothing is added after a result.
CONFIGS = (("served", ()), ("friction_off", ("friction",)), ("shoaling_off", ("shoaling",)),
           ("exposure_off", ("exposure",)), ("refraction_off", ("kr",)),
           ("exposure_and_refraction_off", ("exposure", "kr")))
NOT_RUNNABLE = ("period as mean or as the wind-sea partition (the rows carry the peak period only)",
                "komar_off, h110_off, cap_off, magnet_off and their pairs with refraction (not in the scored quantity)",
                "per spot class (a class is not defined at a buoy)")
NOT_BUILT = ("sea-state split by the buoy's own periods (needs the buoy's public record joined by hour)",)
CAVEATS = (
    "The reductions (station-day value, duplicate rows, regions) were fixed at 2026-11-17 03:13Z, after window 1 "
    "opened and before any row was read; one earlier run's medians (observed over model 1.59) had been seen.",
    "Where several runs graded one target time the LATEST run's row is used, which is the shortest lead: this scores "
    "near-analysis forcing, not a forecast.",
    "A region cell rests on as few as 3 stations, which is close to station level.",
    "The null is a sanity check and the positive control a plumbing check; neither measures power.",
    "The model is the GFS member's offshore height through the chain. Inside the Southern California Bight that "
    "height has been a GFS and EURO mean since 2026-11-04 (SURF_BIGHT_HS_CONSENSUS), constant inside both windows.")
# The day-boundary check (registered 2026-11-17, advisor's statistic). A fault is an EXCESS of differing observations
# in the midnight group: more than BOUNDARY_FAULT_SHARE of its pairs AND more than BOUNDARY_FAULT_RATIO x the control's.
BOUNDARY_FAULT_SHARE, BOUNDARY_FAULT_RATIO = 0.01, 2.0
# Runs excluded by a DATED AMENDMENT in the registration log (their `generated_at`, first 19 characters). Empty until
# such an amendment exists. Adding a stamp here without that log entry is a change to the rule after results.
EXCLUDED_RUNS = ()
OBS_TOLERANCE_M = 0.005

# The rule's five coasts as boxes (south, north, west, east), fixed before any row was read. Order matters: the
# first box that contains the station wins. A station in none is "other": reported, never counted toward a minimum.
REGIONS = (("hawaii", 18.0, 23.5, -161.0, -154.0), ("california", 32.0, 42.0, -125.5, -117.0),
           ("gulf", 24.0, 31.0, -98.0, -81.9), ("florida_east", 24.5, 31.0, -81.9, -79.0),
           ("mid_atlantic", 31.0, 42.0, -82.0, -69.0))


def region_of(lat, lng) -> str:
    try:
        la, lo = float(lat), float(lng)
    except (TypeError, ValueError):
        return "other"
    for name, s, n, w, e in REGIONS:
        if s <= la < n and w <= lo < e:
            return name
    return "other"


def station_regions(pairs_docs) -> dict:
    """{station: region} from the pairs files (repository data: station id and coordinates)."""
    out = {}
    for doc in pairs_docs:
        for p in (doc or {}).get("pairs", []):
            out[str(p.get("station"))] = region_of(p.get("station_lat"), p.get("station_lng"))
    return out


def run_mode(start: str, end: str, now: str, fetch_status: str):
    """('scored', seed) only for a registered window, whole, closed, from a complete read; else ('counts', reason)."""
    seed = next((sd for s, e, sd in REGISTERED_WINDOWS if (s, e) == (start[:19], end[:19])), None)
    if seed is None:
        return "counts", "the dates are not a registered window, whole"
    settled = (datetime.datetime.fromisoformat(end[:19]) + datetime.timedelta(hours=SETTLE_HOURS)).isoformat()
    if now[:19] < settled:
        return "counts", "the window has not closed and settled (%d h after its end)" % SETTLE_HOURS
    if fetch_status != "ok":
        return "counts", "the read was not complete (%s)" % fetch_status
    return "scored", seed


def _pos(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v > 0.0 and v == v and v != float("inf") else None


def usable_rows(objects, start: str, end: str):
    """Rows of GRADED runs with a target time in [start, end), one per (station, spot, target time): the row from the
    LATEST run wins (objects are taken in generated_at order). Returns (rows, counts)."""
    kept, counts = {}, {"objects": 0, "graded": 0, "refused": 0, "rows_seen": 0, "rows_unusable": 0}
    for obj in sorted((o for o in objects if isinstance(o, dict)), key=lambda o: str(o.get("generated_at"))):
        counts["objects"] += 1
        if not obj.get("graded"):
            counts["refused"] += 1           # a run that refused to grade: its rows are never mixed in
            continue
        counts["graded"] += 1
        for r in obj.get("rows") or []:
            counts["rows_seen"] += 1
            t = str(r.get("valid_time") or "")
            f = r.get("factors") if isinstance(r.get("factors"), dict) else {}
            ok = (_pos(r.get("model_hs_m")) and _pos(r.get("obs_hs_m")) and r.get("station") is not None
                  and all(_pos(f.get(k)) for k in ("friction", "shoaling", "exposure", "kr")))
            if not ok or len(t) < 10:
                counts["rows_unusable"] += 1
                continue
            if start <= t < end:
                kept[(str(r["station"]), str(r.get("spot")), t)] = r
    return list(kept.values()), counts


def _median(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def _product(r, factors) -> float:
    p = 1.0
    for k in factors:
        p *= float(r["factors"][k])
    return p


def station_days(rows, factors=(), scale=None, divide_by: float = 1.0) -> dict:
    """{(station, day): median over the unit's rows of log(model / observed)} with `factors` divided out of the model.
    `divide_by` is the level-matched comparator's constant; `scale` ({station: multiplier}) the positive control's."""
    buckets = {}
    for r in rows:
        m = float(r["model_hs_m"]) / _product(r, factors) / divide_by
        if scale:
            m *= scale.get(str(r["station"]), 1.0)
        buckets.setdefault((str(r["station"]), str(r["valid_time"])[:10]), []).append(math.log(m / float(r["obs_hs_m"])))
    return {k: _median(v) for k, v in buckets.items()}


def cell_ok(units) -> bool:
    return (len(units) >= MIN_UNITS and len({d for _s, d in units}) >= MIN_DAYS
            and len({s for s, _d in units}) >= MIN_STATIONS)


def score(values) -> float:
    return _median([abs(v) for v in values])


def _percentile(sorted_xs, q):
    if not sorted_xs:
        return None
    i = min(len(sorted_xs) - 1, max(0, int(round(q * (len(sorted_xs) - 1)))))
    return sorted_xs[i]


def paired(base: dict, other: dict, units, rng, null: bool = True) -> dict:
    """score(other) - score(base) over `units`, its day-block bootstrap interval and (optionally) its label-swap band."""
    units = sorted(units)
    diff = score([other[u] for u in units]) - score([base[u] for u in units])
    by_day = {}
    for u in units:
        by_day.setdefault(u[1], []).append(u)
    days = sorted(by_day)
    boot = []
    for _ in range(DRAWS):
        pick = [u for d in (rng.choice(days) for _ in days) for u in by_day[d]]
        boot.append(score([other[u] for u in pick]) - score([base[u] for u in pick]))
    boot.sort()
    out = {"diff": diff, "ci": (_percentile(boot, 0.025), _percentile(boot, 0.975)), "shown": True}
    if null:
        swaps = []
        for _ in range(SHUFFLES):
            a, b = [], []
            for u in units:
                x, y = (base[u], other[u]) if rng.random() < 0.5 else (other[u], base[u])
                a.append(x)
                b.append(y)
            swaps.append(score(b) - score(a))
        swaps.sort()
        out["null_band"] = (_percentile(swaps, 0.025), _percentile(swaps, 0.975))
        out["shown"] = not (out["null_band"][0] <= diff <= out["null_band"][1])
    return out


def side(result) -> int:
    """+1: the interval is wholly above 0 (the factor helps). -1: wholly below. 0: it straddles zero."""
    lo, hi = result["ci"]
    return 1 if lo > 0.0 else -1 if hi < 0.0 else 0


def stability(base: dict, other: dict, units, groups: dict, full_side: int, rng) -> dict:
    """Leave one GROUP out (a station, or a region) and re-score: how many re-scores keep the full run's side of zero.
    A re-score whose cell falls under the minimum is counted as not scorable, never as kept. Reveals no group."""
    kept = scored = 0
    for g in sorted(set(groups.values())):
        rest = [u for u in units if groups.get(u[0]) != g]
        if len(rest) == len(units) or not cell_ok(rest):
            continue
        scored += 1
        kept += int(side(paired(base, other, rest, rng, null=False)) == full_side)
    return {"kept": kept, "scored": scored}


def level_tag(pattern) -> str:
    """Factor-off against its own constant (item B). `pattern` is score(off) - score(level-matched)."""
    if pattern is None:
        return "not tested"
    s = side(pattern)
    return ("the factor's pattern hurts" if s < 0 else "level only: the pattern helps, the level is off" if s > 0
            else "level only")


def verdict(pooled, regions: dict, extremes: dict, loso):
    """(word, reason) for one factor on forcing truth. `pooled` is None under the cell minimum; `regions` and
    `extremes` map a cell to its paired result or its difference, or to None where that cell has no number."""
    if pooled is None:
        return "UNTESTABLE", "the pooled cell is under the minimum"
    if not pooled["shown"]:
        return "NOT SHOWN", "the difference is inside the label-swap band"
    s = side(pooled)
    if s == 0:
        return "UNDECIDED", "the interval includes zero"
    against = [k for k, v in regions.items() if v is not None and s * v["diff"] < -REGION_MARGIN]
    if against:
        return "UNDECIDED", "the opposite holds by more than %.2f in: %s" % (REGION_MARGIN, ", ".join(sorted(against)))
    if loso is not None and loso["kept"] < loso["scored"]:
        return "UNDECIDED", "it loses its side of zero with one station left out (%d of %d kept)" % (
            loso["kept"], loso["scored"])
    if s < 0:
        worse = [k for k, v in extremes.items() if v is not None and v > REGION_MARGIN]
        if worse:
            return "DISQUALIFIED", "worse by more than %.2f at the extremes: %s" % (REGION_MARGIN, ", ".join(sorted(worse)))
        return "REMOVE CANDIDATE", ""
    better = ["%s by %.3f" % (k, -v) for k, v in sorted(extremes.items()) if v is not None and v < -REGION_MARGIN]
    return "KEEP", ("factor-off is better at the extremes: " + ", ".join(better)) if better else ""


def positive_control(rows, regions_by_station) -> dict:
    """Seed x1.3 on every model height in the region with the most station-days; the served analysis must read that
    region as 1.25 to 1.35 over the unseeded run, or the whole test is INVALID. A plumbing check."""
    base = station_days(rows)
    by_region = {}
    for (s, d) in base:
        by_region.setdefault(regions_by_station.get(s, "other"), []).append((s, d))
    by_region.pop("other", None)
    if not by_region:
        return {"status": "INVALID", "reason": "no station in a named region"}
    region = max(sorted(by_region), key=lambda k: len(by_region[k]))
    seeded = station_days(rows, scale={s: CONTROL_FACTOR for s, r in regions_by_station.items() if r == region})
    units = by_region[region]
    ratio = math.exp(_median([seeded[u] for u in units]) - _median([base[u] for u in units]))
    ok = CONTROL_BAND[0] <= ratio <= CONTROL_BAND[1]
    return {"status": "OK" if ok else "INVALID", "region": region, "recovered": ratio}


def _n(units):
    return len(units) if len(units) >= HIDE_BELOW else None


def _cells(units, regions_by_station) -> dict:
    cells = {"pooled": list(units)}
    for u in units:
        cells.setdefault(regions_by_station.get(u[0], "other"), []).append(u)
    return cells


def counts_only(rows, regions_by_station) -> dict:
    """What a health run may print: how much there is, per region. No score, no difference."""
    units = sorted(station_days(rows))
    cells = _cells(units, regions_by_station)
    return {"n_station_days": _n(units), "n_days": len({d for _s, d in units}) if _n(units) else None,
            "regions": {k: _n(v) for k, v in cells.items() if k != "pooled"},
            "cells_at_minimum": sorted(k for k, v in cells.items() if cell_ok(v))}


def analyse(rows, regions_by_station, seed: int) -> dict:
    """Everything a SCORED run prints, as a dict of aggregates. No station id and no row leaves this function."""
    rng = random.Random(seed)
    sd = {name: station_days(rows, factors) for name, factors in CONFIGS}
    units_all = sorted(sd["served"])
    cells = _cells(units_all, regions_by_station)
    truth_cut = _percentile(sorted(float(r["obs_hs_m"]) for r in rows), 0.9) if rows else None
    subsets = {"top_tenth_of_truth": [r for r in rows if truth_cut is not None and float(r["obs_hs_m"]) >= truth_cut],
               "offshore_3m_or_more": [r for r in rows if (_pos(r.get("offshore_hs_m")) or 0.0) >= EXTREME_OFFSHORE_M]}
    out = dict(counts_only(rows, regions_by_station), served={}, factors={}, extremes={},
               not_runnable=list(NOT_RUNNABLE), not_built=list(NOT_BUILT))
    for cell, units in cells.items():
        if cell_ok(units):
            vals = [sd["served"][u] for u in units]
            out["served"][cell] = {"score": score(vals), "bias": math.exp(_median(vals)), "n": len(units)}
        else:
            out["served"][cell] = {"score": None, "bias": None, "n": _n(units)}
    ext_sd = {}
    for label, sub in subsets.items():
        s_served = station_days(sub)
        units = sorted(s_served)
        ext_sd[label] = (sub, s_served, units, cell_ok(units))
        out["extremes"][label] = {"n": _n(units), "served_score": score(list(s_served.values())) if cell_ok(units) else None}
    station_of = {u[0]: u[0] for u in units_all}
    region_of_station = {u[0]: regions_by_station.get(u[0], "other") for u in units_all}
    for name, factors in CONFIGS[1:]:
        res = {c: (paired(sd["served"], sd[name], u, rng) if cell_ok(u) else None) for c, u in cells.items()}
        table = {}
        for c, r in res.items():
            if r is None:
                table[c] = {"n": _n(cells[c])}
                continue
            b_on, b_off = _median([sd["served"][u] for u in cells[c]]), _median([sd[name][u] for u in cells[c]])
            table[c] = {"n": len(cells[c]), "diff": r["diff"], "ci": r["ci"], "null_band": r["null_band"],
                        "shown": r["shown"], "off_moves": "toward truth" if abs(b_off) < abs(b_on) else "away from truth"}
        named = {c: r for c, r in res.items() if c not in ("pooled", "other")}
        ext = {}
        for label, (sub, s_served, units, ok) in ext_sd.items():
            if ok:
                s_off = station_days(sub, factors)
                ext[label] = score([s_off[u] for u in units]) - score([s_served[u] for u in units])
            else:
                ext[label] = None
        pattern = loso = loro = None
        level = None
        if res["pooled"] is not None:
            level = _median([_product(r, factors) for r in rows])
            lv = station_days(rows, divide_by=level)
            pattern = paired(lv, sd[name], units_all, rng, null=False)
            full = side(res["pooled"])
            if full != 0:
                loso = stability(sd["served"], sd[name], units_all, station_of, full, rng)
                loro = stability(sd["served"], sd[name], units_all, region_of_station, full, rng)
        word, reason = verdict(res["pooled"], named, ext, loso)
        out["factors"][name] = {
            "verdict": word, "reason": reason, "level": level_tag(pattern), "level_constant": level,
            "pattern": None if pattern is None else {"diff": pattern["diff"], "ci": pattern["ci"]},
            "leave_one_station_out": loso, "leave_one_region_out": loro, "extremes": ext, "cells": table,
            "regions_tested": sorted(c for c, r in named.items() if r is not None),
            "regions_untested": sorted(c for c, r in named.items() if r is None)}
    out["positive_control"] = positive_control(rows, regions_by_station)
    return out


def _run_hour(obj):
    stamp = str(obj.get("generated_at") or "")
    try:
        return int(stamp[11:13])
    except ValueError:
        return None


def boundary_check(objects, start: str, end: str) -> dict:
    """Is a pairing fault hiding at the UTC day boundary? MODEL-FREE: it reads only the stored OBSERVATION.

    For one station and one target time the buoy's value is the same whichever run graded it. So for every
    (station, target time) graded by two consecutive GRADED runs, compare the observation each stored (its value and
    its time). Two groups: MIDNIGHT, where the later run fired in the hour after 00Z; CONTROL, where both runs fired
    between 02Z and 22Z. Buoy records get small late corrections and a later run can match a nearer reading, so some
    differing pairs are normal in both; a FAULT is an excess in the midnight group. Counts and shares only.

    "Fired" means the run's `generated_at`, the time its report was built: a fault of this kind comes from the job
    reading the clock, and that is the nearest thing to it the rows store. A run that starts at 23:58Z and reports at
    00:03Z is in the midnight group, which is where a day-boundary fault would put it."""
    seen_by_key = {}
    for obj in sorted((o for o in objects if isinstance(o, dict) and o.get("graded")), key=lambda o: str(o.get("generated_at"))):
        hour = _run_hour(obj)
        if hour is None:
            continue
        mine = {}
        for r in obj.get("rows") or []:
            t, o = str(r.get("valid_time") or ""), _pos(r.get("obs_hs_m"))
            if o and r.get("station") is not None and start <= t < end:
                mine.setdefault((str(r["station"]), t), (hour, o, str(r.get("obs_time"))))   # linked spots share one reading
        for key, v in mine.items():
            seen_by_key.setdefault(key, []).append(v)
    groups = {"midnight": [0, 0], "control": [0, 0]}
    for v in seen_by_key.values():
        for a, b in zip(v, v[1:]):
            g = "midnight" if b[0] == 0 else "control" if (2 <= a[0] <= 22 and 2 <= b[0] <= 22) else None
            if g is None:
                continue
            groups[g][0] += 1
            groups[g][1] += int(abs(a[1] - b[1]) > OBS_TOLERANCE_M or a[2] != b[2])
    out = {}
    for g, (pairs, differ) in groups.items():
        shown = pairs >= HIDE_BELOW
        out[g] = {"pairs": pairs if shown else None, "share": (differ / pairs) if shown else None}
    mid, ctl = out["midnight"]["share"], out["control"]["share"]
    if mid is None or ctl is None:
        out["status"] = "NOT TESTABLE (a group has fewer than %d pairs)" % HIDE_BELOW
    elif mid > BOUNDARY_FAULT_SHARE and mid > BOUNDARY_FAULT_RATIO * ctl:
        out["status"] = "FAULT"
    else:
        out["status"] = "no fault found"
    return out


def _boundary_block(b: dict):
    def cell(g):
        v = b[g]
        return "n/a" if v["pairs"] is None else "%d pairs, %.1f%% with a different observation" % (v["pairs"], 100.0 * v["share"])
    L = ["", "Day-boundary check (the OBSERVATION two runs stored for one station and target time; no model value): "
             "later run's report built in the hour after 00Z: %s. Both runs' reports built between 02Z and 22Z: %s. "
             "**%s.**" % (cell("midnight"), cell("control"), b["status"]),
         "A fault is more than %.0f%% in the midnight group AND more than %.0f times the control's share. The direct "
         "check (target time = forecast cycle + forecast hour) is NOT RUNNABLE: the rows do not store the cycle." % (
             100.0 * BOUNDARY_FAULT_SHARE, BOUNDARY_FAULT_RATIO)]
    if b["status"] == "FAULT":
        L.append("**Rows from the faulty runs must be excluded by a dated amendment BEFORE the scored dispatch.**")
    return L


def _f(x, nd=3):
    return "n/a" if x is None else ("%+." + str(nd) + "f") % x if isinstance(x, float) else str(x)


def _header(counts: dict, start: str, end: str, graded_runs, fetch_status: str):
    L = ["# S0 gate, forcing truth (nearshore buoys): the chain's height at the station", "",
         "Window: target times %s to %s. Rule: log 2026-11-16-fable-surf-ablation-s0-prereg.md." % (start, end), ""]
    L += ["- %s" % c for c in CAVEATS]
    L += ["", "Read: %s. Stored runs read: %d (graded %d, refused %d). Rows seen %d, unusable %d." % (
        fetch_status, counts["objects"], counts["graded"], counts["refused"], counts["rows_seen"], counts["rows_unusable"])]
    if counts.get("excluded_by_amendment"):
        L.append("Runs excluded by a dated amendment: %d." % counts["excluded_by_amendment"])
    if graded_runs is not None:
        L.append("Validation runs that were asked to grade and completed, created in the window: %d. Gap against the "
                 "stored run objects (graded or refused): about %d (APPROXIMATE: runs are counted by creation time, "
                 "stored objects by run day, rows by target time)." % (graded_runs, max(0, graded_runs - counts["objects"])))
    else:
        L.append("Requested validation runs in the window: not supplied, so the stored-against-requested gap is NOT CHECKED.")
    return L


def _counts_block(c: dict):
    return ["", "Station-days: %s over %s days. By region: %s." % (
        _f(c["n_station_days"]), _f(c["n_days"]),
        ", ".join("%s %s" % (k, _f(v)) for k, v in sorted(c["regions"].items())) or "none"),
        "Cells at the minimum (%d station-days, %d days, %d stations): %s." % (
            MIN_UNITS, MIN_DAYS, MIN_STATIONS, ", ".join(c["cells_at_minimum"]) or "none")]


def render_counts(c: dict, counts: dict, start: str, end: str, reason: str, graded_runs=None, fetch_status="ok",
                  boundary=None) -> str:
    """A health run: how much is stored, and the day-boundary check. No score, no difference, no verdict."""
    L = _header(counts, start, end, graded_runs, fetch_status) + _counts_block(c)
    if boundary is not None:
        L += _boundary_block(boundary)
    L += ["", "**COUNTS ONLY: %s. No score, difference or verdict is printed.**" % reason,
          "Verdicts are printed once per registered window, whole, after it closes, from a complete read."]
    return "\n".join(L) + "\n"


def render(result: dict, counts: dict, start: str, end: str, graded_runs=None, fetch_status="ok", boundary=None) -> str:
    """The scored report: markdown, aggregates only."""
    L = _header(counts, start, end, graded_runs, fetch_status)
    if boundary is not None:
        L += ["", "Day-boundary check on these rows: **%s**." % boundary["status"]]
    L.insert(1, "")
    L.insert(2, "**Scored dispatch 1 of 1 for this window.** Its run id is recorded in the log BEFORE this report is "
                "opened; a second scored dispatch needs a dated reason there first.")
    pc = result["positive_control"]
    L += ["", "Positive control (plumbing; x%.1f seeded in one region): **%s**%s." % (
        CONTROL_FACTOR, pc["status"], "" if "recovered" not in pc else ", recovered x%.3f in %s" % (pc["recovered"], pc["region"]))]
    if pc["status"] != "OK":
        return "\n".join(L + ["", "**THE TEST IS INVALID. No verdict is printed.**"]) + "\n"
    L += _counts_block(result)
    L += ["", "## Served chain", "", "| cell | station-days | score (median abs log) | model over observed |", "|---|---|---|---|"]
    for cell, v in result["served"].items():
        L.append("| %s | %s | %s | %s |" % (cell, _f(v["n"]), "n/a" if v["score"] is None else "%.3f" % v["score"],
                                           "n/a" if v["bias"] is None else "x%.3f" % v["bias"]))
    L += ["", "## Each factor switched off (difference from served; positive means the factor helps)", "",
          "The chain reads low, so switching off ANY factor below 1 moves toward truth. A REMOVE CANDIDATE marked "
          "'level only' says the chain is low. It does NOT say this factor's physics is wrong."]
    for name, f in result["factors"].items():
        word = f["verdict"] + (" (%s)" % f["level"] if f["verdict"] == "REMOVE CANDIDATE" else "")
        notes = [f["reason"]] if f["reason"] else []
        if f["leave_one_region_out"] is not None:
            notes.append("holds in %d of %d leave-one-region-out re-scores" % (
                f["leave_one_region_out"]["kept"], f["leave_one_region_out"]["scored"]))
        L += ["", "### %s: **%s**%s" % (name, word, "".join(". " + n for n in notes)), "",
              "| cell | station-days | difference | 95% interval | null band | shown | switching it off moves |",
              "|---|---|---|---|---|---|---|"]
        for cell, c in f["cells"].items():
            if "diff" not in c:
                L.append("| %s | %s | n/a | n/a | n/a | n/a | n/a |" % (cell, _f(c["n"])))
            else:
                L.append("| %s | %d | %s | %s to %s | %s to %s | %s | %s |" % (
                    cell, c["n"], _f(c["diff"]), _f(c["ci"][0]), _f(c["ci"][1]), _f(c["null_band"][0]),
                    _f(c["null_band"][1]), "yes" if c["shown"] else "NOT SHOWN", c["off_moves"]))
        L.append("")
        if f["pattern"] is not None:
            L.append("- Against its own constant (served divided by %.3f): %s, 95%% interval %s to %s: **%s**." % (
                f["level_constant"], _f(f["pattern"]["diff"]), _f(f["pattern"]["ci"][0]), _f(f["pattern"]["ci"][1]), f["level"]))
        for label, key in (("station", "leave_one_station_out"), ("region", "leave_one_region_out")):
            if f[key] is not None:
                L.append("- With one %s left out: %d of %d re-scores keep the same side of zero." % (
                    label, f[key]["kept"], f[key]["scored"]))
        L.append("- At the extremes (difference from served): %s." % "; ".join(
            "%s %s" % (k, _f(v)) for k, v in f["extremes"].items()))
        L.append("- Scope: tested in %s; NOT tested in %s. A served change resting on this verdict is limited to the "
                 "tested regions." % (", ".join(f["regions_tested"]) or "no region", ", ".join(f["regions_untested"]) or "none"))
    L += ["", "## Extremes, served chain", ""]
    for label, row in result["extremes"].items():
        L.append("- %s: station-days %s, served score %s." % (
            label, _f(row["n"]), "n/a" if row["served_score"] is None else "%.3f" % row["served_score"]))
    L += ["", "## Not judged here", ""] + ["- NOT RUNNABLE: %s." % x for x in result["not_runnable"]]
    L += ["- NOT BUILT: %s." % x for x in result["not_built"]]
    L += ["", "Season is UNTESTABLE in one window; an arm must reach the same verdict in both registered windows. "
              "A verdict changes nothing by itself: see the rule."]
    return "\n".join(L) + "\n"


def _storage(env):
    base = (env.get("SUPABASE_URL") or "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    parts = urllib.parse.urlparse(base)
    if not key or parts.scheme != "https" or not parts.hostname:
        return None, None
    return base, {"Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json"}


def fetch_objects(days, env=None, opener=urllib.request.urlopen):
    """Every stored run object under the given days. READ ONLY: one list call per day, one GET per object, to the
    host named by SUPABASE_URL and no other. Returns (objects, status); never prints a URL, a key or a row."""
    base, headers = _storage(os.environ if env is None else env)
    if not base:
        return [], "not_configured"
    objects, failed = [], 0
    for day in days:
        body = json.dumps({"prefix": PREFIX + day + "/", "limit": 1000}).encode("utf-8")
        try:
            with opener(urllib.request.Request("%s/storage/v1/object/list/%s" % (base, BUCKET), data=body, method="POST",
                                               headers=headers), timeout=60) as resp:
                names = [str(x.get("name")) for x in json.loads(resp.read().decode("utf-8")) if x.get("name")]
        except Exception:
            failed += 1
            continue
        if len(names) >= 1000:              # the list call is capped: a full page may hide objects
            failed += 1
        for name in sorted(n for n in names if n.endswith(".json")):
            try:
                url = "%s/storage/v1/object/%s/%s%s/%s" % (base, BUCKET, PREFIX, day, urllib.parse.quote(name))
                with opener(urllib.request.Request(url, headers=headers), timeout=60) as resp:
                    objects.append(json.loads(resp.read().decode("utf-8")))
            except Exception:
                failed += 1
    return objects, ("ok" if not failed else "partial_%d_failed" % failed)


def _days(start: str, end: str):
    d0 = datetime.date.fromisoformat(start[:10])
    d1 = datetime.date.fromisoformat(end[:10]) + datetime.timedelta(hours=SETTLE_HOURS)
    out = []
    while d0 <= d1:
        out.append(d0.isoformat())
        d0 += datetime.timedelta(days=1)
    return out


def report(objects, fetch_status: str, start: str, end: str, now: str, regions_by_station: dict, graded_runs=None) -> str:
    """PURE: the text a run prints, scored or counts-only, decided by `run_mode` and then by the day-boundary check.

    The scored path runs the check ITSELF, so the protection does not depend on someone having dispatched a
    counts-only run first. A FAULT prints no verdict, like a partial read: the faulty runs must first be excluded by
    a dated amendment (`EXCLUDED_RUNS`), after which the check is re-run on what is left."""
    kept = [o for o in objects if not (isinstance(o, dict) and str(o.get("generated_at"))[:19] in EXCLUDED_RUNS)]
    rows, counts = usable_rows(kept, start, end)
    counts["excluded_by_amendment"] = len(objects) - len(kept)
    boundary = boundary_check(kept, start, end)
    mode, detail = run_mode(start, end, now, fetch_status)
    if mode == "scored" and boundary["status"] == "FAULT":
        mode, detail = "counts", "the day-boundary check found a FAULT and no exclusion is registered for it"
    if mode != "scored":
        return render_counts(counts_only(rows, regions_by_station), counts, start, end, detail, graded_runs, fetch_status,
                             boundary=boundary)
    return render(analyse(rows, regions_by_station, detail), counts, start, end, graded_runs, fetch_status,
                  boundary=boundary)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default=REGISTERED_WINDOWS[0][0], help="first target time (UTC, inclusive)")
    ap.add_argument("--end", default=REGISTERED_WINDOWS[0][1], help="last target time (UTC, exclusive)")
    ap.add_argument("--pairs", action="append", default=[], help="a pairs JSON file (station coordinates); repeatable")
    ap.add_argument("--graded-runs", type=int, default=None, help="validation runs asked to grade and completed in the window, counted elsewhere")
    ap.add_argument("--out", default="", help="also write the report here")
    args = ap.parse_args(sys.argv[1:] if argv is None else argv)
    docs = []
    for p in args.pairs:
        with open(p, encoding="utf-8") as f:
            docs.append(json.load(f))
    # stored objects are filed by the day the RUN was made; a run can grade target times a day either side
    objects, status = fetch_objects(_days(args.start, args.end))
    print("NEARSHORE_ROWS fetch=%s objects=%d" % (status, len(objects)))
    if status == "not_configured":
        return 0
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    text = report(objects, status, args.start, args.end, now, station_regions(docs), args.graded_runs)
    print(text)
    for path in (args.out, os.environ.get("GITHUB_STEP_SUMMARY") or ""):
        if path:
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(text)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
