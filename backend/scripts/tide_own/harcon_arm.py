"""The served table's second A arm, `am_h` (gates/tide-a-harcon-v1.md s2; gates/tide-guard-v1.md s2): at every key where
the A_HARCON weight w > 0, A = w * A_donor + (1 - w) * A_FES, with A_donor NOAA's published harmonic constants of the
nearest type-R CO-OPS station (the vendored snapshot, tide_datum/a_harcon_frozen), plus the key's M as for `am`.
The weight and the blend are the A gate instrument's own functions (tide_datum/a_harcon_parity.weight / .blend), so the
served arm is the arm the gate scores. In production the donor is simply the nearest type-R station (no leave-one-out:
at a station's own key its own constants are the right answer). Built whatever the flag's state; served only when
SURF_TIDE_A_HARCON is ON (tide_own.series_from_table). NOAA harcon is public domain (17 U.S.C. 105).

Also: the TIDE guardrail's monitor keys (research/tide-guard-v1-stations.json, monitors + reserve), which the build adds
to its point set so the tester can read both arms there.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tide_datum"))
import a_harcon_parity as AP  # noqa: E402  (weight, blend: ONE definition with the gate instrument)
import a_harcon_select as SEL  # noqa: E402  (the vendored universe)
from a_harcon_frozen import _km  # noqa: E402

RESEARCH = HERE.parents[2] / "docs" / "weather-program" / "research"
GUARD_STATIONS = RESEARCH / "tide-guard-v1-stations.json"


def donor_for(lat, lng, universe):
    """PURE: (id, km) of the nearest type-R station to (lat, lng) (ties: the smaller id), or (None, None)."""
    best = min(((_km(lat, lng, o["lat"], o["lng"]), o["id"]) for o in universe), default=None)
    return (best[1], best[0]) if best else (None, None)


def build_am_h(keys_pts, a_by_key, m_by_key, universe, harcon_fn, synth_fn, times, levels_mm):
    """PURE given its callables: ({key: mm series}, {key: {donor, km, w}}) at every key where w > 0, FES has A and M
    exists (a key without either serves no `am` either). harcon_fn(id) -> constants or []; synth_fn(constants, times) ->
    an A series or None; levels_mm(a, m) as own_rules.levels_mm."""
    out, meta, cache = {}, {}, {}
    for k, (la, lo) in keys_pts.items():
        a, m = a_by_key.get(k), m_by_key.get(k)
        if a is None or m is None:
            continue
        did, d = donor_for(la, lo, universe)
        w = AP.weight(d)
        if w <= 0:
            continue
        if did not in cache:
            hc = harcon_fn(did)
            try:
                cache[did] = synth_fn(hc, times) if hc else None
            except Exception:                                       # noqa: BLE001 - per donor, never the whole build
                # A donor the synthesis cannot evaluate (e.g. pyTMD "Unsupported constituent: mln2", found by the
                # tide-a-harcon-v2 pre-flight, run 45519746500) serves no am_h; its keys keep the FES arm.
                cache[did] = None
        syn = cache[did]
        if syn is None:
            continue
        out[k] = levels_mm(AP.blend(w, [float(x) for x in syn], [float(x) for x in a]), m)
        meta[k] = {"donor": did, "km": round(d, 3), "w": round(w, 6)}
    return out, meta


def monitor_spots(path=GUARD_STATIONS):
    """[[lat, lng]] of every TIDE-guard monitor and reserve station, so their keys are in the table."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return [list(v["key"][i]) for v in doc["strata"].values() for i in v["monitor"] + v["reserve"]]


def universe():
    return SEL.universe()
