"""Proves the gate's new arm-B evaluator (open EOT20 once, interpolate once per point, predict in chunks) equals pyTMD's
own one-call path, and that it fits in a runner's memory. G2 run 43891805830 died in the gate step ("runner lost
communication") with the old per-chunk tide_elevations calls. OFFLINE, public data only, on its own branch (never the
gate's): calendar 2025, NOT the G2 window; no CO-OPS truth is scored here.
"""
import json
import resource
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "tide_fes"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import arms                                                  # noqa: E402
from tide_eot20_convention_check import COOPS, eot20, get   # noqa: E402  (the SEANOE download + extraction)

POINTS = {"8771510": "Galveston", "1612340": "Honolulu", "8443970": "Boston"}


def rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def main():
    root = eot20(Path("eot20_check_cache"))
    out = {"rss_after_download_mb": round(rss_mb())}
    year = [datetime(2025, 1, 1, tzinfo=timezone.utc) + timedelta(hours=k) for k in range(365 * 24)]
    d = arms.to_np(year)
    for sid, name in POINTS.items():
        meta = get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json")["stations"][0]
        lat, lng = meta["lat"], meta["lng"]
        row = {"name": name, "lat": lat, "lng": lng}
        t0 = time.time()
        new = arms.eot20_eval(root, lat, lng, d)
        row["new_s"] = round(time.time() - t0, 1)
        t0 = time.time()
        ref = arms.eot20_eval_reference(root, lat, lng, d)
        row["reference_s"] = round(time.time() - t0, 1)
        if new is None:
            row["new"] = "undefined"
            row["reference_finite"] = bool(np.isfinite(ref).any())
        else:
            row["max_abs_diff_full_m"] = float(np.nanmax(np.abs(new - ref)))
            sa_new = arms.eot20_eval(root, lat, lng, d, ["sa"])
            sa_ref = arms.eot20_eval_reference(root, lat, lng, d, ["sa"])
            row["max_abs_diff_sa_m"] = float(np.nanmax(np.abs(sa_new - sa_ref)))
        row["rss_mb"] = round(rss_mb())
        out[sid] = row
        print(json.dumps({sid: row}), file=sys.stderr, flush=True)
    nd = np.arange(np.datetime64("1983-01-01T00:00", "us"), np.datetime64("2002-01-01T00:00", "us"), np.timedelta64(10, "m"))
    t0 = time.time()
    lat, lng = out["8771510"]["lat"], out["8771510"]["lng"]
    v = arms.eot20_eval(root, lat, lng, nd)
    out["ntde_19y_10min"] = {"n": int(len(nd)), "seconds": round(time.time() - t0, 1), "finite": bool(np.isfinite(v).all()),
                             "rss_mb": round(rss_mb())}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
