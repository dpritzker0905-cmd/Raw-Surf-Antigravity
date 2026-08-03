"""backend/scripts/directional_exposure_probe.py — IS THE COSINE EXPOSURE MODEL RIGHT AT THIS SPOT?

THE QUESTION
------------
`surf_rating.swell_exposure(swell_from, shore_normal) = clamp(0.10 + 0.90*max(0, cos dtheta))`.
Every bearing 90 deg or more off the shore normal returns **0.10 — an entire half-plane**, not a
rare protective clamp. Measured live 2026-08-03 (n=200): 48 spots (24%) sit at exactly 0.10, with a
median score of 3.8 against 21.1 for everyone else, and 35 of those 48 have FULL geometry — so this
is not mainly the 38% degraded shore normals. Among them: Arugam Bay Main Point reading 3.9 on
5.1 ft / 10 s / 15 kt OFFSHORE, and Namotu Lefts reading 4.4 on 6.4 ft / 11 s / 16 kt offshore.

A cosine about a single shore normal is a STRAIGHT BEACH model. Point breaks and headland setups
work because swell REFRACTS and WRAPS — Arugam's season is May-September precisely because
Southern-Ocean SW swell bends around Sri Lanka's southern tip into east-facing points. That
geometry is exactly what a half-plane cutoff cannot express.

⭐ WHY ERA5 SETTLES IT AND AN ARGUMENT DOES NOT. 47 years of hourly (Hs, Tm, direction) at the spot,
put through the SAME production geometry chain the app serves from, answers empirically: **of the
biggest waves this spot has ever received, what fraction arrive from bearings the engine floors?**
If a spot's best days are systematically floored, the exposure model is wrong THERE — and that is a
measurement, not a story about refraction.

THE CONTROL (this probe is refutable)
-------------------------------------
Pass `--control-lat/--control-lng` for a spot whose exposure the cosine SHOULD get right — an open
beach facing its swell window. If the control ALSO reports its best days floored, the probe is
measuring something broken in itself (a wrong shore normal convention, a direction-frame error)
rather than a defect in the exposure model. A probe that cannot come back "the model is fine here"
is not evidence.

THE REFUSAL
-----------
Voids rather than answers when:
  * geometry does not resolve, or carries no shore normal — with no normal there is no dtheta and
    `swell_exposure` returns 1.0 by contract, so the question is undefined rather than answered;
  * fewer than `--min-samples` finite samples survive.

USAGE
    python scripts/directional_exposure_probe.py --lat 6.84 --lng 81.84 --name "Arugam Bay" \
        --control-lat 43.66 --control-lng -1.44 --control-name "Hossegor"
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FLOOR = 0.10


def _pct(v, q):
    if not v:
        return float("nan")
    s = sorted(v)
    return s[max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))]


def _shore_normal(geo):
    """The seaward normal, whatever the geometry object calls it. None when absent."""
    if geo is None:
        return None
    for attr in ("shore_normal_deg", "shore_normal", "normal_deg"):
        v = getattr(geo, attr, None) if not isinstance(geo, dict) else geo.get(attr)
        if v is not None:
            try:
                return float(v)
            except Exception:
                continue
    return None


def probe(lat, lng, label, end_date, min_samples, client=None):
    import numpy as np

    from scripts.era5_deepen_climatology import _cds, fetch_timeseries, fetch_tp_tm_ratio
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    from services.weather_pipeline.surf_rating import swell_exposure

    client = client or _cds()
    geo = resolve_surf_geometry(float(lat), float(lng))
    normal = _shore_normal(geo)
    if geo is None or normal is None:
        raise RuntimeError(
            f"VOID [{label}]: no shore normal resolved. `swell_exposure` returns 1.0 by contract "
            f"when the normal is unknown, so there is no dtheta to characterise.")

    swh, mwp, mwd = fetch_timeseries(client, lat, lng, end_date)
    ratio, ratio_n = fetch_tp_tm_ratio(client, lat, lng)

    rows = []
    for i in range(0, len(swh), 3):
        h, p, d = float(swh[i]), float(mwp[i]), float(mwd[i])
        if not (np.isfinite(h) and np.isfinite(p) and np.isfinite(d)) or h <= 0 or p <= 0:
            continue
        tp = p * ratio
        try:
            breaking, _ = estimate_surf_at(lat, lng, h, tp, swell_from_deg=d, geometry=geo)
        except Exception:
            breaking = None
        if breaking is None:
            continue
        exp = swell_exposure(d, normal)
        dtheta = abs(((d - normal + 180.0) % 360.0) - 180.0)
        rows.append((float(breaking), float(exp), float(dtheta), d))

    if len(rows) < min_samples:
        raise RuntimeError(f"VOID [{label}]: only {len(rows)} usable samples (< {min_samples}).")

    rows.sort(key=lambda r: -r[0])
    n = len(rows)
    floored = [r for r in rows if r[1] <= FLOOR + 1e-9]
    top10 = rows[: max(1, n // 10)]                 # the biggest decile — the days that matter
    top1 = rows[: max(1, n // 100)]
    top10_floored = [r for r in top10 if r[1] <= FLOOR + 1e-9]
    top1_floored = [r for r in top1 if r[1] <= FLOOR + 1e-9]

    # Which bearings actually deliver this spot's biggest surf, in 30-degree bins.
    bins = Counter(int(r[3] // 30) * 30 for r in top10)
    return {
        "label": label, "lat": lat, "lng": lng,
        "shore_normal_deg": round(normal, 1),
        "tp_tm_ratio": round(ratio, 3), "ratio_n": ratio_n,
        "n_samples": n, "years_approx": round(n * 3 / 8766.0, 1),
        "breaking_m": {"p50": round(_pct([r[0] for r in rows], .5), 2),
                       "p90": round(_pct([r[0] for r in rows], .9), 2),
                       "max": round(rows[0][0], 2)},
        "floored_all_frac": round(len(floored) / n, 4),
        "floored_top_decile_frac": round(len(top10_floored) / len(top10), 4),
        "floored_top_percentile_frac": round(len(top1_floored) / len(top1), 4),
        "median_dtheta_top_decile": round(_pct([r[2] for r in top10], .5), 1),
        "top_decile_bearing_bins": dict(sorted(bins.items(), key=lambda kv: -kv[1])[:6]),
        "biggest_10_samples": [{"breaking_m": round(r[0], 2), "swell_from": round(r[3], 1),
                                "dtheta": round(r[2], 1), "exposure": round(r[1], 3)}
                               for r in rows[:10]],
    }


def run_batch(spots, control, min_samples, out_path):
    """Probe many spots, WRITING AFTER EACH ONE.

    ★ BANK AS YOU EARN. Each spot is two CDS requests (~78 s, and CDS queueing has been measured at
    ~6 min/spot when congested), so a 12-spot batch is a long job. A run that writes only at the end
    is worth 0% at 92% complete — the same lesson `era5_deepen_climatology` already learned the hard
    way. Partial output is a real answer here: the question is a RATE across spots, and 7 spots
    answer it less precisely but not less honestly.
    """
    from scripts.era5_deepen_climatology import _cds
    client = _cds()
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = {"control": None, "spots": []}

    if control:
        try:
            out["control"] = probe(control["lat"], control["lng"], control["name"],
                                   end_date, min_samples, client)
            c = out["control"]
            print(f"CONTROL {c['label']}: floored_top_decile={c['floored_top_decile_frac']:.1%} "
                  f"(expect ~0% — if this is high the probe is broken, not the model)", flush=True)
        except RuntimeError as e:
            out["control"] = {"void": str(e)}
            print(f"CONTROL VOID: {e}", flush=True)

    for i, s in enumerate(spots):
        try:
            r = probe(s["lat"], s["lng"], s["name"], end_date, min_samples, client)
        except RuntimeError as e:
            r = {"label": s["name"], "void": str(e)}
            print(f"  [{i+1}/{len(spots)}] {s['name']}: VOID — {str(e)[:90]}", flush=True)
        else:
            r["served_score"] = s.get("served_score")
            r["readiness"] = s.get("readiness")
            verdict = ("MODEL LOOKS WRONG HERE" if r["floored_top_decile_frac"] >= 0.5
                       else "off-direction hour" if r["floored_top_decile_frac"] < 0.15
                       else "MIXED")
            print(f"  [{i+1}/{len(spots)}] {s['name'][:30]:30s} served={s.get('served_score')} "
                  f"floored_all={r['floored_all_frac']:>6.1%} "
                  f"TOP_DECILE={r['floored_top_decile_frac']:>6.1%}  {verdict}", flush=True)
        out["spots"].append(r)
        if out_path:                                   # write after EVERY spot
            with open(out_path, "w", encoding="utf-8") as fh:
                json.dump(out, fh, indent=2)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots-file", default=None,
                    help="JSON list of {name,lat,lng,...} — batch mode; writes after each spot")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lng", type=float)
    ap.add_argument("--name", default="subject")
    ap.add_argument("--control-lat", type=float, default=None)
    ap.add_argument("--control-lng", type=float, default=None)
    ap.add_argument("--control-name", default="control")
    ap.add_argument("--min-samples", type=int, default=5000)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    if a.spots_file:
        spots = json.load(open(a.spots_file, encoding="utf-8"))
        control = ({"lat": a.control_lat, "lng": a.control_lng, "name": a.control_name}
                   if a.control_lat is not None and a.control_lng is not None else None)
        res = run_batch(spots, control, a.min_samples, a.json)
        done = [r for r in res["spots"] if "void" not in r]
        if not done:
            print("VOID: every spot voided.", file=sys.stderr)
            return 2
        broken = [r for r in done if r["floored_top_decile_frac"] >= 0.5]
        clear = [r for r in done if r["floored_top_decile_frac"] < 0.15]
        print(f"\nVERDICT over {len(done)} floored spots, each against its own ~47-year record:")
        print(f"  best decile MOSTLY floored (model looks wrong there): {len(broken)} "
              f"({len(broken)/len(done):.0%})")
        print(f"  best decile CLEAR (today was just an off-direction hour): {len(clear)} "
              f"({len(clear)/len(done):.0%})")
        print(f"  mixed: {len(done)-len(broken)-len(clear)}")
        return 0

    if a.lat is None or a.lng is None:
        ap.error("give --lat/--lng, or --spots-file for batch mode")
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = {}
    from scripts.era5_deepen_climatology import _cds
    client = _cds()

    try:
        out["subject"] = probe(a.lat, a.lng, a.name, end_date, a.min_samples, client)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    if a.control_lat is not None and a.control_lng is not None:
        try:
            out["control"] = probe(a.control_lat, a.control_lng, a.control_name,
                                   end_date, a.min_samples, client)
        except RuntimeError as e:
            out["control"] = {"void": str(e)}

    print(json.dumps(out, indent=2))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
