"""The tide-a-harcon-v1 INSTRUMENT (gates/tide-a-harcon-v1.md s2-s6): A_HARCON vs A_FES at the frozen fresh stations,
leave-one-out, against NOAA CO-OPS High/Low predictions. CI only: PyFES is GPL; pyTMD synthesises the harmonic constants.

At each candidate station (both strata: the 20 deciding, then the first 5 reserves, the gate's replacement cap):
  fes      A_FES = FES2022b + long-period equilibrium (arms.fes_eval) at the station's CO-OPS coordinates.
  donors   EVERY other type-R station of the vendored snapshot within d < 25 km, nearest first (ties: smaller id), up to
           and including the first one that is not itself a candidate: the scorer picks the first donor outside the
           FINAL scored set, which is always in that prefix (s2, s4 leave-one-out with re-selection after replacement).
           For each: its published constants (CO-OPS harcon.json), w(d) (s2.3), and the blend arm.
  truth    NOAA High/Low predictions, datum=MSL, and NOAA's hourly predictions (the centring mean).
Metric (s4): TIDAL BAND as #1171 (NOAA's own SA/SSA removed from NOAA; FES's Sa/Ssa left out of fes; the donor's SA/SSA
removed from its synthesis); each side centred on its own window mean (ours: the hourly arm; NOAA: its hourly curve).
The RAW band (seasonal included) is reported too. Events: the SERVED finder (tide.tide_extrema). Matching:
match_events (vendored verbatim, a_harcon_vendor).
Controls written for the scorer: C2 own-constants identity at every candidate station and every donor in the prefix;
C3 blend identities (w = 0 gives fes exactly, w = 1 gives the donor exactly). C1 (the finder) is vendored
finder_check.py --stations, run beside this. C4 is the scorer's audit of the donor ids written here.

Reads: CO-OPS predictions and harcon (GET), the vendored snapshot and the frozen station JSON. No bucket, no backend.
CI (repo root):  python backend/scripts/tide_datum/a_harcon_parity.py --fes-cache fes_cache --start 2027-02-01
"""
import argparse
import json
import os
import statistics as st
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent.parent
REPO = BACKEND.parent
for sub in ("tide_own", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(BACKEND))
import a_harcon_vendor as V                                       # noqa: E402  (verbatim from 1d92f7564)
import a_harcon_v2 as V2                                          # noqa: E402  (gate v2: 6-min C2, plants)
from a_harcon_frozen import _km                                   # noqa: E402  (verbatim from c29f234df)
from services.weather_pipeline import tide as T                   # noqa: E402  (the served event finder)

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATIONS = REPO / "docs" / "weather-program" / "research" / "tide-a-harcon-v1-stations.json"
R_IN_KM, R_OUT_KM, RESERVE_SCORED = 10.0, 25.0, 5


def weight(d_km):
    """PURE, s2.3: w = 1 within 10 km, (25 - d) / 15 between, 0 at or beyond 25 km (or no donor)."""
    if d_km is None or d_km >= R_OUT_KM:
        return 0.0
    return 1.0 if d_km <= R_IN_KM else (R_OUT_KM - d_km) / (R_OUT_KM - R_IN_KM)


def blend(w, donor, fes):
    """PURE, s2.3: A_HARCON = w * A_donor + (1 - w) * A_FES, element-wise (the arm and C3 share this one function)."""
    return [w * a + (1.0 - w) * b for a, b in zip(donor, fes)]


def candidates(stations_doc, reserve=RESERVE_SCORED):
    """PURE: [(id, stratum)]: each stratum's deciding stations, then its first `reserve` reserves (the gate's cap)."""
    out = []
    for k, s in stations_doc["strata"].items():
        out += [(i, k) for i in s["deciding"]] + [(i, k) for i in s["reserve"][:reserve]]
    return out


def donor_prefix(sid, lat, lng, universe, cand_ids):
    """PURE, s2.1 + s4: every other universe station with d < 25 km, nearest first (ties: smaller id), up to and
    including the first that is not a candidate. The scorer's donor is the first of these outside the final set."""
    ranked = sorted((round(_km(lat, lng, o["lat"], o["lng"]), 6), o["id"]) for o in universe if o["id"] != sid)
    out = []
    for d, oid in ranked:
        if d >= R_OUT_KM:
            break
        out.append({"id": oid, "km": round(d, 3), "w": round(weight(d), 6)})
        if oid not in cand_ids:
            break
    return out


def centred(vals, times, day0, stop):
    """PURE: the series minus its own mean over [day0, stop) (s4: each side centred on its own window mean)."""
    inside = [v for v, t in zip(vals, times) if day0 <= t < stop and v is not None]
    m = st.fmean(inside) if inside else 0.0
    return [None if v is None else float(v) - m for v in vals], m


