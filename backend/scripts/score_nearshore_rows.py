"""score_nearshore_rows.py: the S0 gate's FORCING-TRUTH half, scored from the private nearshore rows. Aggregates only.

THE RULE IS NOT MADE HERE. It is docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md (the 02:31Z
amendment, "what the saved rows can and cannot compute"), plus the dated section that names this file's reductions.
This module computes that rule and nothing else:

  quantity   the chain's height AT THE STATION (friction x shoaling x exposure x refraction; no cap, no H1/10)
  truth      the nearshore buoy's significant height
  switch     a factor is switched off by dividing the row's model height by that row's factor (exact: no cap binds)
  unit       the STATION-DAY: the median over a station-day's rows of log(model / observed)
  score      the median over station-days of the absolute station-day value; lower is better
  compare    score(factor off) - score(served): positive means the factor HELPS
  interval   day-block bootstrap, 2,000 draws, seed 20261207
  null       the two labels swapped at random within each station-day, 200 shuffles: a difference inside the 2.5 to
             97.5 band of the shuffles is NOT SHOWN, whatever its interval says
  cell       30 station-days over at least 7 days and 3 stations, or it prints its n and no number
  control    every model height in the region with the most station-days x 1.3 must read as 1.25 to 1.35 over, or INVALID

WHAT IT CANNOT JUDGE (so it never prints a verdict for them): Komar, H1/10, the cap, the magnets, the period arms,
spot classes. They act shoreward of every buoy or need inputs the rows do not carry. See the rule.

PRIVACY. The rows are our served forecasts at named stations and hours. This file prints pooled and per-REGION
aggregates only: never a row, a station id, a station-hour or a per-station number; a cell under 10 units prints no n
either. It holds the Storage service-role key while it fetches, so it is STANDARD LIBRARY ONLY, imports no project
module, and is run as `python3 -I -S` (a test pins the imports). It reads; it never writes to Storage."""
import argparse
import json
import math
import os
import random
import sys
import urllib.parse
import urllib.request

BUCKET = "weather-products"
PREFIX = "calibration/nearshore/rows/"
SEED = 20261207
DRAWS = 2000
SHUFFLES = 200
MIN_UNITS, MIN_DAYS, MIN_STATIONS = 30, 7, 3
HIDE_BELOW = 10                      # a cell smaller than this prints no count at all
REGION_MARGIN = 0.02                 # the rule's "no region worse by more than 0.02"
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


def station_days(rows, factors=(), scale=None) -> dict:
    """{(station, day): median over the unit's rows of log(model / observed)} with `factors` divided out of the model.
    `scale` ({station: multiplier}) is the positive control's seed and nothing else."""
    buckets = {}
    for r in rows:
        m = float(r["model_hs_m"])
        for k in factors:
            m /= float(r["factors"][k])
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


def paired(served: dict, off: dict, units, rng) -> dict:
    """score(off) - score(served) over `units`, its day-block bootstrap interval and its label-swap null band."""
    units = sorted(units)
    diff = score([off[u] for u in units]) - score([served[u] for u in units])
    by_day = {}
    for u in units:
        by_day.setdefault(u[1], []).append(u)
    days = sorted(by_day)
    boot = []
    for _ in range(DRAWS):
        pick = [u for d in (rng.choice(days) for _ in days) for u in by_day[d]]
        boot.append(score([off[u] for u in pick]) - score([served[u] for u in pick]))
    boot.sort()
    null = []
    for _ in range(SHUFFLES):
        a, b = [], []
        for u in units:
            x, y = (served[u], off[u]) if rng.random() < 0.5 else (off[u], served[u])
            a.append(x)
            b.append(y)
        null.append(score(b) - score(a))
    null.sort()
    lo, hi = _percentile(boot, 0.025), _percentile(boot, 0.975)
    n_lo, n_hi = _percentile(null, 0.025), _percentile(null, 0.975)
    return {"diff": diff, "ci": (lo, hi), "null_band": (n_lo, n_hi), "shown": not (n_lo <= diff <= n_hi)}


