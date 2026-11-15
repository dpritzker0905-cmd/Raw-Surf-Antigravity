"""tide_datum_heldout.py - the PRE-REGISTERED held-out test of a long-term model mean as the tide datum.

Registration (lines written before the run): docs/weather-program/log/2026-11-15-claude-tide-local-datum.md, section
"PRE-REGISTERED (before the run): held-out test of the long-term model mean as the datum".
26 CO-OPS stations x 4 held-out weeks, scored against OBSERVED water level (MSL, on the hour). Arms: raw, demean72,
clim1y (minus the model's mean over the 365 days before the week), climAll (minus its mean over 2022-12-01..the week),
yardstick (minus median(model - observed) over the 14 days before the week). Public read-only GETs.
Run: python scripts/tide_datum_heldout.py > heldout.json
"""
import json
import math
import statistics as st
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670", "8723214",
       "8726724", "8729840", "9755371", "9751639", "9455920", "8410140"]
WEST = {"9410230", "9410660", "9413450", "9415020", "9419750", "9435380", "9443090"}
WEEKS = [datetime(2025, 12, 15, tzinfo=timezone.utc), datetime(2026, 3, 15, tzinfo=timezone.utc),
         datetime(2026, 6, 15, tzinfo=timezone.utc), datetime(2026, 9, 15, tzinfo=timezone.utc)]
ARCHIVE0 = datetime(2022, 12, 1, tzinfo=timezone.utc)
COOPS = "https://api.tidesandcurrents.noaa.gov"
OM = "https://marine-api.open-meteo.com/v1/marine"


def get(url):
    for _ in range(3):
        out = subprocess.run(["curl", "-s", "--max-time", "180", url], capture_output=True, text=True).stdout
        try:
            return json.loads(out)
        except Exception:
            time.sleep(3)
    return {}


def coops(sid, product, b, e, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=rawsurf_tide_check&station={sid}&datum=MSL"
         f"&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}")
    if interval:
        q += f"&interval={interval}"
    out = {}
    d = get(q)
    for r in d.get("data") or d.get("predictions") or []:
        try:
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            if t.minute == 0 and r.get("v") not in (None, ""):
                out[t] = float(r["v"])
        except (KeyError, ValueError):
            pass
    return out


def model(la, lo, b, e):
    h = get(f"{OM}?latitude={la}&longitude={lo}&hourly=sea_level_height_msl&start_date={b:%Y-%m-%d}"
            f"&end_date={e:%Y-%m-%d}&timezone=GMT").get("hourly") or {}
    return {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
            for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}


def lowpass(d, keys):
    out = {}
    for t in keys:
        w = [d[u] for u in keys if abs((u - t).total_seconds()) <= 12 * 3600 and u in d]
        if len(w) >= 13:
            out[t] = sum(w) / len(w)
    return out


def rmse(e):
    return math.sqrt(sum(x * x for x in e) / len(e)) if e else None