def events_rows(truth, truth_mean, hours, series, day0, stop):
    """Centred NOAA events vs the served finder's events on our centred hourly series (match_events rows)."""
    ours, _ = centred(series, hours, day0, stop)
    iso = [h.strftime("%Y-%m-%dT%H:00") for h in hours]
    return V.match_events([(t, k, round(v - truth_mean, 4)) for t, k, v in truth], T.tide_extrema(iso, ours))


def coops_get(params):
    q = (COOPS + "?" + "&".join(f"{k}={v}" for k, v in params.items())).replace(" ", "%20")
    with urllib.request.urlopen(urllib.request.Request(q, headers={"User-Agent": "raw-surf-tide-a-harcon/1"}),
                                timeout=60) as r:
        return json.loads(r.read().decode("utf-8")).get("predictions", [])


def noaa_msl(sid, begin, end, interval):
    """CO-OPS predictions, datum=MSL, metric, GMT: hilo -> [(aware time, type, m)]; h -> [(aware time, m)]."""
    rows = coops_get({"product": "predictions", "application": "raw_surf_tide_a_harcon", "station": sid,
                      "begin_date": f"{begin:%Y%m%d %H:%M}", "end_date": f"{end:%Y%m%d %H:%M}", "datum": "MSL",
                      "units": "metric", "time_zone": "gmt", "interval": interval, "format": "json"})
    t = [datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc) for r in rows]
    if interval == "hilo":
        return [(a, "High" if r["type"] == "H" else "Low", float(r["v"])) for a, r in zip(t, rows)
                if r.get("type") in ("H", "L") and r.get("v") not in (None, "")]
    return [(a, float(r["v"])) for a, r in zip(t, rows) if r.get("v") not in (None, "")]


