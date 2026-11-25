"""The displayed-tide shift at the actual spot keys when SURF_TIDE_MLLW_US is on (offline; no live backend call).

Per active spot, at its served 0.1-degree key: is it a US point (tide_us_region), which D source the served rules
pick (tide_datum.resolve_d: model, gauge <= 2 km, interpolated, or none = stays on local MSL), and the shift the
display adds, offset = D - M. Reports, per region: keys, the source split, and the shift's median / p10 / p90.

Inputs:
  --spots   a JSON list of spots ({latitude, longitude} dicts or [lat, lng] pairs): the catalogue snapshot committed
            in the repo, or the CI build's spots.json
  --m       optional: the build's M cache (tide_own_m.json: {key: {"m", "d_ntde"?}}). With it, M and the model D are
            the served per-key values (exact). Without it, M is the nearest of G3t's 26 measured gauge values
            (own_rules.G3T_M, 0.067-0.150 m) and there is no model D, so every key uses a gauge, an interpolation
            or MSL - the state before the CI build has filled d_ntde.
Usage (from backend/):  python scripts/tide_datum/spot_shift.py --spots <file> [--m tide_own_m.json] [--json out]
"""
import argparse
import json
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "tide_own"))
import own_rules as OR                                           # noqa: E402
from services.weather_pipeline import tide_datum as TD           # noqa: E402
from services.weather_pipeline.tide_us_region import us_region   # noqa: E402


def subregion(lat, lng):
    r = us_region(lat, lng)
    if r != "conus":
        return r
    if lng < -115.0:
        return "west"
    if lat < 31.0 and lng < -80.5:
        return "gulf"
    return "east"


def nearest_g3t_m(lat, lng, stations):
    by_id = {s["id"]: s for s in stations}
    best = None
    for sid, m in OR.G3T_M.items():
        s = by_id.get(sid)
        if s is None:
            continue
        k = TD._km(lat, lng, s["lat"], s["lng"])
        if best is None or k < best[0]:
            best = (k, m)
    return best[1] if best else None


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, int(round(p * (len(xs) - 1)))))] if xs else None


def run(spots, m_cache=None, stations=None):
    stations = stations if stations is not None else TD._load_stations()
    keys = OR.keys_from_spots(spots)
    out = {}
    for k, (la, lo) in keys.items():
        region = subregion(la, lo)
        if region is None:
            continue
        row = out.setdefault(region, {"keys": 0, "source": {}, "shift": [], "d": []})
        row["keys"] += 1
        entry = (m_cache or {}).get(k) or {}
        m = entry.get("m") if m_cache is not None else nearest_g3t_m(la, lo, stations)
        got = TD.resolve_d(la, lo, entry.get("d_ntde"), stations)
        src = got[1] if got else "msl"
        if got and m is None:
            src = "msl (no M)"
        row["source"][src] = row["source"].get(src, 0) + 1
        if got and m is not None:
            row["shift"].append(got[0] - float(m))
            row["d"].append(got[0])
    rep = {}
    for r, v in sorted(out.items()):
        s = v["shift"]
        rep[r] = {"keys": v["keys"], "source": v["source"], "shift_n": len(s),
                  "shift_median_m": round(st.median(s), 3) if s else None,
                  "shift_p10_m": round(q(s, 0.1), 3) if s else None, "shift_p90_m": round(q(s, 0.9), 3) if s else None}
    allshift = [x for v in out.values() for x in v["shift"]]
    rep["_all_us"] = {"keys": sum(v["keys"] for v in out.values()), "shift_n": len(allshift),
                      "shift_median_m": round(st.median(allshift), 3) if allshift else None,
                      "m_source": "build M cache (exact)" if m_cache is not None else "nearest G3t gauge M (approx.)"}
    return rep


def _spots(path):
    raw = json.load(open(path, encoding="utf-8"))
    out = []
    for p in raw:
        if isinstance(p, dict):
            if p.get("is_active") is False:
                continue
            out.append([p.get("latitude"), p.get("longitude")])
        else:
            out.append(p)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", required=True)
    ap.add_argument("--m", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--summary", default=None, help="append a markdown table (e.g. $GITHUB_STEP_SUMMARY)")
    a = ap.parse_args(argv)
    m_cache = json.load(open(a.m, encoding="utf-8")) if a.m and os.path.exists(a.m) else None
    rep = run(_spots(a.spots), m_cache)
    print(json.dumps(rep, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, indent=1)
    if a.summary:
        lines = ["### US tide display above MLLW: shift at the spot keys (D - M, m)", "",
                 "| region | keys | sources | shift median | p10 | p90 |", "|---|---|---|---|---|---|"]
        for r, v in rep.items():
            if r.startswith("_"):
                continue
            lines.append(f"| {r} | {v['keys']} | {v['source']} | {v['shift_median_m']} | {v['shift_p10_m']} | "
                         f"{v['shift_p90_m']} |")
        lines.append(f"\nAll US keys: {rep['_all_us']}")
        with open(a.summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
