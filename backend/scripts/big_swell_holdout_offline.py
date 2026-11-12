#!/usr/bin/env python3
"""big_swell_holdout_offline.py -- the big-swell bias per coast, rebuilt OFFLINE from public archives (ledger seq 217).

WHY THIS EXISTS
---------------
Commitment 217 (2026-09-30) asks for `by_forecast_by_region` (the ledger's `skill_consensus._by_forecast_by_region`)
on a held-out week DISJOINT from 2026-09-23..09-30, and a dark regional calibration only if the same coast reads
beyond ~0.2 m with n >= 30 in BOTH weeks. The ledger's own report is served only by the live backend and its scored
rows sit in Storage behind the service key. Neither is touched here. Instead every input is public and key-free:

  * forecasts: Open-Meteo's marine API, `wave_height_previous_day{1,2,3}` (the value predicted 24/48/72 h before the
    valid hour) for the three ledger members: `ncep_gfswave025` (the served `raw_surf` lane is GFS-Wave 0.25),
    `ecmwf_wam025` (`raw_surf:EURO`, ECMWF open data) and `dwd_gwam` (`raw_surf:ICON`, DWD GWAM);
  * observations: NDBC standard met WVHT through NOAA CoastWatch ERDDAP (`cwwcNDBCMet`), the hour's report nearest the
    target within 30 min.

The equal mean is the ledger's own definition (the plain mean of the three members on a pair where all three exist),
and the binning is the ledger's own function, imported, so the only differences from the ledger are the INPUTS
(Open-Meteo's grids at the buoy, not our regrid; a 2-hourly target cadence standing in for ~12 precompute runs a day;
the buoy population, see --population). The script prints its own positive controls; read them before the table.

FORECAST-BINNED, NOT OBSERVED-BINNED
------------------------------------
"When the forecast said >= 3 m, what came?" is the calibration a surfer relies on, and the only selection a forecast
calibration can act on (at serve time only the forecast is known). Selecting hours by the OBSERVED height instead
picks the hours where the truth was high, and any forecast with real scatter regresses toward the mean there: it reads
LOW even when perfectly calibrated. `--null-control` demonstrates this on synthetic data with a calibrated forecast.

Network: GET only, public hosts (marine-api.open-meteo.com, coastwatch.pfeg.noaa.gov, www.ndbc.noaa.gov). Every
response is cached under --cache so a re-run is offline. Prints aggregates only.

USAGE (from backend/)
    python scripts/big_swell_holdout_offline.py --cache <dir> --window 2026-11-03T00:00Z/2026-11-10T00:00Z
    python scripts/big_swell_holdout_offline.py --null-control
"""
import argparse
import json
import math
import os
import random
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.weather_pipeline.skill_consensus import (  # noqa: E402
    BIG_SWELL_M, NDBC_REGIONS, _by_forecast_by_region, region_of)

MODELS = {"raw_surf": "ncep_gfswave025", "raw_surf:EURO": "ecmwf_wam025", "raw_surf:ICON": "dwd_gwam"}
LEADS = {24: 1, 48: 2, 72: 3}
UA = {"User-Agent": "raw-surf-offline-research"}
ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?"
LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
OM = "https://marine-api.open-meteo.com/v1/marine?"


