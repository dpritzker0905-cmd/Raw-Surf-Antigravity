"""run_nearshore_validation.py — the WS-CAN-0076 nearshore outcome RUNNER (AV-09, Audit 4.0 lane).

One cycle of the loop nearshore_validation.py provides pure pieces for: committed pair table ->
live CDIP realtime observations (QC flag==1) -> the SERVING PATH's offshore point answer at each
linked spot -> model_hs_at_station -> match -> build_report -> one JSON on disk.

EXIT CONTRACT (int only — never SystemExit("string"), the L-2 defect):
    0  GRADED   — report available:true, on at least GRADED_MIN_STATION_HOURS distinct buoy readings
    1  REFUSED  — a verdict: available:false (too few matches, or under the station-hour floor); the
                  report is still written. The workflow fails the run on it (VA-03): a run that graded
                  nothing must not read green.
    2  INFRA    — nothing was graded: pair table unreadable/stale, ZERO CDIP stations answering,
                  or the point API unreachable for every spot. (2 matches model_skill_census's
                  VOID and the census workflow's `rc -ge 2` branch; forecast_accuracy_monitor's
                  REFUSED=3 is that lane's convention, not this one's.)

DISCRIMINATION RULES (measured 2026-08-16: 7 of 20 stations live, 13 return HTTP 404 by design):
    HTTP 404             = "no realtime deployment" — a per-station SKIP, never infra.
    5xx/URLError/timeout = infra-counted; only ZERO live stations makes the run infra.

Deliberately reads NO .env (the phantom-project trap — backend/.env points at the DEV Supabase
project and a wrong-project write SUCCEEDS silently); no Supabase at all in this slice. The
report is written to --json and uploaded by the workflow as an artifact.

COUNTING HONESTY (the buoy_calibration lesson — "the buoy is the unit"): several spots share one
station (254p1 and 143p1 carry 6 links each), and every linked spot matches the SAME instrument
reading, so n_matched counts SPOT-hours. The report carries n_spot_hours AND n_station_hours;
never let a sample-size gate read the inflated one.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.nearshore_validation import (   # noqa: E402
    CONSENSUS_MEMBERS, PAIR_MEMBERS, Refusal, backfill_valid_times, build_report, equal_consensus, fetch_mop_hs,
    fetch_station_hs, load_mop_archives, load_pairs,
    model_hs_from_nearshore_input,
    match, model_hs_at_station, model_hs_at_station_trains, mop_grid_hours, qc_filter, station_trains,
    transform_factors)
from services.weather_pipeline.nwps_nearshore import attach_nwps  # noqa: E402
from services.weather_pipeline.ndbc_nearshore import load_ndbc_pairs  # noqa: E402
from services.weather_pipeline.nearshore_validation import LEGACY_SHELF_CF_SCALE  # noqa: E402
from services.weather_pipeline.surf_transform import shelf_dissipation  # noqa: E402

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
UA = {"User-Agent": "raw-surf-nearshore-validation-runner"}
# THE GRADED FLOOR (VA-03, 2026-10-08): a grade needs 30 distinct buoy readings. Before it, one matched spot-hour
# graded. Measured on the 9 graded 24 h-backfill dispatches (2026-09-27..29): 24-98 station-hours, 8 of 9 at or
# above 30; the one single-hour run read 7, which is why a scheduled slot now grades a 24 h backfill.
GRADED_MIN_STATION_HOURS = 30


def _fetch_json(url: str, timeout: float = 60.0) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# The served lane's partition layers, in its order (`PointResolutionService._PARTITION_LAYERS`).
TRAIN_LAYERS = (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))


def fetch_train_answers(fetch, base: str, lat, lng, valid_time: str) -> list:
    """[(kind, payload)] for each partition layer that answered; a layer that fails is skipped, as the
    served lane skips it. `fetch` is injected so the arm is testable without the network."""
    out = []
    for layer, kind in TRAIN_LAYERS:
        url = (f"{base}/api/weather/point?model=GFS&domain=marine&layer={layer}"
               f"&lat={lat}&lng={lng}&valid_time={valid_time}")
        try:
            out.append((kind, fetch(url)))
        except BaseException:                                         # noqa: BLE001 — one layer, never the row
            continue
    return out


def consensus_fields(fetch, base: str, spot: dict, valid_time: str, gfs: dict, geom, station_depth_m: float) -> dict:
    """THE CONSENSUS ARM (stage 5): the other members' served offshore answers at the same spot and hour, each
    through the station transform on its own period and bearing (`model_hs_<member>_m`), and the equal-mean Hs
    with the primary's period and bearing (`model_hs_consensus_m`, only when every member answered). A member
    that cannot answer removes the consensus for that row and nothing else. `fetch` is injected for tests."""
    members = {"GFS": gfs}
    for model in CONSENSUS_MEMBERS:
        if model == "GFS":
            continue
        url = (f"{base}/api/weather/point?model={model}&domain=marine&layer=waves"
               f"&lat={spot['lat']}&lng={spot['lng']}&valid_time={valid_time}")
        try:
            pt = fetch(url).get("point") or {}
        except Exception:                                             # noqa: BLE001 — one member, never the row
            continue
        if pt.get("speed") is not None and pt.get("period") is not None and pt.get("direction") is not None:
            members[model] = {"hs": pt["speed"], "tp": pt["period"], "dir": pt["direction"]}
    at = lambda a: model_hs_at_station(a["hs"], a["tp"], a["dir"], geom.shore_normal_deg,   # noqa: E731
                                       station_depth_m, geom.depth_m, geom.shelf_width_km)
    out = {f"model_hs_{m.lower()}_m": at(a) for m, a in members.items() if m != "GFS"}
    c = equal_consensus(members)
    if c:
        out["model_hs_consensus_m"] = at(c)
        out["consensus_offshore_hs_m"] = round(c["hs"], 4)
    p = equal_consensus(members, PAIR_MEMBERS)
    if p:
        out["model_hs_pair_m"] = at(p)       # GFS + EURO: the equal mean without ICON
    # THE BUILT SHADOW (D-009): what the CONSENSUS product itself serves here, through the same transform on its own
    # period and bearing (GFS's, by construction). A spot no shadow tile covers answers 404 and costs only this arm.
    try:
        sp = fetch(f"{base}/api/weather/point?model=CONSENSUS&domain=marine&layer=waves"
                   f"&lat={spot['lat']}&lng={spot['lng']}&valid_time={valid_time}").get("point") or {}
        if sp.get("speed") is not None and sp.get("period") is not None and sp.get("direction") is not None:
            out["model_hs_shadow_m"] = at({"hs": sp["speed"], "tp": sp["period"], "dir": sp["direction"]})
            out["shadow_offshore_hs_m"] = round(float(sp["speed"]), 4)
    except Exception:                                                 # noqa: BLE001 — one arm, never the row
        pass
    out["member_offshore_hs_m"] = {m: a["hs"] for m, a in members.items()}
    return out


def classify_station_failure(exc: BaseException) -> str:
    """HTTP 404 = dead deployment (skip); everything else network-shaped = infra."""
    if isinstance(exc, urllib.error.HTTPError):
        return "skip_404" if exc.code == 404 else "infra"
    return "infra"


def probe_stations(pairs: list, hours: float, workers: int = 8):
    live, dead, infra = {}, [], []
    def one(entry):
        st = entry["station"]
        try:
            return st, fetch_station_hs(st, hours=hours), None
        except BaseException as e:                                    # noqa: BLE001 — classified below
            return st, None, e
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for st, rows, err in ex.map(one, pairs):
            if err is None:
                live[st] = rows or []
            elif classify_station_failure(err) == "skip_404":
                dead.append(st)
            else:
                infra.append({"station": st, "error": str(err)[:160]})
    return live, dead, infra


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="nearshore_report.json")
    ap.add_argument("--base", default=os.environ.get("NEARSHORE_VAL_BASE", DEFAULT_BASE))
    ap.add_argument("--stations", default="", help="comma list to restrict (debug)")
    ap.add_argument("--hours", type=float, default=26.0)
    # BACKFILL (2026-09-27): grade the recent past too, not just this hour. One hour graded ~7
    # station-hours per run; products stay resident 2 days and CDIP serves the same window. Default 0
    # keeps the hourly cron exactly as it was; a manual dispatch sets it (point calls = spots x times).
    ap.add_argument("--backfill-hours", type=float,
                    default=float(os.environ.get("NEARSHORE_VAL_BACKFILL_H", "0") or 0))
    ap.add_argument("--step-hours", type=float, default=3.0)
    # THE SPECTRAL ARM (roadmap stage 3): also grade what SURF_PARTITIONS would serve. 4x the point
    # calls (the three partition layers per spot-hour), so it is off unless asked for.
    ap.add_argument("--trains", action="store_true",
                    default=os.environ.get("NEARSHORE_VAL_TRAINS", "0") == "1")
    # THE MOP ARM (roadmap stage 4): CDIP's own spectral nearshore forecast AT the buoy, graded beside
    # the bulk arm. One OPeNDAP slice per station, so it is cheap; off unless asked for all the same.
    ap.add_argument("--mop", action="store_true",
                    default=os.environ.get("NEARSHORE_VAL_MOP", "0") == "1")
    # THE ARCHIVED MOP-GRID ARM (stage 4): the product stage 4 would serve, read from the ingest's own
    # archived runs (a directory of its artifacts). The grid's hours depend on each region's run, so the
    # stations it covers are also graded at THOSE hours (extra point calls only for those spots).
    ap.add_argument("--mop-grid-archive", default=os.environ.get("NEARSHORE_VAL_MOP_GRID_DIR", ""))
    # THE NWPS ARM (stage 4 outside California): NOAA's SWAN runs write a 2-D spectrum AT the buoys in
    # each office's domain (data/nwps_buoy_points.json), hourly; ~1 MB per cycle per station.
    ap.add_argument("--nwps", action="store_true",
                    default=os.environ.get("NEARSHORE_VAL_NWPS", "0") == "1")
    # THE CONSENSUS ARM (stage 5): EURO and ICON at every graded spot-hour, their equal mean with GFS through the
    # same transform. Two extra point calls per row, so off unless asked for.
    ap.add_argument("--consensus", action="store_true",
                    default=os.environ.get("NEARSHORE_VAL_CONSENSUS", "0") == "1")
    ap.add_argument("--max-stations", type=int,
                    default=int(os.environ.get("NEARSHORE_VAL_MAX_STATIONS", "20")))
    args = ap.parse_args()
    t0 = time.time()

    try:
        table = load_pairs()
    except Refusal as e:
        print(f"INFRA: {e}")
        return 2
    gen = datetime.fromisoformat(str(table["generated_at"]).replace("Z", "+00:00"))
    age_d = (datetime.now(timezone.utc) - gen).total_seconds() / 86400.0
    if age_d > 75:
        print(f"WARNING: pair table is {age_d:.0f} days old — hard refusal at 90 "
              f"(rerun backend/scripts/build_nearshore_pairs.py)")

    pairs = table["pairs"]
    if args.stations:
        want = {s.strip() for s in args.stations.split(",") if s.strip()}
        pairs = [p for p in pairs if p["station"] in want]
    pairs = pairs[: max(1, args.max_stations)]
    # NDBC buoys where CDIP has no live station (the Gulf, 2026-09-28): hand-listed, appended AFTER the cap so a
    # full CDIP table can never crowd them out. ndbc_nearshore.py has the pairing rule (the buoy's own cell).
    pairs = pairs + [p for p in load_ndbc_pairs()
                     if not args.stations or p["station"] in {s.strip() for s in args.stations.split(",")}]

    live_obs, dead_404, infra_stations = probe_stations(pairs, max(args.hours, args.backfill_hours + 2))
    if not live_obs:
        print(f"INFRA: 0 of {len(pairs)} stations answered "
              f"(404-dead {len(dead_404)}, infra {len(infra_stations)}) — THREDDS or network down")
        return 2

    # The serving path's own offshore answer, at the top of the current hour (matches CDIP's
    # ~30-min cadence inside match()'s ±1800 s tolerance; one obs can serve several spots — see
    # the module header's spot-hour disclosure).
    valid_times = backfill_valid_times(datetime.now(timezone.utc), args.backfill_hours, args.step_hours)
    valid_time = valid_times[0]
    from services.weather_pipeline.surf_point import resolve_surf_geometry  # noqa: E402 — after path insert

    preds, point_fail = [], 0
    live_pairs = [p for p in pairs if p["station"] in live_obs]
    grid_hours, grid_blobs = {}, (load_mop_archives(args.mop_grid_archive) if args.mop_grid_archive else [])
    for entry in live_pairs:
        hrs = mop_grid_hours(grid_blobs, entry["station"], datetime.now(timezone.utc), args.backfill_hours + 1)
        if hrs:
            grid_hours[entry["station"]] = hrs
    geo = {}
    for entry in live_pairs:
        depth = float(entry.get("station_depth_m") or 0) or 20.0
        station_times = list(valid_times) + sorted(
            {h[:13] + ":00" for h in grid_hours.get(entry["station"], {})} - {vt for vt in valid_times})
        for spot, valid_time in ((sp, vt) for sp in entry.get("spots", []) for vt in station_times):
            url = (f"{args.base}/api/weather/point?model=GFS&domain=marine&layer=waves"
                   f"&lat={spot['lat']}&lng={spot['lng']}&valid_time={valid_time}")
            try:
                d = _fetch_json(url)
            except BaseException as e:                                # noqa: BLE001 — counted, not fatal
                point_fail += 1
                print(f"point-api miss {entry['station']}/{spot.get('name')}: {str(e)[:120]}")
                continue
            pt = d.get("point") or {}
            hs, tp, dr = pt.get("speed"), pt.get("period"), pt.get("direction")
            if hs is None or tp is None or dr is None:
                point_fail += 1
                continue
            # THE INSTRUMENT'S GEOMETRY (2026-09-28). The transform is graded at the buoy, so it takes the BUOY's
            # shore normal (hence its swell exposure), not the spot's: at 153p1 the buoy's exposure factor was
            # 0.892 while its spots used 0.74-0.85 (Blacks Beach faces 26 deg away), so the judge charged the
            # chain for the beach's exposure and MOP/NWPS, read at the buoy, never paid it. The INPUT stays the
            # served offshore field at the spot. The spot-geometry number is kept beside it (spot_geometry).
            key = (spot["lat"], spot["lng"])
            if key not in geo:
                geo[key] = resolve_surf_geometry(spot["lat"], spot["lng"])     # once per spot, not per hour
            gs = geo[key]
            skey = (float(entry["station_lat"]), float(entry["station_lng"]))
            if skey not in geo:
                geo[skey] = resolve_surf_geometry(*skey)
            g = geo[skey]
            row_trains = {}
            if args.trains:
                trains = station_trains(fetch_train_answers(_fetch_json, args.base, spot["lat"], spot["lng"],
                                                            valid_time), hs, tp)
                spectral = model_hs_at_station_trains(trains, g.shore_normal_deg, depth, g.depth_m,
                                                      g.shelf_width_km) if trains else None
                row_trains = {"trains_used": spectral is not None,
                              "n_trains": len(trains or []),
                              "model_hs_trains_m": spectral if spectral is not None else model_hs_at_station(
                                  hs, tp, dr, g.shore_normal_deg, depth, g.depth_m, g.shelf_width_km)}
            preds.append({
                "station": entry["station"], "spot": spot.get("name"),
                "valid_time": valid_time + ":00Z",
                "model_hs_m": model_hs_at_station(hs, tp, dr, g.shore_normal_deg,
                                                  depth, g.depth_m, g.shelf_width_km),
                "offshore_hs_m": hs, "tp_s": tp, "swell_from_deg": dr,
                "factors": transform_factors(tp, dr, g.shore_normal_deg, depth, g.depth_m, g.shelf_width_km),
                "model_hs_spot_geometry_m": model_hs_at_station(hs, tp, dr, gs.shore_normal_deg,
                                                                depth, gs.depth_m, gs.shelf_width_km),
                # THE SHELF ARM (2026-09-28): the chain with its cross-shelf friction OFF, on rows where friction
                # applies (wide shelves). See `no_friction_ab` in nearshore_validation.build_report.
                **({"model_hs_no_friction_m": model_hs_at_station(hs, tp, dr, g.shore_normal_deg, depth, g.depth_m, 0.0),
                    "model_hs_nearshore_input_m": model_hs_from_nearshore_input(hs, tp, g.depth_m, depth)}
                   if shelf_dissipation(tp, g.depth_m, g.shelf_width_km) < 0.999 else {}),
                # THE LEGACY-FRICTION ARM: the chain at the pre-#146 scale, where that friction would have applied.
                **({"model_hs_legacy_friction_m": model_hs_at_station(
                    hs, tp, dr, g.shore_normal_deg, depth, g.depth_m, g.shelf_width_km, cf_scale=LEGACY_SHELF_CF_SCALE)}
                   if shelf_dissipation(tp, g.depth_m, g.shelf_width_km, LEGACY_SHELF_CF_SCALE) < 0.999 else {}),
                "upstream_provider": d.get("upstream_provider"),
                **row_trains,
                **(consensus_fields(_fetch_json, args.base, spot, valid_time, {"hs": hs, "tp": tp, "dir": dr},
                                    g, depth) if args.consensus else {}),
            })
    if not preds and point_fail:
        print(f"INFRA: the point API produced 0 usable answers in {point_fail} attempts "
              f"({args.base} asleep or down) — nothing graded")
        return 2
    assert all("station" in p for p in preds), "prediction rows must carry 'station' (L4)"

    mop_status = {}
    if args.mop:
        for st in sorted({p["station"] for p in preds}):
            rows = [p for p in preds if p["station"] == st]
            try:
                mop = fetch_mop_hs(st, [p["valid_time"] for p in rows])
            except BaseException as e:                                # noqa: BLE001 — one station, never the run
                mop_status[st] = ("no MOP site" if classify_station_failure(e) == "skip_404"
                                  else f"unavailable: {str(e)[:80]}")
                continue
            for p in rows:
                if p["valid_time"] in mop:
                    p["mop_hs_m"] = mop[p["valid_time"]]
            mop_status[st] = f"{len(mop)} hours"

    for p in preds:
        g = grid_hours.get(p["station"], {}).get(p["valid_time"])
        if g:
            p["mop_grid_hs_m"], p["mop_grid_lead_h"] = g["hs"], g["lead_h"]
    nwps_status = (attach_nwps(preds, datetime.now(timezone.utc), args.backfill_hours + 1)
                   if args.nwps else {})

    matched, n_obs = [], 0
    for entry in live_pairs:
        st = entry["station"]
        obs = live_obs[st]
        n_obs += len(qc_filter(obs))
        matched.extend(match([p for p in preds if p["station"] == st], obs))

    report = build_report(matched, n_stations=len(live_obs), n_obs=n_obs, n_preds=len(preds),
                          min_station_hours=GRADED_MIN_STATION_HOURS)
    report["station_probe"] = {"live": sorted(live_obs), "dead_404": sorted(dead_404),
                               "infra": infra_stations}
    report["n_spot_hours"] = len(matched)       # n_station_hours comes from build_report, which gates on it
    report["point_api"] = {"base": args.base, "valid_time": valid_times[0], "valid_times": len(valid_times),
                           "calls": (len(preds) * (1 + len(TRAIN_LAYERS) * bool(args.trains)
                                                   + len(CONSENSUS_MEMBERS) * bool(args.consensus))) + point_fail,
                           "failed": point_fail, "trains": bool(args.trains), "consensus": bool(args.consensus)}
    if args.mop:
        report["mop"] = {"product": "MOP_validation forecast (WW3-driven)", "stations": mop_status}
    if args.mop_grid_archive:
        report["mop_grid"] = {"product": "MOP_grids sea+swell forecast (ECMWF-driven), archived runs",
                              "archives": len(grid_blobs),
                              "stations": {s: len(h) for s, h in sorted(grid_hours.items())}}
    if args.nwps:
        report["nwps"] = {"product": "NOAA NWPS SWAN (CG1) 2-D spectra at the buoy, WW3-bounded",
                          "stations": nwps_status}
    report["budget"] = {"wall_s": round(time.time() - t0, 1)}
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    # Decision lines ABOVE any tail window (the census lane's tail -40 once cut the failing row).
    print(f"STATIONS live={len(live_obs)} dead404={len(dead_404)} infra={len(infra_stations)}")
    print(f"BUDGET wall={report['budget']['wall_s']}s point_calls={report['point_api']['calls']}")
    if not report["available"]:
        print(f"REFUSED: {report['reason']}")
        return 1
    per = ", ".join(f"{s}:n={v['n']} mae={v['mae_m']} bias={v['bias_m']:+}"
                    for s, v in sorted(report["stations"].items()))
    print(f"VERDICT GRADED n_matched={report['n_matched']} "
          f"(spot-hours {report['n_spot_hours']}, station-hours {report['n_station_hours']}) {per}")
    sg = report.get("spot_geometry")
    if sg:
        print(f"GEOMETRY station (graded) vs spot: mae {sg['station']['mae_m']} vs {sg['spot']['mae_m']}, "
              f"obs/model {sg['station'].get('obs_over_model_median')} vs {sg['spot'].get('obs_over_model_median')}")
    gab = report.get("mop_grid_ab")
    if gab:
        print(f"MOP_GRID_AB n={gab['n']} station_hours={gab['n_station_hours']} "
              f"bulk={gab['bulk']['mae_m']}/{gab['bulk']['bias_m']:+} grid={gab['arm']['mae_m']}/{gab['arm']['bias_m']:+} "
              f"closer={gab['arm_closer_share']}")
    iab = report.get("nearshore_input_ab")
    if iab:
        print(f"NEARSHORE_INPUT_AB n={iab['n']} station_hours={iab['n_station_hours']} "
              f"bulk={iab['bulk']['mae_m']}/{iab['bulk']['bias_m']:+} nearshore_input={iab['arm']['mae_m']}/{iab['arm']['bias_m']:+} "
              f"closer={iab['arm_closer_share']}")
    fab = report.get("no_friction_ab")
    if fab:
        print(f"NO_FRICTION_AB n={fab['n']} station_hours={fab['n_station_hours']} "
              f"bulk={fab['bulk']['mae_m']}/{fab['bulk']['bias_m']:+} no_friction={fab['arm']['mae_m']}/{fab['arm']['bias_m']:+} "
              f"closer={fab['arm_closer_share']}")
    lab = report.get("legacy_friction_ab")
    if lab:
        print(f"LEGACY_FRICTION_AB n={lab['n']} station_hours={lab['n_station_hours']} "
              f"bulk={lab['bulk']['mae_m']}/{lab['bulk']['bias_m']:+} legacy_friction={lab['arm']['mae_m']}/{lab['arm']['bias_m']:+} "
              f"closer={lab['arm_closer_share']}")
    nab = report.get("nwps_ab")
    if nab:
        print(f"NWPS_AB n={nab['n']} station_hours={nab['n_station_hours']} "
              f"bulk={nab['bulk']['mae_m']}/{nab['bulk']['bias_m']:+} nwps={nab['arm']['mae_m']}/{nab['arm']['bias_m']:+} "
              f"closer={nab['arm_closer_share']}")
    mab = report.get("mop_ab")
    if mab:
        print(f"MOP_AB n={mab['n']} station_hours={mab['n_station_hours']} "
              f"bulk={mab['bulk']['mae_m']}/{mab['bulk']['bias_m']:+} mop={mab['arm']['mae_m']}/{mab['arm']['bias_m']:+} "
              f"closer={mab['arm_closer_share']}")
    cab = report.get("consensus_ab")
    if cab:
        print(f"CONSENSUS_AB n={cab['n']} station_hours={cab['n_station_hours']} "
              f"bulk={cab['bulk']['mae_m']}/{cab['bulk']['bias_m']:+} consensus={cab['arm']['mae_m']}/{cab['arm']['bias_m']:+} "
              f"closer={cab['arm_closer_share']} SAME_ROWS "
              + " ".join(f"{k}={v['mae_m']}/{v['bias_m']:+}" for k, v in cab["same_rows"].items()))
    sab = report.get("shadow_ab")
    if sab:
        print(f"SHADOW_AB n={sab['n']} station_hours={sab['n_station_hours']} "
              f"bulk={sab['bulk']['mae_m']}/{sab['bulk']['bias_m']:+} shadow={sab['arm']['mae_m']}/{sab['arm']['bias_m']:+} "
              f"closer={sab['arm_closer_share']} BUILT_VS_COMPUTED offshore |shadow-consensus| "
              f"median={sab['built_vs_computed']['median_m']} p90={sab['built_vs_computed']['p90_m']} "
              f"n={sab['built_vs_computed']['n']}")
    for m, v in sorted((report.get("member_ab") or {}).items()):
        print(f"MEMBER_AB {m} n={v['n']} station_hours={v['n_station_hours']} "
              f"gfs={v['bulk']['mae_m']}/{v['bulk']['bias_m']:+} {m.lower()}={v['arm']['mae_m']}/{v['arm']['bias_m']:+} "
              f"closer={v['arm_closer_share']}")
    pab = report.get("pair_ab")
    if pab:
        print(f"PAIR_AB n={pab['n']} station_hours={pab['n_station_hours']} "
              f"gfs={pab['bulk']['mae_m']}/{pab['bulk']['bias_m']:+} gfs_euro={pab['arm']['mae_m']}/{pab['arm']['bias_m']:+} "
              f"closer={pab['arm_closer_share']}")
    ab = report.get("trains_ab")
    if ab:
        t = ab["trains_only"]
        print(f"TRAINS_AB n={ab['n']} bulk_mae={ab['bulk']['mae_m']} as_flipped_mae={ab['as_flipped']['mae_m']} "
              f"trains_used={t['n']}" + (f" bulk={t['bulk']['mae_m']}/{t['bulk']['bias_m']:+} "
                                         f"trains={t['trains']['mae_m']}/{t['trains']['bias_m']:+} "
                                         f"closer={t['trains_closer_share']}" if t["n"] else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
