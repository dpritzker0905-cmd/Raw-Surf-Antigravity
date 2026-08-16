"""run_nearshore_validation.py — the WS-CAN-0076 nearshore outcome RUNNER (AV-09, Audit 4.0 lane).

One cycle of the loop nearshore_validation.py provides pure pieces for: committed pair table ->
live CDIP realtime observations (QC flag==1) -> the SERVING PATH's offshore point answer at each
linked spot -> model_hs_at_station -> match -> build_report -> one JSON on disk.

EXIT CONTRACT (int only — never SystemExit("string"), the L-2 defect):
    0  GRADED   — report available:true
    1  REFUSED  — a verdict: available:false (n_matched below floor); the report is still written
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
    Refusal, build_report, fetch_station_hs, load_pairs, match, model_hs_at_station, qc_filter)

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
UA = {"User-Agent": "raw-surf-nearshore-validation-runner"}


def _fetch_json(url: str, timeout: float = 60.0) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


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

    live_obs, dead_404, infra_stations = probe_stations(pairs, args.hours)
    if not live_obs:
        print(f"INFRA: 0 of {len(pairs)} CDIP stations answered "
              f"(404-dead {len(dead_404)}, infra {len(infra_stations)}) — THREDDS or network down")
        return 2

    # The serving path's own offshore answer, at the top of the current hour (matches CDIP's
    # ~30-min cadence inside match()'s ±1800 s tolerance; one obs can serve several spots — see
    # the module header's spot-hour disclosure).
    valid_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00")
    from services.weather_pipeline.surf_point import resolve_surf_geometry  # noqa: E402 — after path insert

    preds, point_fail = [], 0
    live_pairs = [p for p in pairs if p["station"] in live_obs]
    for entry in live_pairs:
        depth = float(entry.get("station_depth_m") or 0) or 20.0
        for spot in entry.get("spots", []):
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
            g = resolve_surf_geometry(spot["lat"], spot["lng"])
            preds.append({
                "station": entry["station"], "spot": spot.get("name"),
                "valid_time": valid_time + ":00Z",
                "model_hs_m": model_hs_at_station(hs, tp, dr, g.shore_normal_deg,
                                                  depth, g.depth_m, g.shelf_width_km),
                "offshore_hs_m": hs, "tp_s": tp, "swell_from_deg": dr,
                "upstream_provider": d.get("upstream_provider"),
            })
    if not preds and point_fail:
        print(f"INFRA: the point API produced 0 usable answers in {point_fail} attempts "
              f"({args.base} asleep or down) — nothing graded")
        return 2
    assert all("station" in p for p in preds), "prediction rows must carry 'station' (L4)"

    matched, n_obs = [], 0
    for entry in live_pairs:
        st = entry["station"]
        obs = live_obs[st]
        n_obs += len(qc_filter(obs))
        matched.extend(match([p for p in preds if p["station"] == st], obs))

    report = build_report(matched, n_stations=len(live_obs), n_obs=n_obs, n_preds=len(preds))
    report["station_probe"] = {"live": sorted(live_obs), "dead_404": sorted(dead_404),
                               "infra": infra_stations}
    report["n_spot_hours"] = len(matched)
    report["n_station_hours"] = len({(m["station"], m["obs_time"]) for m in matched})
    report["point_api"] = {"base": args.base, "valid_time": valid_time,
                           "calls": len(preds) + point_fail, "failed": point_fail}
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