def truth_at(sid, day0, stop, hc, lp_fn):
    """NOAA's events in [day0, stop) and the centring means, raw and tidal band (its own SA/SSA removed)."""
    hilo = [e for e in noaa_msl(sid, day0, stop, "hilo") if day0 <= e[0] < stop]
    hourly = [e for e in noaa_msl(sid, day0, stop, "h") if day0 <= e[0] < stop]
    raw_mean = st.fmean(v for _, v in hourly) if hourly else None
    seas = [r for r in hc if r[1] in ("SA", "SSA")]
    hilo_tb = V.remove_seasonal(hilo, lp_fn(seas, [e[0] for e in hilo])) if seas else hilo
    lp_h = lp_fn(seas, [t for t, _ in hourly]) if seas else [0.0] * len(hourly)
    tb_mean = st.fmean(v - s for (_, v), s in zip(hourly, lp_h)) if hourly else None
    return {"hilo": hilo, "hilo_tb": hilo_tb, "raw_mean": raw_mean, "tb_mean": tb_mean, "n_hourly": len(hourly)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="a_harcon_work")
    ap.add_argument("--start", required=True, help="the gate's fixed window start, YYYY-MM-DD (s4: 2027-02-01)")
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--stations", default=str(STATIONS))
    ap.add_argument("--json", default="tide_a_harcon_run.json")
    ap.add_argument("--c2-grid-min", type=int, default=60, help="v2: 6 = C2 on the 6-min grid (gate v2 s5); 60 = v1")
    ap.add_argument("--c5", action="store_true", help="v2: the planted breaks P1-P3 at each candidate (gate v2 s11)")
    a = ap.parse_args(argv)
    import arms                                                    # noqa: E402 - pyfes + pyTMD, CI only
    import own_rules as OR                                         # noqa: E402
    import sources as S                                            # noqa: E402
    import build_series as BS                                      # noqa: E402 (subset_wrapped)
    from fes_gate import FES_CONSTITUENTS                          # noqa: E402
    from metrics import noaa_long_period                           # noqa: E402
    import a_harcon_select as SEL                                  # noqa: E402 (the vendored universe)

    doc = json.loads(Path(a.stations).read_text(encoding="utf-8"))
    universe = SEL.universe()
    by_id = {s["id"]: s for s in universe}
    cand = candidates(doc)
    cand_ids = {i for i, _ in cand}
    pts = {sid: (by_id[sid]["lat"], by_id[sid]["lng"]) for sid, _ in cand}
    work = Path(a.work)
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in S.download_fes(FES_CONSTITUENTS, Path(a.fes_cache)).items():
        BS.subset_wrapped(path, name, pts, boxes, scratch)
    day0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    stop = day0 + timedelta(days=a.days)
    hours = [day0 - timedelta(hours=6) + timedelta(hours=i) for i in range(24 * a.days + 13)]
    npt = arms.to_np(hours)
    harcon_cache, truth_cache = {}, {}

    def harcon(sid):
        if sid not in harcon_cache:
            try:
                harcon_cache[sid] = S.coops_harcon(sid)
            except Exception:                                      # noqa: BLE001 - "no constants" is a replacement cause
                harcon_cache[sid] = []
        return harcon_cache[sid]

    def truth(sid):
        if sid not in truth_cache:
            truth_cache[sid] = truth_at(sid, day0, stop, harcon(sid), noaa_long_period)
        return truth_cache[sid]

    def synth6(consts, times):                                     # v2: the candidate's synthesis, verbatim, any grid
        return arms.harcon_eval(consts, arms.to_np(times))

    def identity(sid, la, lo):
        """C2: the station's OWN constants vs NOAA at that station (raw band, both sides centred). v2 (--c2-grid-min 6):
        the same synthesis on the 6-min grid (a_harcon_v2.c2_rows)."""
        hc = harcon(sid)
        if a.c2_grid_min != 60:
            if not hc:
                return {"error": "no constants"}
            tr = truth(sid)
            rows = V2.c2_rows(hc, tr["hilo"], tr["raw_mean"], day0, stop, synth6)
            return {"rows": rows, "grid_min": V2.GRID_MIN} if rows is not None else {"error": "no synthesis"}
        own = arms.harcon_eval(hc, npt) if hc else None
        if own is None:
            return {"error": "no constants"}
        tr = truth(sid)
        rows = events_rows(tr["hilo"], tr["raw_mean"], hours, [float(x) for x in own], day0, stop)
        return {"rows": rows}

    per = {}
    for sid, stratum in cand:
        la, lo = pts[sid]
        row = {"stratum": stratum, "name": by_id[sid]["name"], "lat": la, "lng": lo}
        d = boxes / OR.safe_dir(sid)
        fes = arms.fes_eval(d, la, lo, npt) if d.exists() else None
        fes_tb = arms.fes_eval(d, la, lo, npt, exclude=("Sa", "Ssa")) if d.exists() else None
        if fes is None or fes_tb is None:
            per[sid] = dict(row, fes_undefined=True)
            continue
        fes, fes_tb = [float(x) for x in fes], [float(x) for x in fes_tb]
        try:
            tr = truth(sid)
        except Exception as e:                                     # noqa: BLE001 - a CO-OPS failure is reported
            per[sid] = dict(row, error=f"CO-OPS {type(e).__name__}")
            continue
        row.update(noaa_events=len(tr["hilo"]), fes_tb=events_rows(tr["hilo_tb"], tr["tb_mean"], hours, fes_tb, day0, stop),
                   fes_raw=events_rows(tr["hilo"], tr["raw_mean"], hours, fes, day0, stop),
                   c2_station=identity(sid, la, lo), donors=[])
        if a.c5:                                                   # v2 C5 (s11, s12): each plant's C2 status, VOID-only
            hc0 = harcon(sid)
            row["c5"] = {}
            for n, (f, sh) in V2.C5_PLANTS.items():
                r5 = V2.c2_rows(hc0, tr["hilo"], tr["raw_mean"], day0, stop, synth6, f, sh) if hc0 else None
                row["c5"][n] = V2.c2_status(r5)[0] if r5 is not None else "untestable"
            row["c2_minors_diag"] = V2.minors_diagnostic(hc0, tr, day0, stop)
        for dn in donor_prefix(sid, la, lo, universe, cand_ids):
            hc = harcon(dn["id"])
            syn = arms.harcon_eval(hc, npt) if hc else None
            ent = dict(dn, has_constants=syn is not None)
            if syn is not None:
                don = [float(x) for x in syn]
                lp = noaa_long_period([r for r in hc if r[1] in ("SA", "SSA")], hours)
                don_tb = [x - s for x, s in zip(don, lp)]
                arm_tb, arm_raw = blend(dn["w"], don_tb, fes_tb), blend(dn["w"], don, fes)
                ent.update(harcon_tb=events_rows(tr["hilo_tb"], tr["tb_mean"], hours, arm_tb, day0, stop),
                           harcon_raw=events_rows(tr["hilo"], tr["raw_mean"], hours, arm_raw, day0, stop),
                           c3_w0_max_m=max(abs(x - y) for x, y in zip(blend(0.0, don_tb, fes_tb), fes_tb)),
                           c3_w1_max_m=max(abs(x - y) for x, y in zip(blend(1.0, don_tb, fes_tb), don_tb)),
                           c2_donor=identity(dn["id"], by_id[dn["id"]]["lat"], by_id[dn["id"]]["lng"]))
            row["donors"].append(ent)
        per[sid] = row
        print(sid, stratum, len(row["donors"]), "donor(s)", flush=True)
    out = {"schema": "raw-surf/tide-a-harcon-v1-run/1", "gate": "gates/tide-a-harcon-v1.md",
           "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "window_start": a.start,
           "days": a.days, "candidates": [[i, k] for i, k in cand], "per_station": per, "complete": True}
    with open(a.json + ".tmp", "w", encoding="utf-8", newline="\n") as fh:   # amendment 3: atomic, never a partial file
        json.dump(out, fh, indent=1, default=str)
    os.replace(a.json + ".tmp", a.json)


if __name__ == "__main__":
    main()
