"""Pass 5b: like-for-like swell-direction persistence test (resolves the total-vs-partition conflict).

Truth, NDBC realtime2 (45-day window, UTC hours, nearest record within 30 min):
  .spec: SwH (col 6, m) and SwD (col 11, 16-point compass -> degrees): the swell partition. Header is checked.
  .txt : WVHT (col 8) and MWD (col 11): the total wave field, as in passes 1-3.
Model: Open-Meteo marine, ncep_gfswave025, analysis best estimate: swell_wave_direction / swell_wave_height and
  wave_direction / wave_height. No *_previous_day1 fields here (lead-24 coverage is absent for this window).
Energy filters as in passes 1-4: buoy height >= 0.5 m and model height >= 0.3 m.
  SWELL set: buoy SwH >= 0.5 and model swell height >= 0.3 (swell direction errors)
  TOTAL set: buoy WVHT >= 0.5 and model wave height >= 0.3 (total direction errors)
Persistence: the buoy's own direction 24 h earlier at the same station, same height filter on that earlier hour.
Like-for-like set I: hours in both sets where both persistence values exist.
Gain = persistence MAE minus model MAE (positive means the model beats persistence).
Day-block bootstrap (1000 reps, UTC date). Writes d5_summary.json.
"""
import json, os, random, sys, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, wrap, mean, http_get, ndbc_hourly

ROSE = {"N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
        "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5}
REPS = 1000
EMIN = float(os.environ.get("EMIN", "0.5"))


def spec_swell_hourly(stn):
    """{utc hour: (SwD deg, SwH m)} from the realtime2 .spec file. Raises if the column layout differs."""
    lines = http_get(f"https://www.ndbc.noaa.gov/data/realtime2/{stn}.spec").splitlines()
    header = next(l for l in lines if l.startswith("#") and "SwD" in l).lstrip("#").split()
    iswh, iswd = header.index("SwH"), header.index("SwD")  # column positions from the names row (SwD is col 10 here)
    out = {}
    for line in lines:
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 15:
            continue
        try:
            t = dt.datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        swh, swd = p[iswh], p[iswd]
        if swh == "MM" or swd not in ROSE:
            continue
        hour = t.replace(minute=0, second=0, microsecond=0)
        if (t - hour).total_seconds() > 1800:
            hour = hour + dt.timedelta(hours=1)
        out.setdefault(hour, (ROSE[swd], float(swh)))
    return out


def om_hourly(lat, lon):
    url = ("https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s"
           "&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction"
           "&start_date=2026-10-01&end_date=2026-11-15&models=ncep_gfswave025&timezone=GMT") % (lat, lon)
    h = json.loads(http_get(url))["hourly"]
    out = {}
    for i, ts in enumerate(h["time"]):
        t = dt.datetime.fromisoformat(ts).replace(tzinfo=dt.timezone.utc)
        out[t] = (h["wave_direction"][i], h["wave_height"][i], h["swell_wave_direction"][i], h["swell_wave_height"][i])
    return out


def build_rows():
    rows, status = [], {}
    for stn, (name, lat, lon, region) in STATIONS.items():
        try:
            sw = spec_swell_hourly(stn)
            tot = ndbc_hourly(stn)
            mo = om_hourly(lat, lon)
        except Exception as e:
            status[stn] = "error: " + str(e)[:120]
            continue
        n_sw = n_tot = 0
        for t in sorted(set(sw) | set(tot)):
            m = mo.get(t)
            if m is None:
                continue
            tdir, th, sdir, sh = m
            s_obs, o_obs = sw.get(t), tot.get(t)
            swell_ok = bool(s_obs) and s_obs[1] >= EMIN and sh is not None and sh >= 0.3 and sdir is not None
            total_ok = bool(o_obs) and o_obs[1] >= EMIN and th is not None and th >= 0.3 and tdir is not None
            if not (swell_ok or total_ok):
                continue
            t0 = t - dt.timedelta(hours=24)
            ps, po = sw.get(t0), tot.get(t0)
            rows.append({
                "stn": stn, "region": region, "day": t.date().isoformat(),
                "e_swell": wrap(sdir - s_obs[0]) if swell_ok else None,
                "p_swell": wrap(ps[0] - s_obs[0]) if (swell_ok and ps and ps[1] >= EMIN) else None,
                "e_total": wrap(tdir - o_obs[0]) if total_ok else None,
                "p_total": wrap(po[0] - o_obs[0]) if (total_ok and po and po[1] >= EMIN) else None,
            })
            n_sw += int(swell_ok)
            n_tot += int(total_ok)
        status[stn] = f"swell_hours={n_sw} total_hours={n_tot}"
    return rows, status


def mabs(sub, key):
    return mean([abs(r[key]) for r in sub]) if sub else None


def day_block_ci(sub, mk, pk, seed=17):
    per = {}
    for r in sub:
        s = per.setdefault(r["day"], [0.0, 0])
        s[0] += abs(r[pk]) - abs(r[mk])
        s[1] += 1
    keys = list(per)
    S = [per[k][0] for k in keys]
    N = [per[k][1] for k in keys]
    rng, k, out = random.Random(seed), len(keys), []
    for _ in range(REPS):
        idx = [rng.randrange(k) for _ in range(k)]
        n = sum(N[i] for i in idx)
        out.append(sum(S[i] for i in idx) / n if n else 0.0)
    out.sort()
    return [round(out[int(0.025 * REPS)], 2), round(out[int(0.975 * REPS)], 2)]


def compare(rows, mk, pk):
    sub = [r for r in rows if r[mk] is not None and r[pk] is not None]
    if not sub:
        return {"n": 0}
    model, pers = mabs(sub, mk), mabs(sub, pk)
    return {"n": len(sub), "model_mae_deg": round(model, 2), "persistence24_mae_deg": round(pers, 2),
            "gain_deg": round(pers - model, 2), "gain_ci95_day_block_deg": day_block_ci(sub, mk, pk)}


def main():
    rows, status = build_rows()
    both = [r for r in rows if r["e_swell"] is not None and r["p_swell"] is not None
            and r["e_total"] is not None and r["p_total"] is not None]
    regions = sorted(set(r["region"] for r in rows))
    summary = {
        "window_utc": "2026-10-01 .. 2026-11-15 (realtime2 archive)",
        "station_status": status,
        "rows_any_set": len(rows),
        "swell_set": compare(rows, "e_swell", "p_swell"),
        "total_set": compare(rows, "e_total", "p_total"),
        "like_for_like_intersection": {
            "n": len(both),
            "swell": compare(both, "e_swell", "p_swell"),
            "total": compare(both, "e_total", "p_total"),
            "swell_model_mae_deg": round(mabs(both, "e_swell"), 2) if both else None,
            "total_model_mae_deg": round(mabs(both, "e_total"), 2) if both else None,
            "swell_persistence_mae_deg": round(mabs(both, "p_swell"), 2) if both else None,
            "total_persistence_mae_deg": round(mabs(both, "p_total"), 2) if both else None,
        },
        "swell_by_region": {g: compare([r for r in rows if r["region"] == g], "e_swell", "p_swell") for g in regions},
        "total_by_region": {g: compare([r for r in rows if r["region"] == g], "e_total", "p_total") for g in regions},
    }
    out = os.path.join(HERE, "d5_summary_emin" + str(EMIN) + ".json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=1)
    print("wrote", out, "rows", len(rows), "intersection", len(both))


if __name__ == "__main__":
    main()
