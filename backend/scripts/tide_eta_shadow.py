"""tide_eta_shadow.py - shadow read of served eta (NOAA tide + model surge, option B) against OBSERVED water, by LEAD.

Why (advisor + director, 2026-11-15): option B passed its held-out test on HINDCAST water levels with a 0.015 m median
edge; in production the surge at +24..+72 h is a FORECAST, and the guardrail is BLIND to it. This records what
production would serve and scores it once the water has happened. Never calls Render.

  record : for each station, build its document with the CI ingest's own code (`tide_harmonic_ingest.station_doc`),
           take the live model forecast at its cell on the fixed 365-day datum, run production's `tide_harmonic.combine`,
           and store water_level and level for now .. +72 h (plus the held tail to +96 h) as
           `tides/shadow/eta-<UTC date>.json` in the weather-products bucket (--out DIR for local files).
  score  : read every stored record at least 1 day old, fetch CO-OPS observed water (MSL, on the hour) for its hours,
           and report RMSE by lead band (0-24, 24-48, 48-72, 72-96 h held) for B (water_level) and the tide alone (level).
Pass line (written before any scoring, log 2026-11-15-claude-tide-harmonic.md): after >= 14 daily records, B is not
worse than the tide alone in any lead band by more than 0.02 m (median over stations of the band RMSE).
Public read-only GETs to NOAA and Open-Meteo; the only writes are tides/shadow/*.
Run: python scripts/tide_eta_shadow.py record [--out DIR] | score [--dir DIR]
"""
import argparse
import json
import math
import os
import statistics as st
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("TIDE_SURGE_RESIDUAL", "1")
os.environ.setdefault("TIDE_LOCAL_DATUM", "1")

from scripts.tide_harmonic_ingest import COOPS, OPEN_METEO, _get, station_doc  # noqa: E402
from services.weather_pipeline import tide as T  # noqa: E402
from services.weather_pipeline import tide_harmonic as H  # noqa: E402

STATIONS = ["1612340", "1615680", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380", "8452660",
            "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670", "8723214", "8726724",
            "9755371", "9751639"]
BANDS = [(0, 24), (24, 48), (48, 72), (72, 96)]
PREFIX = "tides/shadow/"


