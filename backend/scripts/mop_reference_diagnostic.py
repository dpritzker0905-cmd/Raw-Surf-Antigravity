#!/usr/bin/env python3
"""mop_reference_diagnostic.py - a SPOT-LEVEL reference for SURF_SPECTRAL_K at Rodeo Beach and Pismo Beach Pier: CDIP's
own buoy-driven MOP hindcast/nowcast at the spot's MOP point, through the chain's own breaking step. A DIAGNOSTIC
(#727 follow-up, 2026-11-05), not a flip test. Reads CDIP THREDDS (public) and the window artifacts of rework-score
run 41958242376; never the app.

WHY: hb_proxy at Rodeo comes from the SF Bar buoy (142p1), 9 km away. CDIP's MOP hindcast is the operational
California system (O'Reilly et al. 2016), refraction from OBSERVED offshore buoy spectra at the very MOP point K uses.
Fed through the same breaking step (`mop_nearshore.estimate_surf_from_nearshore`), it differs from the K arm in ONE
thing: the input spectrum (observed-buoy boundary vs our GFS partition rebuild at a distant read point).

READING RULE (stated before the first run):
  - K arm within +/-0.15 m of the MOP reference in every K-ratio bin, while hb_proxy disagrees -> the PROXY misled
    the Rodeo verdict; K's physics and input are fine there.
  - K arm off the MOP reference in the same pattern as against the proxy (high where exposed, low where shadowed)
    -> the GFS INPUT is the defect; CDIP's own product (SURF_NEARSHORE_MOP) is the better path.
  - else INCONCLUSIVE. Coverage (how many pairs found a MOP value) is reported first; under 200 pairs = INCONCLUSIVE.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import rodeo_diagnostic as rd  # noqa: E402

THREDDS = "https://thredds.cdip.ucsd.edu/thredds"
CATALOG = THREDDS + "/catalog/cdip/model/MOP_alongshore/catalog.xml"
SITES = {"142p1": "MA053", "285p1": "SL093"}      # anchor station -> its spot's MOP label (the K table entry)
TOL_S = 1800


def get(url, tries=6):
    if not url.startswith(THREDDS):
        raise ValueError(f"refusing a non-CDIP URL: {url}")
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "raw-surf-eval"}),
                                        timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:                              # noqa: BLE001 - retried, then raised
            if "404" in str(e) or k == tries - 1:
                raise
            time.sleep(2 ** k)


def datasets(label):
    xml = get(CATALOG)
    return sorted(set(m for m in re.findall(r'urlPath="([^"]+)"', xml) if f"/{label}_" in m or m.startswith(label)))


def _vals(txt, name):
    """The numbers of one variable from an OPeNDAP .ascii answer (the block after its `name[n]` line)."""
    m = re.search(rf"^{name}(?:\.{name})?\[\d+\]\s*$(.*?)(?:^\s*$|\Z)", txt, re.S | re.M)
    if not m:
        return None
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", m.group(1))]


def series(path, t0, t1):
    """{epoch_s: (hs, tp, dp)} within [t0, t1] from one MOP dataset (waveTime, waveHs, waveTp, waveDp)."""
    base = f"{THREDDS}/dodsC/{path}"
    tt = get(base + ".ascii?waveTime")
    times = _vals(tt, "waveTime") or []
    idx = [i for i, t in enumerate(times) if t0 <= t <= t1]
    if not idx:
        return {}, len(times), (times[0] if times else None, times[-1] if times else None)
    i0, i1 = idx[0], idx[-1]
    out = {}
    cols = {}
    for v in ("waveHs", "waveTp", "waveDp"):
        cols[v] = _vals(get(f"{base}.ascii?{v}[{i0}:1:{i1}]"), v)
    for k, i in enumerate(range(i0, i1 + 1)):
        try:
            out[int(times[i])] = (cols["waveHs"][k], cols["waveTp"][k], cols["waveDp"][k])
        except (TypeError, IndexError):
            break
    return out, len(times), (times[0], times[-1])


def mop_ref_hb(hs, tp, entry, geo):
    from services.weather_pipeline.mop_nearshore import estimate_surf_from_nearshore
    h, _ = estimate_surf_from_nearshore(hs, tp, entry["depth_m"], geo.depth_m, geo.shelf_width_km, geo.break_depth_m)
    return h


def run(wins, stations_path):
    from services.weather_pipeline import spectral_k_serving as S
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    stations = {s["id"]: s for s in json.load(open(stations_path, encoding="utf-8"))["stations"]}
    entries = {e["label"]: e for e in S.load_table()["entries"]}
    out = {"schema": "raw-surf.mop-reference-diagnostic.v1", "sites": {}}
    for sid, label in SITES.items():
        site = {"label": label, "datasets": [], "coverage": {}}
        its = rd.pairs(wins, stations, sid)
        if not its:
            out["sites"][sid] = dict(site, reading="INCONCLUSIVE (no pairs)")
            continue
        a = stations[sid]["anchor_spot"]
        geo = resolve_surf_geometry(float(a["lat"]), float(a["lng"]))
        t0 = min(i["t"] for i in its).timestamp() - 7200
        t1 = max(i["t"] for i in its).timestamp() + 7200
        ref = {}
        try:
            site["datasets"] = datasets(label)
        except Exception as e:                              # noqa: BLE001 - reported
            site["catalog_error"] = f"{type(e).__name__}: {e}"[:200]
        for path in site["datasets"]:
            if not any(k in path for k in ("hindcast", "nowcast")):
                continue
            try:
                s, n, span = series(path, t0, t1)
                site["coverage"][path] = {"in_window": len(s), "records": n, "span": span}
                for t, v in s.items():
                    ref.setdefault(t, v)
            except Exception as e:                          # noqa: BLE001 - reported
                site["coverage"][path] = {"error": f"{type(e).__name__}: {e}"[:200]}
        rows = []
        keys = sorted(ref)
        for i in its:
            t = i["t"].timestamp()
            near = min(keys, key=lambda k: abs(k - t)) if keys else None
            if near is None or abs(near - t) > TOL_S:
                continue
            hs, tp, _ = ref[near]
            if hs is None or tp is None or hs < 0 or tp <= 0:
                continue
            hb = mop_ref_hb(hs, tp, entries[label], geo)
            if hb is not None and math.isfinite(hb):
                rows.append(dict(i, mop_hb=hb))
        site["pairs_with_reference"] = len(rows)

        def stat(rs):
            if not rs:
                return {"n": 0}
            n = len(rs)
            return {"n": n,
                    "served_minus_mop": round(sum(r["f_ref"] - r["mop_hb"] for r in rs) / n, 3),
                    "k_minus_mop": round(sum(r["f_cand"] - r["mop_hb"] for r in rs) / n, 3),
                    "proxy_minus_mop": round(sum(r["obs"] - r["mop_hb"] for r in rs) / n, 3),
                    "mae_served_vs_mop": round(sum(abs(r["f_ref"] - r["mop_hb"]) for r in rs) / n, 3),
                    "mae_k_vs_mop": round(sum(abs(r["f_cand"] - r["mop_hb"]) for r in rs) / n, 3)}
        site["all"] = stat(rows)
        site["by_k_ratio"] = {name: stat([r for r in rows if r["ratio"] is not None and lo <= r["ratio"] < hi])
                              for lo, hi, name in rd.RATIO_BINS}
        site["reading"] = reading(site)
        out["sites"][sid] = site
    return out


def reading(site):
    if site.get("pairs_with_reference", 0) < 200:
        return "INCONCLUSIVE (fewer than 200 pairs with a MOP reference)"
    b = site["by_k_ratio"]
    ok = [v for v in b.values() if v.get("n")]
    if ok and all(abs(v["k_minus_mop"]) <= 0.15 for v in ok):
        return "K MATCHES the MOP reference: the proxy misled the Rodeo verdict"
    ex, sh = b.get("exposed>=0.8", {}), b.get("shadowed<0.6", {})
    if ex.get("n") and sh.get("n") and ex["k_minus_mop"] > 0.15 and sh["k_minus_mop"] < -0.15:
        return "GFS INPUT DEFECT: K is high where exposed and low where shadowed against CDIP's own reference"
    return "INCONCLUSIVE"


def markdown(res):
    L = ["## MOP reference diagnostic (CDIP buoy-driven MOP at the spot's MOP point, same breaking step)", ""]
    for sid, s in res["sites"].items():
        L += [f"### {sid} -> {s['label']}: **{s.get('reading')}** (pairs with a reference: {s.get('pairs_with_reference')})",
              "", "datasets: " + ", ".join(s.get("datasets") or []) + (f" catalog error: {s['catalog_error']}"
                                                                      if s.get("catalog_error") else ""),
              "coverage: " + json.dumps(s.get("coverage")), "",
              "| bin | n | served - MOP | K - MOP | proxy - MOP | MAE served | MAE K |", "|---|---|---|---|---|---|---|"]
        for name, v in [("all", s.get("all", {}))] + list((s.get("by_k_ratio") or {}).items()):
            L.append(f"| {name} | {v.get('n')} | {v.get('served_minus_mop')} | {v.get('k_minus_mop')} | "
                     f"{v.get('proxy_minus_mop')} | {v.get('mae_served_vs_mop')} | {v.get('mae_k_vs_mop')} |")
        L.append("")
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--win", action="append", required=True)
    ap.add_argument("--stations", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run([tuple(w.split("=", 1)) for w in a.win], a.stations)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=1, default=str)
    print(markdown(res))
    print("MOPREF_JSON_BEGIN")
    print(json.dumps(res, default=str))
    print("MOPREF_JSON_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