def verdict(pooled, regions: dict) -> str:
    """The rule's words for one factor on forcing truth. `pooled` is None where the pooled cell is under the minimum;
    `regions` maps a region to its paired result, or to None where that region's cell is under the minimum."""
    if pooled is None:
        return "UNTESTABLE"
    if not pooled["shown"]:
        return "NOT SHOWN"
    lo, hi = pooled["ci"]
    tested = {k: v for k, v in regions.items() if v is not None}
    if lo > 0.0 and not any(v["diff"] < -REGION_MARGIN for v in tested.values()):
        return "KEEP"
    if hi < 0.0 and not any(v["diff"] > REGION_MARGIN for v in tested.values()):
        return "REMOVE CANDIDATE"
    return "UNDECIDED"


def positive_control(rows, regions_by_station) -> dict:
    """Seed x1.3 on every model height in the region with the most station-days; the served analysis must read that
    region as 1.25 to 1.35 over the unseeded run, or the whole test is INVALID."""
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


def analyse(rows, regions_by_station, seed: int = SEED) -> dict:
    """Everything the gate prints, as a dict of aggregates. No station id and no row leaves this function."""
    rng = random.Random(seed)
    sd = {name: station_days(rows, factors) for name, factors in CONFIGS}
    units_all = sorted(sd["served"])
    cells = {"pooled": units_all}
    for u in units_all:
        cells.setdefault(regions_by_station.get(u[0], "other"), []).append(u)
    truth_cut = _percentile(sorted(float(r["obs_hs_m"]) for r in rows), 0.9) if rows else None
    subsets = {"all": rows,
               "top_tenth_of_truth": [r for r in rows if truth_cut is not None and float(r["obs_hs_m"]) >= truth_cut],
               "offshore_3m_or_more": [r for r in rows if (_pos(r.get("offshore_hs_m")) or 0.0) >= EXTREME_OFFSHORE_M]}
    out = {"n_station_days": _n(units_all), "n_days": len({d for _s, d in units_all}) if _n(units_all) else None,
           "regions": {k: _n(v) for k, v in cells.items() if k != "pooled"}, "served": {}, "factors": {}, "extremes": {},
           "not_runnable": list(NOT_RUNNABLE), "not_built": list(NOT_BUILT)}
    for cell, units in cells.items():
        if cell_ok(units):
            vals = [sd["served"][u] for u in units]
            out["served"][cell] = {"score": score(vals), "bias": math.exp(_median(vals)), "n": len(units)}
        else:
            out["served"][cell] = {"score": None, "bias": None, "n": _n(units)}
    for name, _f in CONFIGS[1:]:
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
        out["factors"][name] = {"verdict": verdict(res["pooled"], named), "cells": table,
                                "regions_untested": sorted(c for c, r in named.items() if r is None)}
    for label, sub in subsets.items():
        if label == "all":
            continue
        s_served = station_days(sub)
        units = sorted(s_served)
        row = {"n": _n(units)}
        if cell_ok(units):
            row["served_score"] = score(list(s_served.values()))
            for name, factors in CONFIGS[1:]:
                s_off = station_days(sub, factors)
                row[name] = score([s_off[u] for u in units]) - row["served_score"]
        out["extremes"][label] = row
    out["positive_control"] = positive_control(rows, regions_by_station)
    return out


def _f(x, nd=3):
    return "n/a" if x is None else ("%+." + str(nd) + "f") % x if isinstance(x, float) else str(x)


