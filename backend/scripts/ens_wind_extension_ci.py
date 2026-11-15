"""ens_wind_extension_ci.py - the PRODUCER of the long-range wind extension (wind-ens-extension.yml; GitHub Actions only).

Finds the newest complete ECMWF IFS ENS run (00Z/12Z, its 360 h member file indexed), reads the 51 members' 10u, 10v
and 10fg for every archived step 144..360 h by byte range (ens_wind_fetch), reduces each step to the member mean
(ens_wind_core.reduce_members) on a 1-degree subsample, and writes ONE file pair to the weather bucket:
`ens_wind/latest.npz` + `ens_wind/latest.json`. The ingest lanes read it (ens_wind_extension.extend_wind_tail).
Never runs on Render; never touches the manifest or a product. Kill: ENS_WIND_EXTENSION=0 (nothing is written).

  python scripts/ens_wind_extension_ci.py [--run 2026111500] [--out DIR] [--no-upload]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_wind_core as ec  # noqa: E402
from services.weather_pipeline import ens_wind_extension as ex  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402

STEPS = [s for s in ec.ens_archived_steps(360) if s >= 144]
# Pre-registered: the de-bias factor is applied ONLY if the gate chooses `ens_mean_debias`; then its fitted k per bin
# goes here in the PR that records the gate result. Empty = raw member mean (the pre-registered primary).
SPEED_FACTOR_BY_BIN: dict = {}


def newest_run(session, now: datetime, base: str):
    t = now.replace(minute=0, second=0, microsecond=0)
    t -= timedelta(hours=t.hour % 12)
    for _ in range(8):
        if ef.run_available(session, t, 360, base=base):
            return t
        t -= timedelta(hours=12)
    return None


def main(argv=None) -> int:
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None, help="YYYYMMDDHH; default the newest complete run")
    ap.add_argument("--out", default=os.environ.get("RUNNER_TEMP", "."))
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--base", default=ef.ECMWF_BASE, help="data.ecmwf.int (fresh runs) or the AWS mirror")
    a = ap.parse_args(argv)
    if not ex.ens_extension_on():
        print("ENS_WIND_EXTENSION=0: nothing written")
        return 0
    s = requests.Session()
    run = (datetime.strptime(a.run, "%Y%m%d%H").replace(tzinfo=timezone.utc) if a.run
           else newest_run(s, datetime.now(timezone.utc), a.base))
    if run is None:
        print("no complete ENS run in the last 4 days: nothing written (the ingest lanes keep the GFS stand-in)")
        return 0
    fields = {}
    for step in STEPS:
        f, _meta = ef.fetch_step(s, run, step, ef.subsample_1deg, base=a.base)
        r = ec.reduce_members(f["10u"], f["10v"], f["10fg"])
        fields[step] = {k: r[k] for k in ex.FIELDS}
        print(f"{run:%Y%m%d%H} +{step}: mean speed {float(r['speed'].mean()):.2f} m/s", flush=True)
    npz, meta = ex.pack(run, STEPS, fields, SPEED_FACTOR_BY_BIN)
    os.makedirs(a.out, exist_ok=True)
    open(os.path.join(a.out, "latest.npz"), "wb").write(npz)
    json.dump(meta, open(os.path.join(a.out, "latest.json"), "w"), indent=1)
    print(f"reduced field: {len(npz) / 1e6:.1f} MB, steps {STEPS[0]}..{STEPS[-1]}")
    if a.no_upload:
        return 0
    from services.weather_pipeline.store import ProductStore
    store = ProductStore()
    # namespaced keys pass the designated-writer gate (they are feature state, not pipeline products)
    store._upload_to_supabase(ex.KEY_NPZ, npz, strict=True, timeout=120)
    store._upload_to_supabase(ex.KEY_META, json.dumps(meta).encode("utf-8"), strict=True)
    print(f"uploaded {ex.KEY_NPZ} + {ex.KEY_META} (run {meta['run']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
