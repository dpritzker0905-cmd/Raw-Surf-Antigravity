"""dominant_swell_anim_census.py: the rating census for WAVES_ANIM_DOMINANT_SWELL, flag OFF vs ON (2026-11-12).

WHY. The flag is an INGEST-time rule in normalizer.py (the `dominant_swell_anim` block): for marine/waves, where the
larger of the two swell partitions holds >= WAVES_ANIM_SWELL_MIN_FRAC (0.35) of the total energy (H_sw^2 >= 0.35 Hs^2),
the cell's direction (and u/v) become that partition's direction. Height stays total. The point sampler reads the same
grid, so the rating's `swell_from` (and the height's refraction/exposure, which take the direction too) follow it. The
repository variable has been 1 since 2026-07-13 with no DECISIONS entry; this measures what it does to the served rating.

HOW. For each spot and sampled hour, one GFS-Wave sea state (Open-Meteo marine, models=ncep_gfswave025, nearest sea
cell: the same upstream model our GFS lane ingests from NOAA) and one GFS 10 m wind. Both lanes go through the REAL chain
(spot_ratings.rate_one_spot -> point_surf_augment.augment_with_surf -> resolve_surf_geometry / estimate_surf_at ->
compute_surf_rating) with a stub resolver; the ONLY difference between the lanes is the direction the stamp rule
gives. The §5i coherence gate (product-level partition availability >= 0.95) is assumed met: GFS carries partitions
everywhere it carries waves.

NOT OUR BOX. No request reaches the Raw Surf backend. Two public Open-Meteo reads per batch of spots, paused.
Run from backend/:  python scripts/dominant_swell_anim_census.py --spots <file of lat,lng lines> [--days 3 --step 6]
ASCII-only output (Windows console).
"""
import argparse
import asyncio
import json
import math
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import spot_ratings as SRT  # noqa: E402
from services.weather_pipeline.point_surf_augment import augment_with_surf  # noqa: E402
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse  # noqa: E402

MARINE = "https://marine-api.open-meteo.com/v1/marine"
WIND = "https://api.open-meteo.com/v1/gfs"
MARINE_VARS = ("wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,"
               "secondary_swell_wave_height,secondary_swell_wave_direction")
LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]
MIN_FRAC = float(os.environ.get("WAVES_ANIM_SWELL_MIN_FRAC", "0.35"))
BATCH = 20
PAUSE_S = 1.0


def stamped_direction(hs, total_dir, s1_h, s1_d, s2_h, s2_d, min_frac=MIN_FRAC):
    """The normalizer's per-cell rule, line for line: the larger partition (secondary wins only when strictly larger
    or the primary is missing) replaces the total direction when its energy share reaches min_frac."""
    if hs is None or total_dir is None or hs <= 0:
        return total_dir
    sw_h, sw_d = s1_h, s1_d
    if s2_h is not None and s2_d is not None and (sw_h is None or s2_h > sw_h):
        sw_h, sw_d = s2_h, s2_d
    if sw_h is not None and sw_d is not None and sw_h * sw_h >= min_frac * hs * hs:
        return float(sw_d)
    return total_dir


def ang_diff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _get(url, params):
    q = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(q, timeout=60) as r:
        d = json.load(r)
    return d if isinstance(d, list) else [d]


def fetch(coords, days):
    rows = []
    for i in range(0, len(coords), BATCH):
        chunk = coords[i:i + BATCH]
        lat = ",".join(str(c[0]) for c in chunk)
        lng = ",".join(str(c[1]) for c in chunk)
        m = _get(MARINE, {"latitude": lat, "longitude": lng, "hourly": MARINE_VARS, "models": "ncep_gfswave025",
                          "forecast_days": days, "timezone": "GMT", "cell_selection": "sea"})
        time.sleep(PAUSE_S)
        w = _get(WIND, {"latitude": lat, "longitude": lng, "hourly": "wind_speed_10m,wind_direction_10m",
                        "wind_speed_unit": "kn", "forecast_days": days, "timezone": "GMT"})
        time.sleep(PAUSE_S)
        for c, mm, ww in zip(chunk, m, w):
            rows.append((c, mm["hourly"], ww["hourly"]))
    return rows


def _resp(domain, layer, t, speed, direction, period):
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain=domain, layer=layer, run_time=t, valid_time=t,
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=0, requested_lng=0, sampled_lat=0, sampled_lng=0,
                                    speed=speed, direction=direction, u=0.0, v=0.0, period=period,
                                    interpolation_method="exact_match"),
        value_kind="wave_height" if domain == "marine" else "wind_speed",
        value_unit="m" if domain == "marine" else "kn", display_unit_hint="ft",
        source_variables=["x"], freshness_sec=0)


class StubResolver:
    def __init__(self, t, hs, direction, tp, s1_h, s1_d, s1_tp, wind_kn, wind_from):
        self.t, self.hs, self.dir, self.tp = t, hs, direction, tp
        self.s1 = (s1_h, s1_d, s1_tp)
        self.wind = (wind_kn, wind_from)

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str, **_k):
        if domain == "wind":
            return _resp("wind", "wind", self.t, self.wind[0], self.wind[1], None)
        if layer == "waves":
            async def _none(*_a, **_kw):
                return None
            return await augment_with_surf(_resp("marine", "waves", self.t, self.hs, self.dir, self.tp),
                                           model, domain, layer, lat, lng, valid_time_str, _none)
        if layer == "swell_1" and self.s1[0] is not None:
            return _resp("marine", "swell_1", self.t, self.s1[0], self.s1[1], self.s1[2])
        return None


