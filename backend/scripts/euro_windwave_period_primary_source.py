"""backend/scripts/euro_windwave_period_primary_source.py — IS OUR EURO WIND-WAVE PERIOD OURS OR
UPSTREAM'S?

THE DEFECT UNDER ATTRIBUTION. `wave_physics_validity_census.py` measured our served EURO
`wind_waves` layer returning (H, T) pairs that cannot exist -- 10 of 30 spots above the 1/7 deep-water
steepness limit, e.g. Nusa Dua H=0.591 m at T=1.00 s (steepness 0.38, ~2.7x the breaking limit).
GFS and ICON were clean across 210 samples, so it is one lane and one layer.

Two rival causes, and only the upstream can separate them:
  A. UPSTREAM. ECMWF WAM itself publishes these numbers and we relay them faithfully. Then the fix
     is a validity filter at ingest, and possibly not serving the layer for this model at all.
  B. OURS. The value is mangled somewhere between the upstream fetch and the served point -- a wrong
     variable mapped to the period channel, a unit error, or a texture/grid encode-decode mismatch
     (the marine texture packs period/20 into a channel, which is exactly the kind of asymmetry that
     survives a round trip looking like a plausible small number).

⭐ THIS IS THE PRIMARY-SOURCE RULE APPLIED TO DATA RATHER THAN TO A CONSTANT. Our own grid is a
DERIVED artifact; asking it what upstream said is circular. Open-Meteo's marine endpoint is the
actual origin of this lane, is free, and needs no key -- so the comparison costs one request.

WHAT IS COMPARED, at the identical coordinate and hour:
  ours      GET /api/weather/point?model=EURO&domain=marine&layer=wind_waves   -> point.period
  upstream  GET marine-api.open-meteo.com/v1/marine ... &models=ecmwf_wam025   -> wind_wave_period

THE CONTROL. The same comparison is run for the `waves` (total) layer, which the physics census found
CLEAN in this lane. If `waves` matches upstream while `wind_waves` does not, the transport is proven
sound and the fault is specific to the wind-wave channel. If BOTH diverge, the fault is in the
transport for the whole lane. If NEITHER diverges, our served value is upstream's and cause A holds.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

OURS = "https://raw-surf-antigravity.onrender.com/api/weather"
UPSTREAM = "https://marine-api.open-meteo.com/v1/marine"
STEEP_LIMIT = 1.0 / 7.0


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            return json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return {"_err": str(e)[:160]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="115,-10,145,25")
    ap.add_argument("--names", default="Nusa Dua,Canggu - Old Mans,Vanimo")
    ap.add_argument("--valid-time", default=None)
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    want = [n.strip().lower() for n in a.names.split(",") if n.strip()]

    p = _get(f"{OURS}/spot-ratings?bbox={a.bbox}&valid_time={vt}&model=GFS&limit=200")
    if "_err" in p:
        print(f"VOID: spot fetch failed: {p['_err']}", file=sys.stderr)
        return 2
    spots = []
    for s in p.get("spots") or []:
        nm = (s.get("name") or "").lower()
        if any(w in nm for w in want):
            spots.append((s.get("name"), s.get("latitude"), s.get("longitude")))
    if not spots:
        print("VOID: none of the named spots are served in this bbox/hour.", file=sys.stderr)
        return 2

    hour_iso = vt.replace("Z", "")
    print(f"valid_time {vt}\n")
    print(f"{'spot':<20s} {'layer':<11s} {'ours H':>7s} {'ours T':>7s} {'up H':>7s} {'up T':>7s} "
          f"{'dT':>7s}  verdict")
    divergent = {"waves": 0, "wind_waves": 0}
    checked = {"waves": 0, "wind_waves": 0}

    for nm, lat, lng in spots:
        up = _get(f"{UPSTREAM}?latitude={lat}&longitude={lng}"
                  f"&hourly=wave_height,wave_period,wind_wave_height,wind_wave_period"
                  f"&models=ecmwf_wam025&forecast_days=2")
        if "_err" in up:
            print(f"  {str(nm)[:20]:<20s} UPSTREAM ERROR: {up['_err']}")
            continue
        hrs = (up.get("hourly") or {})
        times = hrs.get("time") or []
        try:
            idx = times.index(hour_iso[:13] + ":00")
        except ValueError:
            idx = None
        if idx is None:
            print(f"  {str(nm)[:20]:<20s} VOID: upstream has no row for {hour_iso[:13]}:00")
            continue

        for layer, upH, upT in (("waves", "wave_height", "wave_period"),
                                ("wind_waves", "wind_wave_height", "wind_wave_period")):
            mine = _get(f"{OURS}/point?model=EURO&domain=marine&layer={layer}"
                        f"&lat={lat}&lng={lng}&valid_time={vt}")
            pt = (mine.get("point") or {}) if "_err" not in mine else {}
            oh, ot = pt.get("speed"), pt.get("period")
            uh = (hrs.get(upH) or [None] * (idx + 1))[idx]
            ut = (hrs.get(upT) or [None] * (idx + 1))[idx]
            if ot is None or ut is None:
                verdict = "no data"
            else:
                dt = ot - ut
                checked[layer] += 1
                if abs(dt) > max(1.0, 0.25 * ut):
                    divergent[layer] += 1
                    verdict = "DIVERGES from upstream"
                else:
                    verdict = "matches upstream"
                st = (oh / (1.56 * ot * ot)) if (oh and ot and ot > 0) else None
                if st and st > STEEP_LIMIT:
                    verdict += "  [OURS IS PHYSICALLY IMPOSSIBLE]"
            print(f"  {str(nm)[:20]:<20s} {layer:<11s} {str(oh)[:7]:>7s} {str(ot)[:7]:>7s} "
                  f"{str(uh)[:7]:>7s} {str(ut)[:7]:>7s} "
                  f"{(('%+.2f' % (ot-ut)) if (ot is not None and ut is not None) else '   n/a'):>7s}"
                  f"  {verdict}")

    print("\n--- ATTRIBUTION ---")
    print(f"  waves      diverged {divergent['waves']}/{checked['waves']}   (the CONTROL layer)")
    print(f"  wind_waves diverged {divergent['wind_waves']}/{checked['wind_waves']}")
    if checked["waves"] and checked["wind_waves"]:
        if divergent["wind_waves"] and not divergent["waves"]:
            print("  => CAUSE B (OURS): transport is sound for `waves` and broken for the wind-wave "
                  "channel specifically.")
        elif divergent["wind_waves"] and divergent["waves"]:
            print("  => CAUSE B (OURS), whole-lane: both layers diverge from upstream.")
        elif not divergent["wind_waves"]:
            print("  => CAUSE A (UPSTREAM): we relay what ECMWF WAM publishes; the impossible pairs "
                  "originate upstream and need an ingest-side validity filter.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
