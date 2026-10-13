"""same_model_parity_probe.py — where does our pipeline lose the SAME model's skill?

WHY (2026-09-29). The forecast-accuracy monitor measures a standing gap to the public reference on paired buoy hours,
and part of it is not physics at all: `open_meteo:ncep_gfswave025` is NOAA GFS-Wave 0.25 deg, the same model our GFS
lane serves, and it beats us by +0.020..+0.027 m at 24-72 h (n ~2,240-2,410; the ledger's
`forecast_skill_same_model` block: gap 0.0266 m over 49,830 pairs, bias ours -0.071 vs control -0.054 m, and on
big swells -0.574 vs -0.439 m). That block splits the gap by tier, frame snap and cycle age, but 98% of its rows
predate the provenance fields and read `unknown`, and it can only grade once observations arrive.
⇒ Compare FORECAST to FORECAST instead: at every ledger buoy, for the same hours, what we serve from our GFS lane
against what Open-Meteo serves from the same model. No observation is involved, so every difference is ours or
the cycle's, and each row carries what answered it: the product tier, the interpolation method, the frame offset,
our model cycle.

  * Ours: /api/weather/point?model=GFS&domain=marine&layer=waves (the served lane, the one the ledger grades).
  * Control: the LEDGER'S OWN control lane, `forecast_skill.fetch_om_forecast_rows(model="ncep_gfswave025")`: the
    same batched request, the same target hours and the same rules, including "0.0 is a coverage hole, not a flat
    sea" (Open-Meteo's cell at a coastal buoy can be land). ⛔ The first draft of this probe fetched the control
    itself, re-derived that rule wrong, and reported ours +0.128 m high: every large row was a control 0.0 at a
    coastal buoy (Waimea, La Jolla, Juan de Fuca), the trap the ledger recorded on 2026-08-10. Mirror, never
    re-derive (CLAUDE.md).
  * Hours: the ledger's leads (+24/+48/+72 h from now) plus +25/+26 h, so on- and off-frame hours are both present
    whatever the current hour (frame = a multiple of 3 UTC; the frame-snap effect).
  * Groups: tier (regional / global_mid / global_coarse / viewport / other), interpolation method, on/off frame,
    lead, our cycle age. Each group: n, bias (ours - control, mean), MAE, and its share of the total squared diff.
  * POSITIVE CONTROL: rows answered from a regional 0.25 deg tile by plain bilinear, on a frame, from a fresh cycle,
    must agree to within a few cm; if they do not, the problem is in the base path, not in a tier.

Read-only: the production point API, NDBC's public station table (the ledger's own helper) and Open-Meteo.
Usage (repo root):  python backend/scripts/same_model_parity_probe.py [--json out.json] [--limit N]
The decision line is `SAME_MODEL_PARITY ...`; group lines follow. Exit 3 (REFUSED) when fewer than 30 rows paired.
"""
import argparse
import asyncio
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
LEADS = (24, 25, 26, 48, 72)
MIN_ROWS = 30
PAUSE_S = 0.15                                              # gentle on the 1-CPU serving box (LESSONS L-O1)


def tier_of(product_id) -> str:
    """The product tier from our served filename. PURE."""
    p = (product_id or "").lower()
    if not p:
        return "none"
    if "global_coarse" in p:
        return "global_coarse"
    if "global_mid" in p:
        return "global_mid"
    if "viewport" in p or "dynamic" in p:
        return "viewport"
    return "regional" if p.startswith("gfs_marine_waves_") else "other"


def make_row(buoy, lat, lng, t, lead, ours: dict, control, now: datetime):
    """One paired row, or None when either side has no number. PURE."""
    pt = (ours or {}).get("point") or {}
    hs = pt.get("speed")
    if hs is None or control is None or pt.get("interpolation_method") in (None, "unavailable", "out_of_bounds_fallback"):
        return None
    cyc = ours.get("model_run_time")
    try:
        age = round((now - datetime.fromisoformat(str(cyc).replace("Z", "+00:00"))).total_seconds() / 3600.0, 1)
    except (TypeError, ValueError):
        age = None
    return {"buoy": buoy, "lat": lat, "lng": lng, "valid_time": t.strftime("%Y-%m-%dT%H:%MZ"), "lead_h": lead,
            "on_frame": t.hour % 3 == 0, "ours_m": round(float(hs), 4), "control_m": round(float(control), 4),
            "diff_m": round(float(hs) - float(control), 4), "tier": tier_of(ours.get("product_id")),
            "method": pt.get("interpolation_method"), "frame_offset_h": ours.get("frame_offset_hours"),
            "cycle_age_h": age, "product_id": ours.get("product_id")}


def _age_group(age) -> str:
    if age is None:
        return "unknown"
    return "<6h" if age < 6 else ("6-12h" if age < 12 else ("12-24h" if age < 24 else ">=24h"))