def _meta(session, sid):
    d = (_get(session, f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json", "meta") or {}).get("stations") or [{}]
    return {"id": sid, "name": d[0].get("name", sid), "lat": float(d[0]["lat"]), "lng": float(d[0]["lng"])}


def record(session, now):
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    issued = now.replace(minute=0, second=0, microsecond=0)
    out = {"schema": "raw-surf/tide-eta-shadow/1", "issued": issued.isoformat(), "stations": {}}
    for sid in STATIONS:
        m = _meta(session, sid)
        doc = station_doc(session, m, today)
        la, lo = round(m["lat"], 1), round(m["lng"], 1)
        fc = _get(session, f"{OPEN_METEO}?latitude={la}&longitude={lo}&hourly=sea_level_height_msl&forecast_days=3"
                           "&timezone=GMT", "forecast") or {}
        yr = _get(session, f"{OPEN_METEO}?latitude={la}&longitude={lo}&hourly=sea_level_height_msl"
                           f"&start_date={(today - timedelta(days=365)):%Y-%m-%d}&end_date={(today - timedelta(days=1)):%Y-%m-%d}"
                           "&timezone=GMT", "year") or {}
        yv = [v for v in (yr.get("hourly") or {}).get("sea_level_height_msl", []) if v is not None]
        h = fc.get("hourly") or {}
        if not doc or not h.get("time") or len(yv) < 24 * 300:
            out["stations"][sid] = {"error": "inputs missing"}
            continue
        model = T.to_local_datum({"time": h["time"], "level": h["sea_level_height_msl"]}, sum(yv) / len(yv))
        served = H.combine(model, doc, dict(m, distance_km=0.0), now=now)
        if not served:
            out["stations"][sid] = {"error": "combine refused (shape guard or stale)"}
            continue
        rows = []
        for t, lv, wl in zip(served["time"], served["level"], served["water_level"]):
            dt = H._parse(t)
            lead = (dt - issued).total_seconds() / 3600 if dt else None
            if lead is not None and 0 <= lead < 96 and lv is not None:
                rows.append([dt.isoformat(), round(lead, 1), lv, wl])
        out["stations"][sid] = {"name": m["name"], "hours": rows, "surge_hours": served["surge_hours"]}
    return out


def score(records, session):
    per = {}   # (station, band) -> {"B": [errors], "tide": [errors]}
    for rec in records:
        for sid, s in rec.get("stations", {}).items():
            rows = s.get("hours") or []
            if not rows:
                continue
            b = datetime.fromisoformat(rows[0][0])
            e = datetime.fromisoformat(rows[-1][0])
            d = _get(session, f"{COOPS}/api/prod/datagetter?product=water_level&application=rawsurf_tide_shadow&station={sid}"
                              f"&datum=MSL&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}", "obs") or {}
            obs = {}
            for r in d.get("data") or []:
                try:
                    t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                    if t.minute == 0 and r.get("v") not in (None, ""):
                        obs[t] = float(r["v"])
                except (KeyError, ValueError):
                    pass
            for t, lead, lv, wl in rows:
                dt = datetime.fromisoformat(t)
                if dt not in obs:
                    continue
                band = next((x for x in BANDS if x[0] <= lead < x[1]), None)
                slot = per.setdefault((sid, band), {"B": [], "tide": []})
                slot["B"].append(wl - obs[dt])
                slot["tide"].append(lv - obs[dt])
    rmse = lambda xs: math.sqrt(sum(x * x for x in xs) / len(xs))   # noqa: E731
    out = {}
    for band in BANDS:
        cells = [v for (sid, b), v in per.items() if b == band and len(v["B"]) >= 24]
        if cells:
            mb, mt = st.median(rmse(c["B"]) for c in cells), st.median(rmse(c["tide"]) for c in cells)
            out[f"{band[0]}-{band[1]}h"] = {"stations": len(cells), "median_rmse_B": round(mb, 3),
                                             "median_rmse_tide": round(mt, 3), "B_minus_tide": round(mb - mt, 3),
                                             "within_line": mb - mt <= 0.02}
    return {"records": len(records), "bands": out,
            "PASS": len(records) >= 14 and bool(out) and all(v["within_line"] for v in out.values())}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=["record", "score"])
    ap.add_argument("--out", default="")
    ap.add_argument("--dir", default="")
    args = ap.parse_args()
    import requests
    session = requests.Session()
    now = datetime.now(timezone.utc)
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    hdr = {"Authorization": f"Bearer {svc}", "apikey": svc}
    if args.mode == "record":
        rec = record(session, now)
        body = json.dumps(rec, separators=(",", ":")).encode("utf-8")
        key = f"{PREFIX}eta-{now:%Y-%m-%d}.json"
        if args.out:
            os.makedirs(args.out, exist_ok=True)
            open(os.path.join(args.out, os.path.basename(key)), "wb").write(body)
        else:
            r = session.post(f"{base}/storage/v1/object/weather-products/{key}", data=body, timeout=60,
                             headers=dict(hdr, **{"Content-Type": "application/json", "x-upsert": "true"}))
            if r.status_code not in (200, 201):
                raise SystemExit(f"upload failed: HTTP {r.status_code}")
        print(json.dumps({"recorded": key, "stations": {k: ("ok" if "hours" in v else v["error"]) for k, v in rec["stations"].items()}}))
        return
    records = []
    if args.dir:
        for f in sorted(os.listdir(args.dir)):
            if f.startswith("eta-") and f.endswith(".json"):
                records.append(json.load(open(os.path.join(args.dir, f), encoding="utf-8")))
    else:
        lst = session.post(f"{base}/storage/v1/object/list/weather-products", headers=hdr, timeout=60,
                           json={"prefix": PREFIX, "limit": 1000}).json() or []
        for item in lst:
            name = item.get("name", "")
            if name.startswith("eta-"):
                g = session.get(f"{base}/storage/v1/object/weather-products/{PREFIX}{name}", headers=hdr, timeout=60)
                if g.status_code == 200:
                    records.append(g.json())
    cutoff = now - timedelta(days=1)
    records = [r for r in records if datetime.fromisoformat(r["issued"]) <= cutoff]
    print(json.dumps(score(records, session), indent=1))


if __name__ == "__main__":
    main()
