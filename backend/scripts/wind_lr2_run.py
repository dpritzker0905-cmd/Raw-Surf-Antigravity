"""wind_lr2_run.py - command line glue for the long-range wind v2 registration. Serves nothing.

  pair   --cache C --spots spots.json          marine-exposed flag + paired spot + shore normal per station (ETOPO; network)
  fit    --cache C                             fit the calibrated arms on the FIT run files, write coefficient files
  freeze --cache C --out manifest.json         sha256 of every coefficient set and frozen file (commit BEFORE the first TEST init)
  score  --cache C --out report.json           the ONE scored look (refuses on a freeze mismatch)

Nothing here runs without the owner's typed word in the session that dispatches it (registration section 0). The loaders
below are thin; every decision lives in the unit-tested modules wind_lr2_{fit,rows,stats,score}.
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wind_lr2_clim as C  # noqa: E402
import wind_lr2_descr as D  # noqa: E402
import wind_lr2_fit as F  # noqa: E402
import wind_lr2_gust as GU  # noqa: E402
import wind_lr2_rows as W  # noqa: E402
import wind_lr2_runs as R  # noqa: E402
import wind_lr2_score as SC  # noqa: E402
import wind_lr2_void as VD  # noqa: E402
import wind_lr2_truth as T  # noqa: E402

UTC = timezone.utc
CAL_ARMS = list(W.CAL_SETS)


def load_runs(dir_):
    out = {}
    for p in sorted(glob.glob(os.path.join(dir_, "??????????.npz"))):
        stamp = os.path.basename(p)[:10]
        z = np.load(p)
        out[datetime.strptime(stamp, "%Y%m%d%H").replace(tzinfo=UTC)] = {k: z[k] for k in z.files}
    return out


def load_clim(cache):
    z = np.load(os.path.join(cache, "wind_lr2_clim_stations.npz"))
    fields = {k: z[k] for k in ("u", "v", "s")}
    bad = C.check_fields(fields)
    if bad:
        raise SystemExit(f"climatology field rejected: {bad}")
    return lambda valid: C.clim_vector(fields, valid)


def load_stations(cache):
    doc = json.load(open(os.path.join(cache, "wind_lr2_stations.json")))
    return doc["ndbc"] + doc["asos"]


def truth_fn_for(kind, cache, stations, window):
    """FIT: NDBC historical stdmet + IEM ASOS. TEST: weekly realtime2 snapshots (+ monthly stdmet where published) + IEM."""
    import requests
    import wind_lr_obs as obs
    s = requests.Session()
    truth, height = {}, {}
    for i, st in enumerate(stations):
        if st["kind"] == "ndbc":
            height[i] = st.get("anemometer_m")
            if kind == "fit":
                truth[i], _src = T.fit_truth(s, cache, st["id"], window[0], window[1])
            else:
                truth[i], _src = T.truth_for_test(os.path.join(cache, "snapshots"), st["id"])
        else:
            height[i] = None
            truth[i] = obs.asos_range(s, cache, st["id"], window[0], window[1])
    return W.station_truth_fn(truth, height, obs.to_10m, obs.wind_at), truth


def cmd_fit(a):
    stations = load_stations(a.cache)
    runs = load_runs(os.path.join(a.cache, "runs_fit"))
    if len(runs) < 60:
        raise SystemExit(f"FIT floor: {len(runs)} kept FIT runs < 60")
    fn, _ = truth_fn_for("fit", a.cache, stations, (R.FIT_START, R.FIT_END + timedelta(days=15)))
    clim_at = load_clim(a.cache)
    for arm, systems in W.CAL_SETS.items():
        rows = W.fit_rows(runs, stations, systems, clim_at, fn)
        coefs = F.fit_all(rows, arm)
        json.dump(coefs, open(os.path.join(a.cache, f"wind_lr2_coef_{arm}.json"), "w"), sort_keys=True, indent=1)
        json.dump(D.descriptive_report(rows), open(os.path.join(a.cache, f"wind_lr2_descr_{arm}.json"), "w"), indent=1, default=float)
        print(arm, "rows", len(rows["s"]))
    json.dump(D.spread_skill(runs, stations, fn), open(os.path.join(a.cache, "wind_lr2_descr_spread_skill.json"), "w"), indent=1,
              default=float)
    return 0


def freeze_files(cache):
    return {"clim": os.path.join(cache, "wind_lr2_clim_stations.npz"), "stations": os.path.join(cache, "wind_lr2_stations.json"),
            "pairing": os.path.join(cache, "wind_lr2_pairing.json"),
            # amendment G1: the CLIM_GUST table is a hashed freeze artifact; the committed hash file is what is pinned here and
            # what the verified loader checks the table against at score time
            "clim_gust_sha256": os.path.join(cache, "wind_lr2_clim_gust.json.sha256")}


def load_coefs(cache):
    return {arm: json.load(open(os.path.join(cache, f"wind_lr2_coef_{arm}.json"))) for arm in CAL_ARMS}


def cmd_freeze(a):
    man = F.freeze_manifest(load_coefs(a.cache), freeze_files(a.cache))
    json.dump(man, open(a.out, "w"), sort_keys=True, indent=1)
    print("freeze manifest written; commit it BEFORE the first TEST init")
    return 0


def gust_table_paths(a):
    return (a.clim_gust_table or os.path.join(a.cache, "clim_gust", "wind_lr2_clim_gust.json"),
            freeze_files(a.cache)["clim_gust_sha256"])


def load_gust_table(a):
    """The CLIM_GUST table, verified against the committed hash. Absence or any mismatch REFUSES the whole score: there is no
    fallback and no wind-only scoring when the gust inputs are not what was frozen."""
    table, hash_path = gust_table_paths(a)
    try:
        return GU.load_clim_gust(table, hash_path)
    except GU.ClimGustRefused as e:
        raise SystemExit(f"REFUSED: CLIM_GUST table: {e}")


def write_score_report(doc, out, eligibility_rows, eligibility):
    """The only writer of the score report. VOID by construction (the eligibility count): descriptive only, stamped in every section,
    VOID in every file name, no decision or ship field, and the plain `out` path is NOT written. Otherwise the registered report."""
    doc["eligibility"] = eligibility
    doc["eligibility_table"] = {"rows": eligibility_rows}
    if eligibility["void"]:
        paths = VD.write_outputs(doc, out, eligibility_rows)
        print(VD.STATUS, eligibility["trigger"], paths)
        return paths
    json.dump(doc, open(out, "w"), indent=1, default=float)
    print(doc["verdict"], doc["void_reasons"])
    return [out]


def cmd_score(a):
    man = json.load(open(a.manifest))
    coefs = load_coefs(a.cache)
    mism = F.verify_freeze(man, coefs, freeze_files(a.cache))
    if mism:
        raise SystemExit(f"REFUSED: freeze mismatch {mism}")           # a scorer that finds a hash mismatch refuses to run
    clim_gust = load_gust_table(a)                                      # BEFORE any station, run or truth is read
    stations = load_stations(a.cache)
    pairing = json.load(open(freeze_files(a.cache)["pairing"]))
    # ORDER OF OPERATIONS (fixed before TEST): 1. the ELIGIBILITY COUNT from the frozen list and the pairing alone; 2. VOID by
    # construction if fewer than 3 gated regions have >= 10 marine-exposed stations; 3. only THEN truth, holdout and coverage.
    eligibility_rows = VD.count_table(stations, pairing)
    eligibility = VD.eligibility(eligibility_rows)
    runs = load_runs(os.path.join(a.cache, "runs_test"))
    inits = R.test_window_runs(datetime.fromisoformat(a.freeze_time) if a.freeze_time else None)
    fn, truth = truth_fn_for("test", a.cache, stations, (min(inits), R.snapshot_end(inits)))
    rows = W.build_rows(runs, stations, pairing, load_clim(a.cache), coefs, fn)
    by_region = {}
    for i, st in enumerate(stations):
        pr = pairing.get(str(st["id"]), {})
        if pr.get("marine") and T.station_ok(truth.get(i, {}), min(inits), R.last_valid(inits)):
            r = R.region_of(st["lat"], st["lon"])
            by_region[r] = by_region.get(r, 0) + 1
    cov = {str(st["id"]): T.coverage_report(truth.get(i, {}), min(inits), R.last_valid(inits)) for i, st in enumerate(stations)}
    fit_inits = R.fit_runs()
    doc = SC.score_rows(rows, W.native_changes(runs, len(stations)), len(runs), by_region, [],
                        SC.fit_test_disjoint(fit_inits, inits))
    doc["station_coverage"] = cov            # reported per station; used for floor counts only, never a row filter
    # amendment G1, serial: the gust family is evaluated AFTER wind, reads the wind result and never writes to it
    doc["gust"] = GU.score_gust(rows, doc, stations, pairing, cov, clim_gust)
    write_score_report(doc, a.out, eligibility_rows, eligibility)
    return 0


def cmd_pair(a):
    from wind_lr2_geo import mask_for, pair_list, fetch_window
    stations = load_stations(a.cache)
    spots = json.load(open(a.spots))
    pts = [(s["lat"], s["lon"]) for s in stations]
    mask = mask_for(pts, fetch=lambda la, lo: fetch_window(la, lo, half=0.3))
    table = pair_list(stations, spots, mask)
    json.dump(table, open(freeze_files(a.cache)["pairing"], "w"), sort_keys=True, indent=1)
    print(len(table), "stations;", sum(1 for v in table.values() if v["marine"]), "marine-exposed")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["pair", "fit", "freeze", "score"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--spots")
    ap.add_argument("--out")
    ap.add_argument("--manifest")
    ap.add_argument("--freeze-time", default=None)
    ap.add_argument("--clim-gust-table", default=None, help="score: the verified CLIM_GUST table (default <cache>/clim_gust/...)")
    a = ap.parse_args(argv)
    return {"pair": cmd_pair, "fit": cmd_fit, "freeze": cmd_freeze, "score": cmd_score}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
