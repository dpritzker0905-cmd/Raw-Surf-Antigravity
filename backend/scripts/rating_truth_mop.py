"""rating_truth_mop.py - the MOP rating-truth check that gates #771 (JAC-2, RATING_REF_PRIOR). OFFLINE.

Gate 2 of #771: at CDIP MOP points, does the catalogue reference prior (ON) put reference-less spot-hours in the size
category measured nearshore water says they are in, at least as often as the legacy curve (OFF)? The pure core, the
category definition and the pre-registered rule are in `rating_truth_mop_core.py`; this file only fetches and wires.

DATA (public, no credentials): CDIP MOP v1.1 alongshore hindcast over OPeNDAP ASCII,
    https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/<ID>_hindcast.nc.ascii
waveTime / waveHs / waveTp / metaWaterDepth, every 2nd hour, 2018-01-01 00Z (index 157800) .. 2025-03-31 23Z
(index 221327). Reference years 2018-2021 define each spot's measured typical day; 2022-01 .. 2025-03 is scored.
The 19 spots and their MOP IDs are the ones vetted in docs/research/FINDING-2026-11-11-jac1-mop-refutes-the-landward-
taper.md (nearest MOP point, 0.06-2.9 km). The app backend is NEVER called: CDIP's THREDDS server is the only network.

    cd backend
    python scripts/rating_truth_mop.py --cache <dir for downloads> --out <result.json>

The download is ~1 MB of ASCII per point, sequential, cached; re-runs read the cache.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.request

# The OFF arm must be the legacy curve whatever this machine's flags say, and no manifest is fetched.
os.environ["RATING_REF_PRIOR"] = "0"
os.environ.setdefault("RUNTIME_FLAGS_MANIFEST", "0")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import numpy as np  # noqa: E402

from scripts import rating_truth_mop_core as core  # noqa: E402
from services.weather_pipeline.spot_size_climatology import REF_CLAMP_MAX_M  # noqa: E402
from services.weather_pipeline.surf_height_convention import H110_OVER_HS  # noqa: E402

BASE = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{id}_hindcast.nc.ascii"
I0, I1, STEP = 157800, 221327, 2               # 2018-01-01 00Z .. 2025-03-31 23Z, every 2nd hour
SCORE_FROM = int(dt.datetime(2022, 1, 1, tzinfo=dt.timezone.utc).timestamp())
VARIANTS = {"kg_frozen": 1.0, "h110_served": H110_OVER_HS}
WRONG_REF_M = REF_CLAMP_MAX_M                  # positive control: every spot graded as a 4 m big-wave spot

# name, catalogue spot_id (backend/data/mop_spot_cells.json), MOP ID, region
SPOTS = [
    ("Ocean Beach SF", "21157011-", "SF029", "north_central"),
    ("Pacifica - Linda Mar", "84e9c0aa-", "SM371", "north_central"),
    ("Capitola", "41f7c0e0-", "SC111", "north_central"),
    ("Pleasure Point", "5ffb6b8d-", "SC117", "north_central"),
    ("Steamer Lane", "a0831e90-", "SC149", "north_central"),
    ("Carmel Beach", "efe348ef-", "MO638", "north_central"),
    ("Leadbetter Beach", "675526a0-", "B0266", "santa_barbara_ventura"),
    ("Sands Beach", "1c76a94d-", "B0415", "santa_barbara_ventura"),
    ("Rincon", "31224425-", "B0007", "santa_barbara_ventura"),
    ("Mondos", "6ee47aa0-", "VE572", "santa_barbara_ventura"),
    ("C Street Ventura", "9b4373eb-", "VE463", "santa_barbara_ventura"),
    ("Malibu First Point", "dc4e8fea-", "L0935", "la_orange"),
    ("Zuma Beach", "526a90b8-", "L1071", "la_orange"),
    ("Huntington Beach Pier", "c84de5b4-", "OC512", "la_orange"),
    ("Newport Point", "b0dbef94-", "OC381", "la_orange"),
    ("Trestles", "981d82c5-", "D1204", "san_diego"),
    ("Blacks Beach", "7eb3a816-", "D0542", "san_diego"),
    ("La Jolla Shores", "9bdaed85-", "D0499", "san_diego"),
    ("Windansea", "dcac30c9-", "D0457", "san_diego"),
]


def fetch(mop_id: str, cache: str) -> dict:
    path = os.path.join(cache, f"{mop_id}_{I0}_{STEP}_{I1}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    sl = f"%5B{I0}:{STEP}:{I1}%5D"
    url = BASE.format(id=mop_id) + f"?waveTime{sl},waveHs{sl},waveTp{sl},metaWaterDepth,metaLatitude,metaLongitude"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                d = core.parse_ascii(r.read().decode("utf-8"))
            break
        except Exception as e:  # noqa: BLE001 - network: retry, then let it raise
            if attempt == 3:
                raise
            print(f"  {mop_id}: retry after {type(e).__name__}", flush=True)
            time.sleep(10 * (attempt + 1))
    n = len(d["waveTime"])
    if not (n == len(d["waveHs"]) == len(d["waveTp"])) or n == 0:
        raise ValueError(f"{mop_id}: ragged or empty arrays")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(d, fh)
    return d


def spot_id_for(prefix: str, cells: list) -> str:
    ids = [c["spot_id"] for c in cells if c["spot_id"].startswith(prefix)]
    if len(ids) != 1:
        raise LookupError(f"spot id prefix {prefix}: {len(ids)} matches")
    return ids[0]


def build_rows(series: dict, refs: dict, cells: list, scale: float) -> tuple:
    rows, meta = [], []
    for name, prefix, mop_id, region in SPOTS:
        d = series[mop_id]
        t = np.asarray(d["waveTime"], dtype=np.int64)
        hb = core.breaking_heights(d["waveHs"], d["waveTp"], d["metaWaterDepth"][0], scale)
        ok = np.isfinite(hb)
        ref_years, scored = ok & (t < SCORE_FROM), ok & (t >= SCORE_FROM)
        truth_ref = core.truth_reference(hb[ref_years])
        sid = spot_id_for(prefix, cells)
        prior = core.loo_prior(refs, sid)
        g = core.grade_spot(hb[scored], truth_ref, prior, WRONG_REF_M)
        ts = t[scored]
        g.update(spot=name, region=region, day=ts // 86400,
                 month=np.array([dt.datetime.fromtimestamp(int(x), dt.timezone.utc).month for x in ts]))
        rows.append(g)
        meta.append({"spot": name, "mop": mop_id, "region": region, "depth_m": d["metaWaterDepth"][0],
                     "truth_ref_m": truth_ref, "served_ref_m": refs.get(sid), "loo_prior_m": round(prior, 4),
                     "n_ref_hours": int(ref_years.sum()), "n_scored_hours": int(scored.sum()),
                     "hb_p50_scored_m": round(float(np.median(hb[scored])), 3)})
    return rows, meta


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", required=True, help="directory for the MOP downloads (outside the repo)")
    ap.add_argument("--out", required=True, help="result JSON path")
    ap.add_argument("--reps", type=int, default=2000)
    a = ap.parse_args(argv)
    core.assert_legacy_is_legacy()
    os.makedirs(a.cache, exist_ok=True)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "climatology_baseline.json"), encoding="utf-8") as fh:
        refs = json.load(fh)["references"]
    with open(os.path.join(here, "..", "data", "mop_spot_cells.json"), encoding="utf-8") as fh:
        cells = json.load(fh)["cells"]
    series = {}
    for name, _, mop_id, _ in SPOTS:
        print(f"fetch {mop_id} ({name})", flush=True)
        series[mop_id] = fetch(mop_id, a.cache)
    result = {"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
              "window": {"reference_years": "2018-01-01..2021-12-31", "scored": "2022-01-01..2025-03-31",
                         "step_h": STEP, "mop_index": [I0, I1]},
              "wrong_ref_m": WRONG_REF_M, "variants": {}, "spots": {}}
    for vname, scale in VARIANTS.items():
        rows, meta = build_rows(series, refs, cells, scale)
        result["spots"][vname] = meta
        result["variants"][vname] = {"scale": scale, **core.score_variant(rows, reps=a.reps)}
    result["verdict"] = core.verdict({k: v for k, v in result["variants"].items()})
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1, default=float)
    for vname, v in result["variants"].items():
        p = v["pooled"]
        print(f"[{vname}] pooled prior {p['a']} legacy {p['b']} diff {p['diff']} CI {p['ci']} "
              f"({p['n_hours']} h, {p['n_days']} d)")
        for r, x in v["regions"].items():
            print(f"    {r}: prior {x['a']} legacy {x['b']} diff {x['diff']} CI {x['ci']}")
    print("VERDICT", result["verdict"]["verdict"], result["verdict"]["why"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