rows = []
for sid in IDS:
    meta = (get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    if meta.get("lat") is None:
        continue
    la, lo, name = round(float(meta["lat"]), 1), round(float(meta["lng"]), 1), meta.get("name", sid)
    allm = model(la, lo, ARCHIVE0, WEEKS[-1] + timedelta(days=11))
    if len(allm) < 24 * 365:
        rows.append({"id": sid, "name": name, "error": f"archive {len(allm)} h"}); continue
    for w0 in WEEKS:
        w1 = w0 + timedelta(days=7)
        obs = {}
        for b in (w0 - timedelta(days=14), w0):
            obs.update(coops(sid, "water_level", b, b + timedelta(days=14 if b < w0 else 7)))
        pred = coops(sid, "predictions", w0 - timedelta(days=2), w1 + timedelta(days=2), "h")
        scored = sorted(t for t in obs if w0 <= t < w1 and t in allm)
        prior = [allm[t] - obs[t] for t in obs if w0 - timedelta(days=14) <= t < w0 and t in allm]
        y1 = [v for t, v in allm.items() if w0 - timedelta(days=365) <= t < w0]
        ya = [v for t, v in allm.items() if t < w0]
        if len(scored) < 96 or len(prior) < 24 * 7 or len(y1) < 24 * 300:
            rows.append({"id": sid, "name": name, "week": w0.date().isoformat(), "error": f"scored {len(scored)}, prior {len(prior)}, y1 {len(y1)}"})
            continue
        m1, ma, off = sum(y1) / len(y1), sum(ya) / len(ya), st.median(prior)
        arms = {"raw": lambda t: allm[t], "clim1y": lambda t: allm[t] - m1, "climAll": lambda t: allm[t] - ma,
                "yardstick": lambda t: allm[t] - off}

        def d72(t):
            d0 = t.replace(hour=0)
            win = [allm[u] for u in allm if d0 <= u < d0 + timedelta(hours=72)]
            return allm[t] - sum(win) / len(win)
        arms["demean72"] = d72
        row = {"id": sid, "name": name, "week": w0.date().isoformat(), "west": sid in WEST, "hours": len(scored),
               "clim1y_m": round(m1, 3), "climAll_m": round(ma, 3), "yardstick_m": round(off, 3)}
        for k, f in arms.items():
            row[f"rmse_{k}"] = round(rmse([f(t) - obs[t] for t in scored]), 3)
        keys = sorted(t for t in scored if t in pred)
        lo_obs = lowpass({t: obs[t] - pred[t] for t in keys}, keys)
        lo_mod = lowpass({t: allm[t] - pred[t] for t in keys}, keys)
        both = [t for t in keys if t in lo_obs and t in lo_mod]
        if both:
            row["obs_nontidal_max_m"] = round(max(abs(lo_obs[t] - st.mean(lo_obs[u] for u in both)) for t in both), 3)
            a, b = [lo_mod[t] for t in both], [lo_obs[t] for t in both]
            mx, my = st.mean(a), st.mean(b)
            den = math.sqrt(sum((x - mx) ** 2 for x in a) * sum((y - my) ** 2 for y in b))
            row["surge_r"] = round(sum((x - mx) * (y - my) for x, y in zip(a, b)) / den, 3) if den else None
            big = [t for t in both if abs(lo_obs[t] - st.mean(lo_obs[u] for u in both)) > 0.15]
            row["p2b_hours"] = len(big)
            if big:
                for k in ("demean72", "climAll", "clim1y", "yardstick"):
                    row[f"p2b_rmse_{k}"] = round(rmse([arms[k](t) - obs[t] for t in big]), 3)
        rows.append(row)
        print(sid, name, w0.date(), {k: v for k, v in row.items() if k.startswith("rmse_")}, file=sys.stderr)

ok = [r for r in rows if "error" not in r]
med = lambda k, rs=ok: round(st.median(r[k] for r in rs), 3)   # noqa: E731
summ = {"station_weeks": len(ok), "errors": [(r["id"], r.get("week"), r["error"]) for r in rows if "error" in r]}
for k in ("raw", "demean72", "clim1y", "climAll", "yardstick"):
    summ[f"median_rmse_{k}"] = med(f"rmse_{k}")
verdict = {}
for c in ("clim1y", "climAll"):
    h1 = summ[f"median_rmse_{c}"] < summ["median_rmse_raw"] and summ[f"median_rmse_{c}"] < summ["median_rmse_demean72"]
    west = {}
    for sid in WEST:
        rs = [r for r in ok if r["id"] == sid]
        if rs:
            west[sid] = round(st.median(r[f"rmse_{c}"] for r in rs) - st.median(r["rmse_raw"] for r in rs), 3)
    h2 = all(v <= 0.05 for v in west.values()) and bool(west)
    h3 = summ[f"median_rmse_{c}"] - summ["median_rmse_yardstick"] <= 0.10
    verdict[c] = {"H1": h1, "H2": h2, "H2_west_minus_raw": west, "H3": h3, "PASS": h1 and h2 and h3}
summ["verdict"] = verdict
summ["ships"] = "climAll" if verdict["climAll"]["PASS"] else ("clim1y" if verdict["clim1y"]["PASS"] else "none (stay OFF)")
test = [r for r in ok if r.get("obs_nontidal_max_m", 0) >= 0.10 and r.get("surge_r") is not None]
summ["P2_testable_station_weeks"] = len(test)
summ["P2_median_r"] = round(st.median(r["surge_r"] for r in test), 3) if len(test) >= 5 else "not answered"
p2b = [r for r in ok if r.get("p2b_hours")]
if p2b:
    summ["P2b"] = {k: med(f"p2b_rmse_{k}", p2b) for k in ("demean72", "climAll", "clim1y", "yardstick")}
    summ["P2b"]["station_weeks"] = len(p2b)
print(json.dumps({"summary": summ, "rows": rows}, indent=1))
