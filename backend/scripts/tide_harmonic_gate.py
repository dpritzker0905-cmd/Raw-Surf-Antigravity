"""tide_harmonic_gate.py - live gates G2 and G10 of the harmonic tide plan (docs/weather-program/log/2026-11-15-claude-tide-harmonic-plan.md).

G2 station truth: each station's ingest document (scripts/tide_harmonic_ingest.station_doc, the CI code) is served
through the real door (tide.fetch_tide_hourly with the bucket read injected) at the station's own coordinate; the
served hourly level must equal an independent CO-OPS hourly read to +-0.01 m and the served High/Low times the CO-OPS
hilo times to +-6 min.
G10 eta truth: against CO-OPS OBSERVED water levels (preliminary 6-min, on the hour, MSL) over the last 7 days, RMSE of (a) the harmonic tide alone,
(b) the model as served (local datum), (c) harmonic + the model's non-tidal residual (owner option B), with the model
offset taken from the 14 days BEFORE the scored week (out of sample). Option B passes when it beats both at the median.
Public read-only GETs (NOAA, Open-Meteo). Nothing touches the app's servers. Run: python scripts/tide_harmonic_gate.py
"""
import asyncio
import json
import math
import os
import statistics as st
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("TIDE_HARMONIC", "1")

import requests  # noqa: E402

from scripts.tide_harmonic_ingest import COOPS, OPEN_METEO, _get, station_doc  # noqa: E402
from services.weather_pipeline import tide as T  # noqa: E402
from services.weather_pipeline import tide_harmonic as H  # noqa: E402

IDS = ["1612340", "1615680", "1617760", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380", "8452660",
       "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670", "8723214", "8726724", "8729840"]
S = requests.Session()


def meta(sid):
    d = (_get(S, f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json", "meta") or {}).get("stations") or [{}]
    return {"id": sid, "name": d[0].get("name", sid), "lat": float(d[0]["lat"]), "lng": float(d[0]["lng"])}


def hourly(sid, product, b, e, interval="h"):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=rawsurf_tide_gate&station={sid}&datum=MSL"
         f"&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}")
    if interval:
        q += f"&interval={interval}"
    d = _get(S, q, f"{sid} {product}") or {}
    rows = d.get("predictions") or d.get("data") or []
    out = {}
    for r in rows:
        try:
            out[datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)] = (float(r["v"]), r.get("type"))
        except (KeyError, ValueError):
            continue
    return out


def g2(st_meta, doc, today):
    async def fetch(key):
        return {"stations": {st_meta["id"]: st_meta}} if key == H.INDEX_KEY else doc
    H._reset_for_tests(fetch)
    served = asyncio.run(T.fetch_tide_hourly(st_meta["lat"], st_meta["lng"]))
    H._reset_for_tests()
    if not served or served.get("source") != H.SOURCE:
        return {"ok": False, "why": "door did not serve harmonic"}
    ref = hourly(st_meta["id"], "predictions", today - timedelta(days=1), today + timedelta(days=15))
    lv_err = max(abs(v - ref[t][0]) for t, v in zip((H._parse(x) for x in served["time"]), served["level"]) if t in ref)
    hl = hourly(st_meta["id"], "predictions", today - timedelta(days=1), today + timedelta(days=15), "hilo")
    ev = {(e["type"], e["time"]) for e in served["events"]}
    ref_ev = {("High" if ty == "H" else "Low", t) for t, (_, ty) in hl.items()}
    t_err = max((min(abs((a[1] - b[1]).total_seconds()) for b in ref_ev if b[0] == a[0]) / 60 for a in ev), default=None)
    return {"ok": lv_err <= 0.01 and t_err is not None and t_err <= 6, "level_max_err_m": round(lv_err, 4),
            "event_max_err_min": t_err, "events": len(ev), "hours": len(served["time"]), "model_offset_m": doc.get("model_offset_m")}


def g10(st_meta, today):
    w0, w1 = today - timedelta(days=7), today
    pred = {t: v for t, (v, _) in hourly(st_meta["id"], "predictions", today - timedelta(days=21), today).items()}
    # preliminary 6-min observations (verified hourly heights lag by weeks); keep the on-the-hour readings
    obs = {t: v for t, (v, _) in hourly(st_meta["id"], "water_level", w0, w1, None).items() if t.minute == 0}
    om = _get(S, f"{OPEN_METEO}?latitude={round(st_meta['lat'], 1)}&longitude={round(st_meta['lng'], 1)}"
                 "&hourly=sea_level_height_msl&past_days=21&forecast_days=1&timezone=GMT", "model") or {}
    h = om.get("hourly") or {}
    raw = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", []))
           if v is not None}
    pre = [raw[t] - pred[t] for t in raw if t in pred and t < w0]
    if len(pre) < 24 * 7 or len(obs) < 24 * 4:
        return None
    off = st.median(pre)
    times = sorted(t for t in raw if t in pred)
    resid = H.lowpass_residual(times, raw, pred, off)
    served_model = {}
    for t in raw:                                     # the model as served: minus the mean of its 72 h window
        d0 = t.replace(hour=0)
        win = [raw[u] for u in raw if d0 <= u < d0 + timedelta(hours=72)]
        if len(win) >= 48:
            served_model[t] = raw[t] - sum(win) / len(win)
    ts = [t for t in obs if t in pred and t in resid and t in served_model and w0 <= t < w1]
    if len(ts) < 24 * 4:
        return None
    r = lambda f: math.sqrt(sum((f(t) - obs[t]) ** 2 for t in ts) / len(ts))   # noqa: E731
    return {"hours": len(ts), "rmse_harmonic": round(r(lambda t: pred[t]), 3), "rmse_model": round(r(lambda t: served_model[t]), 3),
            "rmse_tide_plus_surge": round(r(lambda t: pred[t] + resid[t]), 3), "offset_m": round(off, 3)}


def main():
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = []
    for sid in IDS:
        m = meta(sid)
        doc = station_doc(S, m, today)
        row = {"id": sid, "name": m["name"], "g2": g2(m, doc, today) if doc else {"ok": False, "why": "no doc"},
               "g10": g10(m, today)}
        rows.append(row)
        print(sid, m["name"], row["g2"].get("ok"), row["g10"], file=sys.stderr)
    g10s = [r["g10"] for r in rows if r["g10"]]
    summ = {"g2_pass": sum(bool(r["g2"].get("ok")) for r in rows), "g2_n": len(rows), "g10_n": len(g10s)}
    if g10s:
        for k in ("rmse_harmonic", "rmse_model", "rmse_tide_plus_surge"):
            summ[f"median_{k}"] = round(st.median(x[k] for x in g10s), 3)
        summ["b_beats_both"] = sum(x["rmse_tide_plus_surge"] < min(x["rmse_harmonic"], x["rmse_model"]) for x in g10s)
    print(json.dumps({"summary": summ, "rows": rows}, indent=1, default=str))


if __name__ == "__main__":
    main()