def render(result: dict, counts: dict, start: str, end: str, graded_runs=None) -> str:
    """The report: markdown, aggregates only."""
    L = ["# S0 gate, forcing truth (nearshore buoys): the chain's height at the station",
         "", "Window: target times %s to %s. Rule: log 2026-11-16-fable-surf-ablation-s0-prereg.md." % (start, end), "",
         "Stored runs read: %d (graded %d, refused %d). Rows seen %d, unusable %d." % (
             counts["objects"], counts["graded"], counts["refused"], counts["rows_seen"], counts["rows_unusable"])]
    if graded_runs is not None:
        L.append("Graded workflow runs in the window: %d. Gap (graded runs with no stored rows): %d." % (
            graded_runs, max(0, graded_runs - counts["graded"])))
    else:
        L.append("Graded workflow runs in the window: not supplied, so the stored-against-graded gap is NOT CHECKED.")
    pc = result["positive_control"]
    L += ["", "Positive control (x%.1f seeded in one region): **%s**%s." % (
        CONTROL_FACTOR, pc["status"], "" if "recovered" not in pc else ", recovered x%.3f in %s" % (pc["recovered"], pc["region"]))]
    if pc["status"] != "OK":
        return "\n".join(L + ["", "**THE TEST IS INVALID. No verdict is printed.**"]) + "\n"
    L += ["", "Station-days: %s over %s days. A cell under %d station-days, %d days or %d stations prints no number." % (
        _f(result["n_station_days"]), _f(result["n_days"]), MIN_UNITS, MIN_DAYS, MIN_STATIONS), "",
        "## Served chain", "", "| cell | station-days | score (median abs log) | model over observed |", "|---|---|---|---|"]
    for cell, v in result["served"].items():
        L.append("| %s | %s | %s | %s |" % (cell, _f(v["n"]), "n/a" if v["score"] is None else "%.3f" % v["score"],
                                           "n/a" if v["bias"] is None else "x%.3f" % v["bias"]))
    L += ["", "## Each factor switched off (difference from served; positive means the factor helps)"]
    for name, f in result["factors"].items():
        L += ["", "### %s: **%s**" % (name, f["verdict"]), "",
              "| cell | station-days | difference | 95% interval | null band | shown | switching it off moves |",
              "|---|---|---|---|---|---|---|"]
        for cell, c in f["cells"].items():
            if "diff" not in c:
                L.append("| %s | %s | n/a | n/a | n/a | n/a | n/a |" % (cell, _f(c["n"])))
            else:
                L.append("| %s | %d | %s | %s to %s | %s to %s | %s | %s |" % (
                    cell, c["n"], _f(c["diff"]), _f(c["ci"][0]), _f(c["ci"][1]), _f(c["null_band"][0]),
                    _f(c["null_band"][1]), "yes" if c["shown"] else "NOT SHOWN", c["off_moves"]))
        if f["regions_untested"]:
            L.append("")
            L.append("Regions with no number, so the verdict says nothing about them: %s." % ", ".join(f["regions_untested"]))
    L += ["", "## Extremes (reported separately; an arm may not be worse there by more than %.2f)" % REGION_MARGIN, ""]
    for label, row in result["extremes"].items():
        if "served_score" not in row:
            L.append("- %s: station-days %s, no number." % (label, _f(row["n"])))
        else:
            L.append("- %s: station-days %d, served %.3f; %s." % (label, row["n"], row["served_score"], "; ".join(
                "%s %s" % (k, _f(row[k])) for k, _x in CONFIGS[1:])))
    L += ["", "## Not judged here", ""] + ["- NOT RUNNABLE: %s." % x for x in result["not_runnable"]]
    L += ["- NOT BUILT: %s." % x for x in result["not_built"]]
    L += ["", "Season is UNTESTABLE in one window. A verdict changes nothing by itself: see the rule."]
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
        for name in sorted(n for n in names if n.endswith(".json")):
            try:
                url = "%s/storage/v1/object/%s/%s%s/%s" % (base, BUCKET, PREFIX, day, urllib.parse.quote(name))
                with opener(urllib.request.Request(url, headers=headers), timeout=60) as resp:
                    objects.append(json.loads(resp.read().decode("utf-8")))
            except Exception:
                failed += 1
    return objects, ("ok" if not failed else "partial_%d_failed" % failed)


def _days(start: str, end: str):
    import datetime as _dt
    d0, d1 = _dt.date.fromisoformat(start[:10]), _dt.date.fromisoformat(end[:10])
    out = []
    while d0 <= d1:
        out.append(d0.isoformat())
        d0 += _dt.timedelta(days=1)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-11-17T00:00:00", help="first target time (UTC, inclusive)")
    ap.add_argument("--end", default="2026-12-07T00:00:00", help="last target time (UTC, exclusive)")
    ap.add_argument("--pairs", action="append", default=[], help="a pairs JSON file (station coordinates); repeatable")
    ap.add_argument("--graded-runs", type=int, default=None, help="graded workflow runs in the window, counted elsewhere")
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
    rows, counts = usable_rows(objects, args.start, args.end)
    text = render(analyse(rows, station_regions(docs)), counts, args.start, args.end, args.graded_runs)
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
