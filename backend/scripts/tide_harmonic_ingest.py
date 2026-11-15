"""tide_harmonic_ingest.py - the daily NOAA CO-OPS harmonic tide ingest (CI only; Render never calls CO-OPS).

For every active surf spot, the nearest harmonic CO-OPS station within tide_harmonic.RADIUS_KM; for each such station:
  - hourly predictions on the station MSL datum, GMT, from 14 days back to +15 days (one request; CO-OPS allows 365 d)
  - the published high/low events (`interval=hilo`, 6-minute precision) for yesterday .. +15 days
  - model_offset_m: median over the 14 past days of (Open-Meteo sea_level_height_msl at the station's 0.1-degree cell
    minus the prediction), the model's stable per-place offset that the surge residual removes (tide_harmonic)
and writes `tides/coops/<station>.json` + `tides/coops/index.json` to the weather-products bucket.
Public read-only GETs to NOAA and Open-Meteo; the only write is the bucket. --out DIR writes local files instead.
Run: python scripts/tide_harmonic_ingest.py [--out DIR] [--limit N]
"""
import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.tide_harmonic import INDEX_KEY, RADIUS_KM, STATION_KEY, km  # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov"
OPEN_METEO = "https://marine-api.open-meteo.com/v1/marine"
APP = "rawsurf_tide_ingest"


def _get(session, url, what):
    for attempt in range(3):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 200:
                return r.json()
        except Exception as e:                       # noqa: BLE001 - retried, then reported
            print(f"[tide-ingest] {what}: {type(e).__name__}", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    return None


def harmonic_stations(session):
    d = _get(session, f"{COOPS}/mdapi/prod/webapi/stations.json?type=tidepredictions", "station list") or {}
    return [{"id": s["id"], "name": s.get("name") or s["id"], "lat": float(s["lat"]), "lng": float(s["lng"])}
            for s in d.get("stations", []) if s.get("type") == "R" and s.get("lat") is not None]


def stations_for_spots(stations, spots, radius_km=RADIUS_KM):
    """PURE: the stations that are some spot's nearest harmonic station within radius_km, keyed by id."""
    used = {}
    for sp in spots:
        try:
            la, lo = float(sp["latitude"]), float(sp["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        best = min(((km(la, lo, s["lat"], s["lng"]), s) for s in stations), key=lambda x: x[0], default=None)
        if best and best[0] <= radius_km:
            used[best[1]["id"]] = best[1]
    return used


def station_doc(session, st, today):
    b14, e15 = today - timedelta(days=14), today + timedelta(days=15)
    q = (f"{COOPS}/api/prod/datagetter?product=predictions&application={APP}&station={st['id']}&datum=MSL"
         "&units=metric&time_zone=gmt&format=json")
    hourly = _get(session, f"{q}&interval=h&begin_date={b14:%Y%m%d}&end_date={e15:%Y%m%d}", f"{st['id']} hourly") or {}
    hilo = _get(session, f"{q}&interval=hilo&begin_date={today - timedelta(days=1):%Y%m%d}&end_date={e15:%Y%m%d}",
                f"{st['id']} hilo") or {}
    pred = {}
    for p in hourly.get("predictions", []):
        t = datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        pred[t] = round(float(p["v"]), 4)
    if len(pred) < 24 * 20:
        return None
    om = _get(session, f"{OPEN_METEO}?latitude={round(st['lat'], 1)}&longitude={round(st['lng'], 1)}"
                       "&hourly=sea_level_height_msl&past_days=14&forecast_days=1&timezone=GMT", f"{st['id']} model") or {}
    h = om.get("hourly") or {}
    diffs = []
    for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])):
        dt = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
        if v is not None and dt in pred and dt < today:
            diffs.append(v - pred[dt])
    serve_from = today - timedelta(days=1)
    keep = sorted(t for t in pred if t >= serve_from)
    return {
        "schema": "raw-surf/tide-coops/1", "station": st, "built_at": datetime.now(timezone.utc).isoformat(),
        "datum": "MSL", "source_url": f"https://tidesandcurrents.noaa.gov/stationhome.html?id={st['id']}",
        "series": {"time": [t.strftime("%Y-%m-%dT%H:%MZ") for t in keep], "level": [pred[t] for t in keep]},
        "events": [{"time": datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                    "height_m": round(float(p["v"]), 4), "type": "High" if p.get("type") == "H" else "Low"}
                   for p in hilo.get("predictions", []) if p.get("type") in ("H", "L")],
        "model_offset_m": round(statistics.median(diffs), 4) if len(diffs) >= 24 * 7 else None,
        "model_offset_hours": len(diffs),
    }


def _write(session, base, svc, out_dir, key, doc):
    body = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    if out_dir:
        path = os.path.join(out_dir, key.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(body)
        return True
    r = session.post(f"{base}/storage/v1/object/weather-products/{key}", data=body, timeout=60,
                     headers={"Authorization": f"Bearer {svc}", "apikey": svc, "Content-Type": "application/json",
                              "x-upsert": "true", "Cache-Control": "max-age=3600"})
    return r.status_code in (200, 201)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="", help="write files under DIR instead of the bucket")
    ap.add_argument("--limit", type=int, default=0, help="at most N stations (0 = all)")
    args = ap.parse_args()
    import requests
    session = requests.Session()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not svc:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (read the spots; write the bucket)")
    from scripts.local_size_gonogo import _all_spots
    spots = _all_spots(session, base, svc)
    used = stations_for_spots(harmonic_stations(session), spots)
    ids = sorted(used)[: args.limit or None]
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    index, failed = {}, []
    for sid in ids:
        doc = station_doc(session, used[sid], today)
        if doc and _write(session, base, svc, args.out, STATION_KEY.format(sid=sid), doc):
            index[sid] = {k: used[sid][k] for k in ("name", "lat", "lng")}
        else:
            failed.append(sid)
        time.sleep(0.25)
    ok = _write(session, base, svc, args.out, INDEX_KEY, {"schema": "raw-surf/tide-coops-index/1",
                                                          "built_at": datetime.now(timezone.utc).isoformat(),
                                                          "radius_km": RADIUS_KM, "stations": index})
    print(json.dumps({"spots": len(spots), "stations": len(ids), "written": len(index), "failed": failed,
                      "index_written": ok}))
    if not ok or (ids and len(index) < 0.8 * len(ids)):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