def summarize(rows: list) -> dict:
    """Overall and per-group bias / MAE / share of the squared difference. PURE."""
    def stats(rs):
        d = [r["diff_m"] for r in rs]
        return {"n": len(d), "bias_m": round(sum(d) / len(d), 4), "mae_m": round(sum(abs(x) for x in d) / len(d), 4),
                "sq": sum(x * x for x in d)}
    if not rows:
        return {"n": 0}
    total = stats(rows)
    out = {"n": total["n"], "bias_m": total["bias_m"], "mae_m": total["mae_m"], "groups": {}}
    keys = {"tier": lambda r: r["tier"], "method": lambda r: r["method"],
            "frame": lambda r: "on_frame" if r["on_frame"] else "off_frame",
            "lead": lambda r: f"+{r['lead_h']}h", "cycle_age": lambda r: _age_group(r["cycle_age_h"])}
    for name, key in keys.items():
        groups = {}
        for r in rows:
            groups.setdefault(key(r), []).append(r)
        out["groups"][name] = {
            g: {**{k: v for k, v in stats(rs).items() if k != "sq"},
                "share_of_sq": round(stats(rs)["sq"] / total["sq"], 3) if total["sq"] else 0.0}
            for g, rs in sorted(groups.items())}
    control = [r for r in rows if r["tier"] == "regional" and r["method"] == "bilinear" and r["on_frame"]
               and r["cycle_age_h"] is not None and r["cycle_age_h"] < 12]
    out["positive_control"] = ({k: v for k, v in stats(control).items() if k != "sq"} if control else {"n": 0})
    return out


def _get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-same-model-probe"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_ours(lat, lng, t):
    q = urllib.parse.urlencode({"model": "GFS", "domain": "marine", "layer": "waves", "lat": lat, "lng": lng,
                                "valid_time": t.strftime("%Y-%m-%dT%H:%M:%SZ")})
    return _get_json(f"{BASE}/api/weather/point?{q}")


def ledger_control_rows(buoys: dict, now: datetime) -> list:
    """The ledger's same-model control lane, verbatim (see the module docstring)."""
    from services.weather_pipeline.forecast_skill import OM_CONTROL_MODEL, SOURCE_OM_GFS, fetch_om_forecast_rows
    return fetch_om_forecast_rows(buoys, now, leads_h=LEADS, model=OM_CONTROL_MODEL, source=SOURCE_OM_GFS)


def run(buoys: dict, now: datetime, ours=fetch_ours, control_rows=ledger_control_rows, pause=PAUSE_S) -> dict:
    """Probe every buoy {id: (lat, lng)} at the ledger control's own rows; fetchers injected for tests. Never raises
    per row; a control lane that cannot be read makes the whole run REFUSE (0 rows)."""
    rows, failures = [], {"ours": 0, "control": 0}
    try:
        control = control_rows(buoys, now)
    except Exception:                                        # noqa: BLE001 — refused below, never green
        control, failures["control"] = [], 1
    for c in control:
        bid = c.get("buoy_id")
        if bid not in buoys:
            continue
        lat, lng = buoys[bid]
        try:
            t = datetime.fromisoformat(str(c["target_time"]).replace("Z", "+00:00"))
            o = ours(lat, lng, t)
        except Exception:                                    # noqa: BLE001 — one row, never the run
            failures["ours"] += 1
            continue
        row = make_row(bid, lat, lng, t, int(round(float(c.get("lead_h") or 0))), o, c.get("hs_m"), now)
        if row:
            rows.append(row)
        if pause:
            time.sleep(pause)
    return {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "buoys": len(buoys), "control_rows": len(control),
            "failures": failures, "summary": summarize(rows), "rows": rows}


def decision_lines(report: dict) -> list:
    s = report["summary"]
    if s.get("n", 0) < MIN_ROWS:
        return [f"REFUSED same-model parity: {s.get('n', 0)} paired rows (< {MIN_ROWS}); failures {report['failures']}"]
    pc = s["positive_control"]
    lines = [f"SAME_MODEL_PARITY n={s['n']} bias={s['bias_m']:+} mae={s['mae_m']} buoys={report['buoys']} "
             f"failures={report['failures']} POSITIVE_CONTROL(regional,bilinear,on_frame,<12h) "
             f"n={pc.get('n')} bias={pc.get('bias_m')} mae={pc.get('mae_m')}"]
    for name, groups in s["groups"].items():
        lines.append(f"  by {name}: " + " | ".join(f"{g} n={v['n']} bias={v['bias_m']:+} mae={v['mae_m']} "
                                                   f"share={v['share_of_sq']}" for g, v in groups.items()))
    return lines


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json")
    ap.add_argument("--limit", type=int, default=0, help="probe at most N buoys (debug)")
    ap.add_argument("--stations", help="a local copy of NDBC latest_obs.txt (when this machine cannot reach NDBC "
                                       "over TLS); parsed by the ledger's own parse_station_coords")
    args = ap.parse_args(argv)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from services.weather_pipeline.buoy_calibration import fetch_ndbc_station_coords, parse_station_coords
    cal = _get_json(f"{BASE}/api/weather/buoy-calibration")
    ids = sorted({str(s.get("buoy_id")).upper() for s in cal.get("spots") or [] if s.get("buoy_id")})
    if args.stations:
        with open(args.stations, encoding="utf-8", errors="replace") as f:
            coords = parse_station_coords(f.read())
    else:
        coords = asyncio.run(fetch_ndbc_station_coords())
    buoys = {b: coords[b] for b in ids if b in coords}
    if args.limit:
        buoys = dict(list(buoys.items())[:args.limit])
    report = run(buoys, datetime.now(timezone.utc))
    report["ledger_buoys"], report["with_coords"] = len(ids), len(buoys)
    for line in decision_lines(report):
        print(line)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
    return 3 if report["summary"].get("n", 0) < MIN_ROWS else 0


if __name__ == "__main__":
    sys.exit(main())
