"""OFFLINE before/after of SURF_TIDE_WINDOW_FIX on the depth-limited cap (2026-11-23). No live backend, no bucket.

The served table (tide_own) is private, so the tide here is a STAND-IN with the same shape the served path returns: NOAA
CO-OPS hourly predictions on the MSL datum (read-only) at a gauge near each spot, from 00Z today. Everything after the
fetch is the served chain unchanged: sea_inputs.resolve -> tide.tide_norm_at -> eta, then
surf_transform.effective_cap_depth(depth, break_depth, eta) with the spot's own geometry (surf_point.resolve_surf_geometry).
The flag is read per call, so OFF and ON run the same code on the same series.

    cd backend && python scripts/tide_window_cap_probe.py --json out.json
"""
import argparse
import asyncio
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.weather_pipeline import tide as T  # noqa: E402
from services.weather_pipeline import sea_inputs as SI  # noqa: E402
from services.weather_pipeline.surf_point import resolve_surf_geometry  # noqa: E402
from services.weather_pipeline.surf_transform import effective_cap_depth  # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
SPOTS = [  # (name, lat, lng, stand-in gauge)
    ("North Shore Oahu sweep point", 21.6650, -158.0500, "1612340"),
    ("Windansea, La Jolla", 32.8297, -117.2810, "9410230"),
    ("Ocean Beach, San Francisco", 37.7600, -122.5100, "9414290"),
    ("Rockaway Beach, NY", 40.5800, -73.8200, "8531680"),
]
LEADS_H = (24, 60, 80, 120, 200, 330)


def stand_in(sid, day0, days):
    q = (f"{COOPS}?product=predictions&application=raw_surf_window_probe&station={sid}"
         f"&begin_date={day0:%Y%m%d %H:%M}&end_date={(day0 + timedelta(days=days) - timedelta(hours=1)):%Y%m%d %H:%M}"
         f"&datum=MSL&units=metric&time_zone=gmt&interval=h&format=json").replace(" ", "%20")
    with urllib.request.urlopen(urllib.request.Request(q, headers={"User-Agent": "raw-surf-research/1.0"}), timeout=60) as r:
        rows = json.loads(r.read().decode("utf-8")).get("predictions", [])
    return {"time": [p["t"].replace(" ", "T") for p in rows], "level": [float(p["v"]) for p in rows], "source": "am"}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    day0 = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    os.environ["SURF_TIDE_DEPTH"] = "1"
    out = {"day0": day0.isoformat(), "stand_in": "NOAA CO-OPS hourly predictions, MSL datum", "spots": []}
    for name, lat, lng, sid in SPOTS:
        full = stand_in(sid, day0, T.TIDE_MAX_DAYS)

        async def fake(la, lo, client=None, forecast_days=3, _f=full):
            n = 24 * int(forecast_days)
            return {"time": _f["time"][:n], "level": _f["level"][:n], "source": "am"}
        T.fetch_tide_hourly = fake
        g = resolve_surf_geometry(lat, lng)
        row = {"spot": name, "lat": lat, "lng": lng, "gauge": sid, "depth_m": g.depth_m, "break_depth_m": g.break_depth_m,
               "leads": []}
        for h in LEADS_H:
            vt = (day0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
            truth = full["level"][h] if h < len(full["level"]) else None
            res = {"lead_h": h, "true_eta_m": truth}
            for tag, val in (("off", "0"), ("on", "1")):
                os.environ["SURF_TIDE_WINDOW_FIX"] = val
                eta, _ = asyncio.run(SI.resolve(lat, lng, vt, "GFS"))
                res[f"eta_{tag}_m"] = round(eta, 3)
                res[f"cap_depth_{tag}_m"] = round(effective_cap_depth(g.depth_m, g.break_depth_m, eta), 3)
            res["cap_depth_true_m"] = (round(effective_cap_depth(g.depth_m, g.break_depth_m, truth), 3)
                                       if truth is not None else None)
            row["leads"].append(res)
            print(f"{name[:26]:26s} +{h:3d}h true eta {truth!s:>7} | off eta {res['eta_off_m']:+.3f} cap {res['cap_depth_off_m']:.2f}"
                  f" | on eta {res['eta_on_m']:+.3f} cap {res['cap_depth_on_m']:.2f} | true cap {res['cap_depth_true_m']}")
        out["spots"].append(row)
    os.environ.pop("SURF_TIDE_WINDOW_FIX", None)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
