"""marine_layer_identity_audit.py — does every marine layer carry ITS OWN direction?

USER REQUIREMENT (2026-07-31): "This logic needs to work for GFS waves, EURO waves, ICON waves.
The other marine layers need their respective animation direction to go with the type of marine
layer they represent."

That is an IDENTITY contract, and nothing in the repo tested it end to end. A layer can fail it
three ways, and this audit separates them:

  CROSS-WIRED   the layer is served a DIFFERENT partition's variables. Known live example:
                `point_resolution` maps ICON swell_2 -> swell_wave_* (swell 1's variables), so
                ICON "Swell 2" is Swell 1 wearing a different label.
  COLLAPSED     two layers return byte-identical values, i.e. one of them carries no independent
                information (detected WITHOUT upstream, so it works even where upstream is silent).
  DRIFTED       the layer matches its own upstream variable in NAME but not in VALUE.

METHOD. For every (model, layer, coordinate) it fetches our served point and the full upstream
payload, then asks which upstream field our direction ACTUALLY matches. Points are chosen in open
ocean with real energy because the swell partition is measurably NOISE below ~0.6 m (measured
2026-07-30: mean |direction error| 35 deg under 0.6 m vs 4.5 deg above it) — testing identity
inside the noise band would produce false alarms.

Read-only: production point API + Open-Meteo upstream. No credentials, no writes.
Usage (from backend/):  python scripts/marine_layer_identity_audit.py [--json]
Exit 1 if any CROSS-WIRED or COLLAPSED layer is found (so CI can gate on it).
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
PAUSE_S = 0.05

# Open ocean, chosen for real partition energy — identity must be tested above the noise floor.
POINTS = [
    ("n_pacific", 40.0, -150.0),
    ("n_atlantic", 45.0, -30.0),
    ("s_ocean", -50.0, 100.0),
    ("s_pacific", -40.0, -120.0),
    ("indian", -30.0, 80.0),
    ("eq_pacific", -2.0, -132.0),
]

LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
MODELS = ("GFS", "EURO", "ICON")
UPSTREAM_MODEL = {"GFS": "ncep_gfswave025", "EURO": "ecmwf_wam025", "ICON": "gwam"}

# The upstream variable family each layer is CONTRACTED to represent.
LAYER_TO_FAMILY = {
    "waves": "wave",
    "swell_1": "swell_wave",
    "swell_2": "secondary_swell_wave",
    "wind_waves": "wind_wave",
}
FAMILIES = ("wave", "swell_wave", "secondary_swell_wave", "wind_wave")
ALL_VARS = ",".join(f"{f}_{s}" for f in FAMILIES for s in ("height", "direction", "period"))


def compass(d):
    if d is None:
        return "?"
    p = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
         "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return p[int((d / 22.5) + 0.5) % 16]


def angdiff(a, b):
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def lattice_hour():
    t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return (t - timedelta(hours=t.hour % 3)).strftime("%Y-%m-%dT%H:%M:%SZ")


def our_point(model, layer, lat, lng, vt):
    qs = urllib.parse.urlencode({"model": model, "domain": "marine", "layer": layer,
                                 "lat": lat, "lng": lng, "valid_time": vt})
    try:
        with urllib.request.urlopen(f"{BASE}/api/weather/point?{qs}", timeout=45) as r:
            j = json.loads(r.read())
    except Exception:
        return None
    finally:
        time.sleep(PAUSE_S)
    p = j.get("point") or {}
    if p.get("speed") is None:
        return None
    return {"h": p.get("speed"), "dir": p.get("direction"), "tp": p.get("period"),
            "estimated": j.get("is_estimated"),
            "basis": (j.get("estimate_basis") or {}).get("method"),
            "vars": j.get("source_variables") or []}


def upstream(model, lat, lng):
    qs = urllib.parse.urlencode({
        "latitude": lat, "longitude": lng, "hourly": ALL_VARS,
        "models": UPSTREAM_MODEL[model],
        "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "end_date": (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")})
    try:
        with urllib.request.urlopen("https://marine-api.open-meteo.com/v1/marine?" + qs, timeout=45) as r:
            h = (json.loads(r.read()) or {}).get("hourly") or {}
    except Exception:
        return None
    finally:
        time.sleep(PAUSE_S)
    out = {}
    for f in FAMILIES:
        out[f] = {"h": (h.get(f + "_height") or [None])[0],
                  "dir": (h.get(f + "_direction") or [None])[0],
                  "tp": (h.get(f + "_period") or [None])[0]}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    vt = lattice_hour()
    print(f"marine layer IDENTITY audit | {vt} | {BASE}")
    findings = []
    rows = []

    for model in MODELS:
        print(f"\n{'=' * 78}\n{model}\n{'=' * 78}")
        for tag, lat, lng in POINTS:
            served = {}
            for layer in LAYERS:
                r = our_point(model, layer, lat, lng, vt)
                if r:
                    served[layer] = r
            if not served:
                continue
            us = upstream(model, lat, lng)

            # --- COLLAPSED: two of our own layers identical (needs no upstream at all) ---
            names = sorted(served)
            for i in range(len(names)):
                for jx in range(i + 1, len(names)):
                    a, b = served[names[i]], served[names[jx]]
                    if (a["h"] is not None and a["h"] == b["h"]
                            and a["dir"] == b["dir"] and a["tp"] == b["tp"] and a["h"] > 0):
                        findings.append({
                            "kind": "COLLAPSED", "model": model, "point": tag,
                            "detail": f"{names[i]} and {names[jx]} are byte-identical "
                                      f"(h={a['h']} dir={a['dir']} tp={a['tp']})"})

            print(f"\n  {tag} ({lat},{lng})")
            for layer in LAYERS:
                r = served.get(layer)
                if not r:
                    print(f"    {layer:11s} (no data)")
                    continue
                own = LAYER_TO_FAMILY[layer]
                line = (f"    {layer:11s} ours h={r['h']:.3f} dir={(r['dir'] or 0):6.1f} "
                        f"({compass(r['dir'])}) tp={r['tp']}")
                if r["basis"]:
                    line += f"  [{r['basis'][:26]}]"
                print(line)

                if not us:
                    continue
                # --- which upstream family does our DIRECTION actually match? ---
                best_f, best_d = None, 1e9
                for f in FAMILIES:
                    uf = us[f]
                    if uf["dir"] is None or uf["h"] is None or uf["h"] <= 0:
                        continue
                    d = angdiff(r["dir"], uf["dir"])
                    if d is not None and d < best_d:
                        best_d, best_f = d, f
                own_u = us.get(own) or {}
                own_d = angdiff(r["dir"], own_u.get("dir"))
                own_txt = f"{own_d:.1f}" if own_d is not None else "n/a"
                match_txt = f"{best_f}@{best_d:.1f}deg" if best_f else "nothing"
                print(f"      -> contracted family '{own}' delta={own_txt} deg | "
                      f"closest upstream: {match_txt}")
                rows.append({"model": model, "layer": layer, "point": tag,
                             "own_delta": own_d, "closest": best_f, "closest_delta": best_d
                             if best_f else None, "ours_h": r["h"], "basis": r["basis"]})

                # CROSS-WIRED: a DIFFERENT family matches far better than the contracted one,
                # and there is real energy in the layer (above the partition noise floor).
                if (best_f and best_f != own and own_d is not None
                        and (r["h"] or 0) >= 0.6 and own_d > 30.0 and best_d + 25.0 < own_d):
                    findings.append({
                        "kind": "CROSS-WIRED", "model": model, "point": tag,
                        "detail": f"{layer} matches upstream '{best_f}' ({best_d:.1f} deg) far "
                                  f"better than its own '{own}' ({own_d:.1f} deg)"})
                elif (own_d is not None and own_d > 30.0 and (r["h"] or 0) >= 0.6):
                    findings.append({
                        "kind": "DRIFTED", "model": model, "point": tag,
                        "detail": f"{layer} is {own_d:.1f} deg off its own upstream '{own}' "
                                  f"at h={r['h']:.2f} m (above the 0.6 m noise floor)"})

    print(f"\n{'=' * 78}\nFINDINGS\n{'=' * 78}")
    hard = [f for f in findings if f["kind"] in ("CROSS-WIRED", "COLLAPSED")]
    seen = set()
    for f in findings:
        key = (f["kind"], f["model"], f["detail"])
        if key in seen:
            continue
        seen.add(key)
        print(f"  [{f['kind']:11s}] {f['model']:5s} {f['point']:11s} {f['detail']}")
    if not findings:
        print("  none — every layer carries its own direction")

    print("\n  per model/layer: mean |delta| vs its OWN contracted upstream family")
    for model in MODELS:
        for layer in LAYERS:
            ds = [r["own_delta"] for r in rows
                  if r["model"] == model and r["layer"] == layer and r["own_delta"] is not None]
            if ds:
                print(f"    {model:5s} {layer:11s} n={len(ds)}  mean={sum(ds)/len(ds):6.1f} deg  "
                      f"max={max(ds):6.1f}")

    if args.json:
        print(json.dumps({"findings": findings, "rows": rows}, indent=1))
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