def rate(lat, lng, t, iso, hs, direction, tp, s1_h, s1_d, wind_kn, wind_from):
    res = StubResolver(t, hs, direction, tp, s1_h, s1_d, tp, wind_kn, wind_from)
    return asyncio.run(SRT.rate_one_spot(res, {"id": "census", "name": "census", "latitude": lat, "longitude": lng},
                                         "GFS", iso))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", required=True)
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--step", type=int, default=6, help="sample every N hours")
    ap.add_argument("--out", default=None, help="optional JSON of per-row results")
    a = ap.parse_args()
    coords = [tuple(float(x) for x in ln.split(",")[:2]) for ln in open(a.spots) if ln.strip()]
    data = fetch(coords, a.days)

    out, skipped = [], Counter()
    for (lat, lng), mh, wh in data:
        times = mh["time"]
        for i in range(0, len(times), a.step):
            hs, d0, tp = mh["wave_height"][i], mh["wave_direction"][i], mh["wave_period"][i]
            if hs is None or d0 is None or tp is None or hs < 0.05:
                skipped["no_sea_state"] += 1
                continue
            s1h, s1d = mh["swell_wave_height"][i], mh["swell_wave_direction"][i]
            s2h, s2d = mh["secondary_swell_wave_height"][i], mh["secondary_swell_wave_direction"][i]
            wk, wd = wh["wind_speed_10m"][i], wh["wind_direction_10m"][i]
            if wk is None or wd is None:
                skipped["no_wind"] += 1
                continue
            d1 = stamped_direction(hs, d0, s1h, s1d, s2h, s2d)
            iso = times[i] + ":00Z"
            t = datetime.fromisoformat(times[i]).replace(tzinfo=timezone.utc)
            off = rate(lat, lng, t, iso, hs, float(d0), tp, s1h, s1d, wk, wd)
            on = off if d1 == d0 else rate(lat, lng, t, iso, hs, float(d1), tp, s1h, s1d, wk, wd)
            out.append({"lat": lat, "lng": lng, "time": iso, "hs": hs, "dir_off": d0, "dir_on": d1,
                        "stamped": d1 != d0, "dturn": ang_diff(d0, d1),
                        "score_off": off.get("score"), "score_on": on.get("score"),
                        "level_off": off.get("level"), "level_on": on.get("level"),
                        "h_off": off.get("surf_height_m"), "h_on": on.get("surf_height_m")})

    n = len(out)
    st = [r for r in out if r["stamped"]]
    print(f"rows {n} (spots {len(coords)}, every {a.step} h over {a.days} d); skipped {dict(skipped)}")
    print(f"stamped (direction changed): {len(st)} = {100.0 * len(st) / max(n, 1):.1f}%")
    if st:
        turns = sorted(r["dturn"] for r in st)
        q = lambda p: turns[min(len(turns) - 1, int(p * len(turns)))]  # noqa: E731
        print(f"  direction change on stamped rows: median {q(0.5):.0f} deg, p90 {q(0.9):.0f}, max {turns[-1]:.0f}; "
              f">=45 deg {sum(t >= 45 for t in turns)}, >=90 deg {sum(t >= 90 for t in turns)}")
    sc = [(r["score_on"] - r["score_off"]) for r in out if r["score_on"] is not None and r["score_off"] is not None]
    lv = [r for r in out if r["level_on"] != r["level_off"]]
    print(f"score delta (ON - OFF), all rows: mean {statistics.mean(sc):+.2f}, mean |d| {statistics.mean(abs(x) for x in sc):.2f}, "
          f"min {min(sc):+.1f}, max {max(sc):+.1f}")
    scs = [r["score_on"] - r["score_off"] for r in st if r["score_on"] is not None and r["score_off"] is not None]
    if scs:
        print(f"score delta on stamped rows: mean {statistics.mean(scs):+.2f}, mean |d| {statistics.mean(abs(x) for x in scs):.2f}")
    print(f"LEVEL changed: {len(lv)} = {100.0 * len(lv) / max(n, 1):.1f}% of rows "
          f"({100.0 * len(lv) / max(len(st), 1):.1f}% of stamped rows)")
    up = sum(LEVELS.index(r["level_on"]) > LEVELS.index(r["level_off"]) for r in lv
             if r["level_on"] in LEVELS and r["level_off"] in LEVELS)
    print(f"  level up {up}, down {len(lv) - up}")
    hd = [(r["h_on"] - r["h_off"]) for r in out if r["h_on"] is not None and r["h_off"] is not None]
    if hd:
        print(f"breaking height delta (m): mean {statistics.mean(hd):+.3f}, mean |d| {statistics.mean(abs(x) for x in hd):.3f}, "
              f"rows moved >0.1 m {sum(abs(x) > 0.1 for x in hd)}")
    by_turn = defaultdict(list)
    for r in st:
        if r["score_on"] is not None and r["score_off"] is not None:
            by_turn[min(int(r["dturn"] // 30) * 30, 90)].append(abs(r["score_on"] - r["score_off"]))
    for k in sorted(by_turn):
        print(f"  turn {k:>3}-{'+' if k == 90 else k + 30:<3} deg: n {len(by_turn[k]):>4}, mean |dscore| {statistics.mean(by_turn[k]):.2f}")
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
