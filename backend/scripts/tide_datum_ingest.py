"""tide_datum_ingest.py - builds `tides/model_datum.json`: the tide model's own 1-year mean per 0.1-degree spot cell.

The local datum for TIDE_LOCAL_DATUM (services/weather_pipeline/tide_datum.py). For every active catalogued spot's cell:
the mean of Open-Meteo `sea_level_height_msl` over the 365 days before today (one archive request per cell). Rolling
refresh: cells older than --max-age-days (30: at most monthly) are rebuilt, at most --limit per run (default 300), oldest first, so the daily
job stays far inside Open-Meteo's daily quota. Render only reads the table. Public read-only GETs to Open-Meteo; the
only write is the bucket object. --out FILE writes locally instead.
Run: python scripts/tide_datum_ingest.py [--limit N] [--max-age-days D] [--out FILE]
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.tide_datum import DATUM_KEY, cell_key  # noqa: E402

OPEN_METEO = "https://marine-api.open-meteo.com/v1/marine"
MIN_HOURS = 24 * 330          # >= 11 of the 12 months present, or the cell is not written (research: >= 12 months)


def year_mean(session, lat, lng, today):
    b, e = today - timedelta(days=365), today - timedelta(days=1)
    for attempt in range(3):
        try:
            r = session.get(f"{OPEN_METEO}?latitude={lat}&longitude={lng}&hourly=sea_level_height_msl"
                            f"&start_date={b:%Y-%m-%d}&end_date={e:%Y-%m-%d}&timezone=GMT", timeout=120)
            if r.status_code == 200:
                vals = [v for v in (r.json().get("hourly") or {}).get("sea_level_height_msl", []) if v is not None]
                return (sum(vals) / len(vals), len(vals)) if len(vals) >= MIN_HOURS else (None, len(vals))
            if r.status_code == 429:
                return None, -429
        except Exception as ex:                      # noqa: BLE001 - retried, then reported
            print(f"[tide-datum] {lat},{lng}: {type(ex).__name__}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    return None, 0


def plan_refresh(cells, table, today, max_age_days, limit):
    """PURE: the cells to (re)build this run: missing first, then the oldest past max_age_days, at most `limit`."""
    def age(k):
        built = ((table.get("cells") or {}).get(k) or {}).get("built")
        return -1.0 if not built else (today - datetime.fromisoformat(built)).days
    due = [k for k in cells if age(k) < 0 or age(k) >= max_age_days]
    due.sort(key=lambda k: (age(k) >= 0, -age(k)))
    return due[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--max-age-days", type=int, default=30)   # rebuilt at most monthly (owner decision)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    import requests
    session = requests.Session()
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not svc:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (read the spots; write the bucket)")
    from scripts.local_size_gonogo import _all_spots
    spots = _all_spots(session, base, svc)
    cells = sorted({cell_key(s["latitude"], s["longitude"]) for s in spots
                    if s.get("latitude") is not None and s.get("longitude") is not None})
    hdr = {"Authorization": f"Bearer {svc}", "apikey": svc}
    r = session.get(f"{base}/storage/v1/object/weather-products/{DATUM_KEY}", headers=hdr, timeout=60)
    table = r.json() if r.status_code == 200 else {}
    table.setdefault("cells", {})
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    todo = plan_refresh(cells, table, today, args.max_age_days, args.limit)
    built, short, limited = 0, 0, False
    for k in todo:
        la, lo = k.split(",")
        mean, hours = year_mean(session, la, lo, today)
        if hours == -429:
            limited = True
            break
        if mean is None:
            short += 1
            continue
        table["cells"][k] = {"mean_m": round(mean, 4), "hours": hours, "built": today.isoformat()}
        built += 1
        time.sleep(0.3)
    table.update(schema="raw-surf/tide-model-datum/1", window_days=365, updated_at=datetime.now(timezone.utc).isoformat())
    body = json.dumps(table, separators=(",", ":")).encode("utf-8")
    if args.out:
        with open(args.out, "wb") as fh:
            fh.write(body)
        ok = True
    else:
        w = session.post(f"{base}/storage/v1/object/weather-products/{DATUM_KEY}", data=body, timeout=60,
                         headers=dict(hdr, **{"Content-Type": "application/json", "x-upsert": "true"}))
        ok = w.status_code in (200, 201)
    from services.weather_pipeline.tide_datum import lookup
    fallback = sum(1 for sp in spots if sp.get("latitude") is not None and sp.get("longitude") is not None
                   and lookup(table, sp["latitude"], sp["longitude"]) is None)
    print(json.dumps({"spot_cells": len(cells), "planned": len(todo), "built": built, "too_short": short,
                      "rate_limited": limited, "table_cells": len(table["cells"]), "written": ok,
                      "spots": len(spots), "spots_on_window_72h_fallback": fallback}))
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