def _get(url, cache, name, timeout=180):
    path = os.path.join(cache, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = r.read().decode("utf-8")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return text


def _parse_t(s):
    return datetime.strptime(s.replace("Z", "")[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)


def wave_reporting_ids(cache):
    """The mapping script's candidate set (scripts/map_spots_to_ndbc_buoys.py): stations reporting WVHT now."""
    out = set()
    for ln in _get(LATEST_OBS, cache, "latest_obs.txt").splitlines()[2:]:
        p = ln.split()
        if len(p) > 11 and p[11] != "MM":
            out.add(p[0])
    return out


def observations(cache, start, end):
    """{station: {"lat", "lon", "obs": {hour: (minutes_off, wvht)}}} from ERDDAP, in-region five-digit ids only."""
    q = ("station,latitude,longitude,time,WVHT&time>=%s&time<=%s&WVHT!=NaN&station=~\"(41|42|44|46|51)[0-9]{3}\""
         % ((start - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            (end + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")))
    text = _get(ERDDAP + urllib.parse.quote(q, safe="&=,"), cache, "erddap_%s_%s.csv"
                % (start.strftime("%Y%m%d%H"), end.strftime("%Y%m%d%H")), timeout=600)
    st = {}
    for ln in text.splitlines()[2:]:
        p = ln.split(",")
        if len(p) < 5:
            continue
        try:
            t, h = _parse_t(p[3]), float(p[4])
        except ValueError:
            continue
        if not (math.isfinite(h) and 0 <= h < 25):
            continue
        s = st.setdefault(p[0], {"lat": float(p[1]), "lon": float(p[2]), "obs": {}})
        hour = (t + timedelta(minutes=30)).replace(minute=0, second=0)
        off = abs((t - hour).total_seconds()) / 60.0
        if off <= 30 and (hour not in s["obs"] or off < s["obs"][hour][0]):
            s["obs"][hour] = (off, h)
    return st


def forecasts(cache, stations, start, end):
    """{(station, lead, hour): {lane: hs}} from Open-Meteo's previous-day variables, batched 25 points a call."""
    ids = sorted(stations)
    out = {}
    hourly = ",".join("wave_height_previous_day%d" % d for d in LEADS.values())
    for lane, model in MODELS.items():
        for i in range(0, len(ids), 25):
            chunk = ids[i:i + 25]
            q = {"latitude": ",".join("%.3f" % stations[s]["lat"] for s in chunk),
                 "longitude": ",".join("%.3f" % stations[s]["lon"] for s in chunk),
                 "hourly": hourly, "models": model, "timezone": "GMT",
                 "start_date": start.strftime("%Y-%m-%d"), "end_date": end.strftime("%Y-%m-%d")}
            name = "om_%s_%s_%s_%d.json" % (model, start.strftime("%Y%m%d"), end.strftime("%Y%m%d"), i)
            data = json.loads(_get(OM + urllib.parse.urlencode(q), cache, name))
            data = data if isinstance(data, list) else [data]
            for s, loc in zip(chunk, data):
                h = loc.get("hourly") or {}
                times = [_parse_t(t) for t in h.get("time", [])]
                for lead, d in LEADS.items():
                    for t, v in zip(times, h.get("wave_height_previous_day%d" % d, [])):
                        if isinstance(v, (int, float)) and v > 0:
                            out.setdefault((s, lead, t), {})[lane] = float(v)
    return out


def build(stations, fc, start, end, step_h, population):
    """Per lead: aligned lists (served, equal, obs, region), every member present (the ledger's like-with-like)."""
    per = {lead: {"raw_surf": [], "equal": [], "obs": [], "region": []} for lead in LEADS}
    t = start
    while t < end:
        for s, info in stations.items():
            if population is not None and s not in population:
                continue
            o = info["obs"].get(t)
            if o is None:
                continue
            for lead in LEADS:
                got = fc.get((s, lead, t)) or {}
                if len(got) != len(MODELS):
                    continue
                g = per[lead]
                g["raw_surf"].append(got["raw_surf"])
                g["equal"].append(sum(got.values()) / len(MODELS))
                g["obs"].append(o[1])
                g["region"].append(region_of(s))
        t += timedelta(hours=step_h)
    return per


def _cell(errs, min_n):
    n = len(errs)
    return {"n": n, **({"bias_m": round(sum(errs) / n, 3), "mae_m": round(sum(abs(e) for e in errs) / n, 3)}
                       if n >= min_n else {})}


def report(per, min_n=10):
    out = {}
    for lead, g in per.items():
        fc = {"raw_surf": g["raw_surf"], "equal": g["equal"]}
        obs = g["obs"]
        out[lead] = {
            "pairs": len(obs),
            "pairs_by_region": {r: g["region"].count(r) for r in sorted(set(g["region"]))},
            "by_forecast_pooled": {k: _cell([f - o for f, o in zip(fc[k], obs) if f >= BIG_SWELL_M], min_n)
                                   for k in fc},
            "by_forecast_by_region": _by_forecast_by_region(fc, obs, g["region"], ("raw_surf", "equal"), min_n),
            "by_observed_by_region_equal": {
                r: _cell([f - o for f, o, rr in zip(g["equal"], obs, g["region"]) if rr == r and o >= BIG_SWELL_M],
                         min_n) for r in sorted(set(g["region"]))},
        }
    return out


def null_control(n=200000, seed=7):
    """A CALIBRATED forecast (obs = forecast + independent noise): forecast-binned bias ~0, observed-binned bias low."""
    rnd = random.Random(seed)
    f = [max(0.05, rnd.lognormvariate(math.log(1.4), 0.5)) for _ in range(n)]
    o = [max(0.0, x + rnd.gauss(0, 0.35)) for x in f]
    by_f = [a - b for a, b in zip(f, o) if a >= BIG_SWELL_M]
    by_o = [a - b for a, b in zip(f, o) if b >= BIG_SWELL_M]
    return {"by_forecast": _cell(by_f, 10), "by_observed": _cell(by_o, 10)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="directory for the cached public responses")
    ap.add_argument("--window", help="START/END target window, UTC ISO (END exclusive)")
    ap.add_argument("--step-h", type=int, default=2, help="target cadence (2 h ~ the ledger's 12 runs a day)")
    ap.add_argument("--population", choices=("wave_reporting", "all"), default="wave_reporting",
                    help="wave_reporting = the spot-mapping script's candidate set; all = every in-region station")
    ap.add_argument("--null-control", action="store_true")
    a = ap.parse_args()
    if a.null_control:
        print(json.dumps({"null_control": null_control()}, indent=1))
        return 0
    os.makedirs(a.cache, exist_ok=True)
    start, end = (_parse_t(x) for x in a.window.split("/"))
    stations = observations(a.cache, start, end)
    pop = wave_reporting_ids(a.cache) if a.population == "wave_reporting" else None
    fc = forecasts(a.cache, stations, start - timedelta(days=1), end + timedelta(days=1))
    per = build(stations, fc, start, end, a.step_h, pop)
    used = {s for s in stations if pop is None or s in pop}
    print(json.dumps({"window": a.window, "population": a.population, "step_h": a.step_h,
                      "stations_with_obs": len(used),
                      "stations_by_region": {r: sum(1 for s in used if region_of(s) == r)
                                             for r in sorted(set(NDBC_REGIONS.values()))},
                      "by_lead": report(per)}, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
