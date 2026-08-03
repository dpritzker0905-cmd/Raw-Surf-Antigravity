"""backend/scripts/model_skill_census.py — WHICH OF OUR THREE MODELS IS ACTUALLY THE MOST ACCURATE?

THE QUESTION, AND WHY IT IS THE ONE THAT MATTERS
------------------------------------------------
SOTA ledger row 6 said *"no skill score is currently computed against instruments, so state of the
art is a claim we cannot check."* **That is FALSE** — `services/weather_pipeline/forecast_skill.py`
exists, runs from the calibration loop, and has a populated archive
(`calibration/skill/scored-YYYY-MM.json`, 1.58 MB on 2026-08-03). Reading it for the first time gave
the answer nobody had looked at, PAIRED on (buoy, target hour, lead) over 3,852 cells:

    lead     ours MAE     open-meteo MAE     we win
    +24 h      0.289          0.182           35.6%
    +48 h      0.311          0.210           37.6%
    +72 h      0.341          0.239           42.6%

**A free competitor is ~52% more accurate than us, at 42 of 59 buoys, with ~zero bias on both sides
— so it is SCATTER, not an offset a constant could fix.**

⭐ THE JACOBIAN. That comparison scores `BUOY_CALIBRATION_MODEL`, which defaults to **GFS** — and
`/spot-ratings` also defaults to **GFS**. Open-Meteo's `wave_height` is their best-match blend, very
likely ECMWF WAM. So we may be scoring, and serving, our WEAKEST model. Measured at 14 buoys, one
hour, same coordinates, same valid_time:

    GFS  MAE 0.362  bias +0.251        ICON MAE 0.300  bias +0.191        EURO MAE 0.173  bias +0.065

EURO is ~52% better than GFS and lands on Open-Meteo's number — consistent with both being ECMWF.
**This script exists to turn that 14-buoy hypothesis into a measurement.**

TRUTH: NDBC `latest_obs.txt` — ONE fetch, ~890 stations, station id + LAT/LON + WVHT.
OURS: `/api/weather/point?model=…&domain=marine&layer=waves` at the buoy's own coordinates — the
same resolver the product serves from, so this scores what a user actually gets.

THE CONTROLS — a model comparison is unusually easy to fake
-----------------------------------------------------------
  * **PAIRED per buoy.** Only buoys where ALL models resolved are scored; an unpaired win can be
    pure coverage. The pairing rate is reported.
  * **THE PROVIDER CONTROL.** Every row records the served `upstream_provider`. "EURO is better"
    must not silently mean "EURO fell back to the same NOAA product". **If every model serves the
    same provider set the census VOIDS** — it would be comparing one product to itself.
  * **AGE-GATED TRUTH.** Observations older than `--max-age-min` are dropped: scoring a forecast
    against a stale observation measures the clock, not the physics.
  * **OBS-HEIGHT BANDS.** A single MAE hides the shape. GFS's error looked concentrated on FLAT
    seas (buoy 45168: obs 0.20 m, GFS 1.11 m — 5.5x), which matters more than the average suggests:
    over-reading a flat day is the app claiming surf that is not there.

⚠️ WHAT THIS IS NOT. One run is ONE HOUR. Wave models are correlated in time, so a single hour is
closer to n=1 than to n=buoys. **Run it repeatedly and pool** (`--json` appends a timestamped
record) before concluding anything about defaults. This repo has already generalised twice from a
single sample and been wrong both times.

USAGE
    python scripts/model_skill_census.py --buoys 60
    python scripts/model_skill_census.py --buoys 60 --json skill_runs.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://raw-surf-antigravity.onrender.com"
LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
MODELS = ("GFS", "ICON", "EURO")
# Bands chosen by what they mean to a surfer, not by equal counts: flat / small / rideable / big.
# ⚠️ IMPORTED, NOT REDEFINED (2026-08-03). `forecast_skill.OBS_BANDS` is canonical because the
# skill ledger now bands the same way — two copies of a band table diverge only on a boundary, and
# a census that disagrees with the ledger about what "flat" means is worse than no census.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.weather_pipeline.forecast_skill import OBS_BANDS as BANDS  # noqa: E402


def _fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-model-skill"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_latest_obs_waves(text, now, max_age_min):
    """Stations reporting a usable WVHT with coordinates, fresh enough to score against.

    Columns: `#STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT ...` — note this layout puts the
    station id and coordinates FIRST, unlike realtime2, which is why it needs its own parser rather
    than a shared column map that would silently mis-read.
    """
    out = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 12:
            continue
        try:
            sid, lat, lon = p[0], float(p[1]), float(p[2])
            t = datetime(int(p[3]), int(p[4]), int(p[5]), int(p[6]), int(p[7]), tzinfo=timezone.utc)
            if p[11] in ("MM", "", "999.0"):
                continue
            h = float(p[11])
            if not (0.0 < h < 30.0):
                continue
        except Exception:
            continue
        age = (now - t).total_seconds() / 60.0
        if age < 0 or age > max_age_min:
            continue
        out.append({"id": sid, "lat": lat, "lon": lon, "obs_hs_m": h, "age_min": round(age, 1)})
    return out


def _mae(v):
    return round(sum(abs(x) for x in v) / len(v), 4) if v else None


def _bias(v):
    return round(sum(v) / len(v), 4) if v else None


def census(sample, valid_time, workers=6):
    def one(job):
        st, model = job
        u = (f"{BASE}/api/weather/point?model={model}&domain=marine&layer=waves"
             f"&lat={st['lat']}&lng={st['lon']}&valid_time={valid_time}")
        try:
            d = json.loads(_fetch(u))
            return st["id"], model, (d.get("point") or {}).get("speed"), d.get("upstream_provider")
        except Exception:
            return st["id"], model, None, None

    jobs = [(s, m) for s in sample for m in MODELS]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(one, jobs))

    by, prov = defaultdict(dict), defaultdict(set)
    served = defaultdict(dict)          # (buoy, model) -> the provider that actually answered
    for sid, model, hs, up in res:
        by[sid][model] = hs
        served[sid][model] = up
        if up:
            prov[model].add(up)

    if len({frozenset(prov[m]) for m in MODELS}) == 1:
        raise RuntimeError(
            f"VOID: every model served the SAME upstream provider ({dict((m, sorted(prov[m])) for m in MODELS)}). "
            f"This compares one product to itself — a model label is not a model.")

    obs = {s["id"]: s["obs_hs_m"] for s in sample}
    paired = {k: v for k, v in by.items() if all(v.get(m) is not None for m in MODELS)}
    if len(paired) < 8:
        raise RuntimeError(f"VOID: only {len(paired)} buoys resolved ALL {len(MODELS)} models "
                           f"(of {len(sample)}). Too few to compare.")

    errs = {m: [] for m in MODELS}
    banded = {m: defaultdict(list) for m in MODELS}
    wins = {m: 0 for m in MODELS}
    # ⭐⭐ STRATIFY BY THE PROVIDER THAT ACTUALLY ANSWERED (2026-08-03).
    # A model label is not a data source. `euro_fallback_census.py` measured that `EURO` serves
    # genuine ECMWF at only ~83-86% of coordinates and `gfs_estimated_fallback` at the rest — and
    # that fallback is NOT GFS's value (0 of 11 matched; PACT2 0.4796 -> 0.2, Memories Beach
    # 1.3879 -> 0.84). So a pooled "EURO MAE" mixes ECMWF with a THIRD, never-scored estimator, and
    # the headline 0.223 was contaminated in an unknown direction. Splitting is the difference
    # between "EURO is better" and "ECMWF is better, and the hole is unmeasured".
    # ⚠️⚠️ AND MAE IS NOT COMPARABLE ACROSS DIFFERENT SITE POPULATIONS. Each provider answers at a
    # DIFFERENT set of coordinates — the ECMWF fallback fires precisely where ECMWF has no data,
    # which skews toward sheltered, low-energy sites where ANY estimator scores well in absolute
    # metres. Measured 2026-08-03: `EURO/gfs_estimated_fallback` posted MAE 0.092 — the best of every
    # stratum — which reads as "the fallback is excellent" and may only mean "the fallback fires on
    # small seas". The ONLY honest comparison is GFS's error ON THE SAME SITES, which the paired
    # design already has in hand. `gfs_mae_same_sites` is that control; without it this table
    # ranks site difficulty, not model skill.
    by_prov = defaultdict(list)
    by_prov_gfs = defaultdict(list)
    for sid, v in paired.items():
        o = obs[sid]
        for m in MODELS:
            e = v[m] - o
            errs[m].append(e)
            by_prov[(m, served[sid].get(m) or "unknown")].append(e)
            if m != "GFS":
                by_prov_gfs[(m, served[sid].get(m) or "unknown")].append(v["GFS"] - o)
            for lo, hi, label in BANDS:
                if lo <= o < hi:
                    banded[m][label].append(e)
                    break
        wins[min(MODELS, key=lambda m: abs(v[m] - o))] += 1

    return {
        "valid_time": valid_time,
        "n_buoys_sampled": len(sample),
        "n_buoys_paired": len(paired),
        "pairing_rate": round(len(paired) / len(sample), 3),
        "provider_by_model": {m: sorted(prov[m]) for m in MODELS},
        "by_model": {m: {"n": len(errs[m]), "mae_m": _mae(errs[m]), "bias_m": _bias(errs[m]),
                         "closest_at_n_buoys": wins[m]} for m in MODELS},
        "by_obs_band": {label: {m: {"n": len(banded[m][label]), "mae_m": _mae(banded[m][label]),
                                    "bias_m": _bias(banded[m][label])} for m in MODELS}
                        for _, _, label in BANDS},
        # THE UNPOOLED TRUTH: a model label is not a data source.
        "by_model_and_provider": {
            f"{m}/{p}": {
                "n": len(v), "mae_m": _mae(v), "bias_m": _bias(v),
                # THE CONTROL: GFS scored on EXACTLY these coordinates. Without it a stratum's MAE
                # ranks how easy its sites are, not how good its model is.
                "gfs_mae_same_sites": _mae(by_prov_gfs.get((m, p), [])) if m != "GFS" else None,
                "beats_gfs_here": (
                    None if m == "GFS" or not by_prov_gfs.get((m, p))
                    else _mae(v) < _mae(by_prov_gfs[(m, p)])),
            }
            for (m, p), v in sorted(by_prov.items())},
        "best_model": min(MODELS, key=lambda m: _mae(errs[m]) if _mae(errs[m]) is not None else 9e9),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--buoys", type=int, default=40)
    ap.add_argument("--max-age-min", type=float, default=90.0)
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--json", default=None, help="APPEND the run as one JSON line (pool across runs)")
    a = ap.parse_args()

    now = datetime.now(timezone.utc)
    stations = parse_latest_obs_waves(_fetch(LATEST_OBS), now, a.max_age_min)
    if len(stations) < 8:
        print(f"VOID: only {len(stations)} fresh buoy observations.", file=sys.stderr)
        return 2
    # Spread the sample geographically — the file's own order is regional, and a regional sample
    # would score one basin's weather rather than the models.
    stations.sort(key=lambda s: (round(s["lat"] / 10), round(s["lon"] / 10)))
    step = max(1, len(stations) // a.buoys)
    sample = stations[::step][:a.buoys]
    vt = a.valid_time or now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z")

    try:
        out = census(sample, vt)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    print(json.dumps(out, indent=2))
    if a.json:
        with open(a.json, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
