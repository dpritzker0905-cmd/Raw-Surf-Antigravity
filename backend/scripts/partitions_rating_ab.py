"""partitions_rating_ab.py — the swept A/B for SURF_PARTITIONS before any flip (queue #13).

WHAT THIS MEASURES (the flip's decision inputs), against LIVE production data:
  1. THE PRODUCT EFFECT: for a worldwide spot sample, the rating with vs without partitions —
     score deltas, LEVEL-change %, height deltas — both lanes computed locally through the REAL
     chain (resolve_surf_geometry -> estimate_surf_at -> compute_surf_rating), so the only
     difference between the lanes is the partitions.
  2. RECONCILE DIAGNOSTICS: |quadrature-total|/total distribution (the +6.2% invention guard's
     input — refreshes the 07-29 median-9.5% number).
  3. THE LIVE-LANE COST: per-layer fetch timing for swell_1/swell_2/wind_waves (what a serve-box
     point request would add; refreshes the 0.17-0.77 s/layer 07-29 numbers).
  4. A PARITY CROSS-CHECK: our local flag-OFF height vs the height production actually served
     (same coordinate, same hour) — if these drift, the A/B is measuring the wrong baseline.

WHAT IT DOES NOT MEASURE: the PRECOMPUTE's CPU sampling cost on the CI runner (products are local
files there; this machine has none). It reports the resolution-count arithmetic instead: the flag
takes each marine point from 1 resolution to 4, so the precompute's marine sampling work is ~4x.

Zero credentials; read-only against the public API; sequential requests with a small pause (the
serve box is 1-CPU with a melt history). ASCII-only output (Windows cp1252 console).
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
MODEL = "GFS"
KT_TO_MS = 0.514444
PAUSE_S = 0.05
LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]

# Diverse regional viewports (w,s,e,n) — the spot list comes from the API, never from memory.
REGIONS = [
    ("california", (-123.2, 32.5, -117.0, 38.5)),
    ("florida", (-81.7, 26.0, -80.0, 30.5)),
    ("hawaii", (-158.4, 21.2, -157.6, 21.8)),
    ("portugal", (-9.7, 37.0, -8.5, 41.5)),
    ("france", (-2.0, 43.2, -1.2, 44.8)),
    ("aus_east", (151.0, -34.5, 153.7, -27.0)),
    ("south_africa", (18.0, -34.5, 25.8, -33.5)),
    ("morocco", (-10.0, 30.0, -9.0, 31.5)),
]
SPOTS_PER_REGION = 5
HOUR_OFFSETS = (0, 24)


def _get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def lattice_hour(offset_h=0):
    t = datetime.now(timezone.utc) + timedelta(hours=offset_h)
    t = t.replace(minute=0, second=0, microsecond=0)
    t -= timedelta(hours=t.hour % 3)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_spots():
    spots, seen = [], set()
    vt = lattice_hour(0)
    for name, (w, s, e, n) in REGIONS:
        qs = urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "valid_time": vt,
                                     "model": MODEL, "limit": SPOTS_PER_REGION})
        try:
            out = _get(f"{BASE}/api/weather/spot-ratings?{qs}")
        except Exception as ex:
            print(f"  [{name}] spot fetch failed: {ex}")
            continue
        for sp in out.get("spots", []):
            sid = sp.get("spot_id")
            if sid and sid not in seen and sp.get("latitude") is not None:
                seen.add(sid)
                spots.append({"id": sid, "name": sp.get("name"), "lat": sp["latitude"],
                              "lng": sp["longitude"], "region": name})
        time.sleep(PAUSE_S)
    return spots


def fetch_point(layer, lat, lng, vt, domain="marine", timings=None):
    qs = urllib.parse.urlencode({"model": MODEL, "domain": domain, "layer": layer,
                                 "lat": lat, "lng": lng, "valid_time": vt})
    t0 = time.time()
    try:
        out = _get(f"{BASE}/api/weather/point?{qs}")
    except Exception:
        return None
    finally:
        if timings is not None:
            timings.setdefault(layer, []).append(time.time() - t0)
        time.sleep(PAUSE_S)
    return out


def pct(vals, q):
    if not vals:
        return None
    v = sorted(vals)
    i = min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))
    return v[i]


def main():
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    from services.weather_pipeline.surf_rating import compute_surf_rating, score_to_level
    from services.weather_pipeline.surf_transform import reconcile_partitions

    print(f"partitions A/B against {BASE} ({MODEL})")
    spots = fetch_spots()
    print(f"spot sample: {len(spots)} spots across {len(REGIONS)} regions\n")
    if not spots:
        return 1

    timings = {}
    rows = []
    mismatches = []           # |quad-total|/total per evaluation
    parity_drift = []         # local flag-off height vs served surf_height_m (ft-rounded compare)

    for sp in spots:
        geo = None
        try:
            geo = resolve_surf_geometry(sp["lat"], sp["lng"])
        except Exception as ex:
            print(f"  {sp['name']}: geometry failed ({ex}); skipped")
            continue
        for off in HOUR_OFFSETS:
            vt = lattice_hour(off)
            waves = fetch_point("waves", sp["lat"], sp["lng"], vt)
            wpt = (waves or {}).get("point") or {}
            hs, tp = wpt.get("speed"), wpt.get("period")
            sdir = wpt.get("direction")
            if not hs or not tp:
                continue
            wind = fetch_point("wind", sp["lat"], sp["lng"], vt, domain="wind")
            wnd = (wind or {}).get("point") or {}
            wind_ms = (wnd.get("speed") or 0.0) * KT_TO_MS
            wind_from = wnd.get("direction")

            parts_raw = []
            for layer, kind in (("swell_1", "swell"), ("swell_2", "swell"),
                                ("wind_waves", "windsea")):
                r = fetch_point(layer, sp["lat"], sp["lng"], vt, timings=timings)
                p = (r or {}).get("point") or {}
                h, ptp = p.get("speed"), p.get("period")
                if h and ptp and h > 0 and ptp > 0:
                    parts_raw.append({"h": float(h), "tp": float(ptp),
                                      "dir": p.get("direction"), "kind": kind})

            # OFF lane — exactly production today.
            h_off, _ = estimate_surf_at(sp["lat"], sp["lng"], hs, tp, swell_from_deg=sdir,
                                        geometry=geo)
            served = (waves or {}).get("surf_height_m")
            if h_off is not None and served is not None and served > 0:
                parity_drift.append(abs(h_off - served) / served)

            parts = None
            if parts_raw:
                quad = math.sqrt(sum(p["h"] ** 2 for p in parts_raw))
                if hs > 0:
                    mismatches.append(abs(quad - hs) / hs)
                parts = reconcile_partitions(parts_raw, hs)

            h_on = h_off
            if parts:
                h_maybe, _ = estimate_surf_at(sp["lat"], sp["lng"], hs, tp, swell_from_deg=sdir,
                                              geometry=geo, partitions=parts)
                if h_maybe is not None:
                    h_on = h_maybe

            def _rate(height, plist):
                s, _l = compute_surf_rating(
                    height, tp, wind_ms,
                    wind_from_deg=wind_from,
                    shore_normal_deg=geo.shore_normal_deg,
                    swell_from_deg=sdir,
                    partitions=plist,
                    break_depth_m=geo.break_depth_m)
                return s

            s_off = _rate(h_off, None)
            s_on = _rate(h_on, parts)
            if s_off is None or s_on is None:
                continue
            ww = [p for p in (parts or []) if p["kind"] == "windsea"]
            ww_frac = (sum(p["h"] ** 2 for p in ww) / sum(p["h"] ** 2 for p in parts)
                       if parts else 0.0)
            rows.append({"name": sp["name"], "region": sp["region"], "vt": vt,
                         "h_off": h_off, "h_on": h_on,
                         "s_off": s_off, "s_on": s_on,
                         "l_off": score_to_level(s_off), "l_on": score_to_level(s_on),
                         "n_trains": len(parts or []), "windsea_frac": round(ww_frac, 3)})

    if not rows:
        print("no rated evaluations - aborting")
        return 1

    dh = [(r["h_on"] - r["h_off"]) / r["h_off"] * 100 for r in rows if r["h_off"]]
    ds = [r["s_on"] - r["s_off"] for r in rows]
    level_moved = [r for r in rows if r["l_on"] != r["l_off"]]

    print(f"\n== PRODUCT EFFECT ({len(rows)} spot-hour evaluations) ==")
    print(f"height delta %%: median {pct(dh,0.5):+.1f}  p10 {pct(dh,0.1):+.1f}  "
          f"p90 {pct(dh,0.9):+.1f}  min {min(dh):+.1f}  max {max(dh):+.1f}")
    print(f"score delta:    median {pct(ds,0.5):+.1f}  p10 {pct(ds,0.1):+.1f}  "
          f"p90 {pct(ds,0.9):+.1f}  min {min(ds):+.1f}  max {max(ds):+.1f}")
    print(f"LEVEL changes:  {len(level_moved)}/{len(rows)} "
          f"({100.0*len(level_moved)/len(rows):.1f}%)")
    up = sum(1 for r in level_moved if LEVELS.index(r["l_on"]) > LEVELS.index(r["l_off"]))
    print(f"   up {up} / down {len(level_moved)-up}")

    print("\nbiggest movers (|score delta|):")
    for r in sorted(rows, key=lambda r: -abs(r["s_on"] - r["s_off"]))[:12]:
        print(f"  {r['name'][:28]:28s} {r['vt'][5:13]}  "
              f"h {r['h_off']:.2f}->{r['h_on']:.2f} m  "
              f"score {r['s_off']:5.1f}->{r['s_on']:5.1f}  {r['l_off']}->{r['l_on']}  "
              f"trains {r['n_trains']} windsea {r['windsea_frac']:.2f}")

    print(f"\n== RECONCILE DIAGNOSTICS ({len(mismatches)} evaluations) ==")
    if mismatches:
        m = [x * 100 for x in mismatches]
        print(f"|quad-total|/total %%: median {pct(m,0.5):.1f}  p90 {pct(m,0.9):.1f}  "
              f"max {max(m):.1f}")

    print("\n== LIVE-LANE COST (per extra layer fetch, seconds) ==")
    for layer in ("swell_1", "swell_2", "wind_waves"):
        t = timings.get(layer) or []
        if t:
            print(f"  {layer:10s} n={len(t):3d}  median {pct(t,0.5):.2f}  "
                  f"p90 {pct(t,0.9):.2f}  max {max(t):.2f}")
    print("  (the PRECOMPUTE samples local grids instead - its cost is the count arithmetic:")
    print("   each marine point goes from 1 resolution to 4, so marine sampling work is ~4x.)")

    print(f"\n== PARITY CROSS-CHECK (local flag-off height vs served, {len(parity_drift)} pts) ==")
    if parity_drift:
        d = [x * 100 for x in parity_drift]
        print(f"  |local-served|/served %%: median {pct(d,0.5):.2f}  p90 {pct(d,0.9):.2f}  "
              f"max {max(d):.2f}")
        print("  (should be ~0; drift means the A/B baseline is not what production serves)")

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                            "partitions_ab_results.json")
    out_path = os.environ.get("PARTITIONS_AB_OUT", out_path)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": datetime.now(timezone.utc).isoformat(), "base": BASE,
                   "model": MODEL, "rows": rows,
                   "reconcile_mismatch": mismatches,
                   "timings": {k: v for k, v in timings.items()},
                   "parity_drift": parity_drift}, fh, indent=1)
    print(f"\nfull results -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
