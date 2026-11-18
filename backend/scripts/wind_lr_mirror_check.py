"""wind_lr_mirror_check.py - the sameness control for a second-mirror fill (advisor 2026-11-18 00:00Z, condition 4).

For one run already held from the S3 copy, read the same files from S3 and from the second mirror and compare their
sha256: the ENS `ef` index at two steps, the HRES and AIFS-ENS indexes, and the GRIB bytes of the first 10u member
message at 336 h. Any difference exits non-zero, and the workflow then stops: no collection, no score. Reads public
ECMWF open data only (a few MB); serves nothing.
"""
import hashlib
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_wind_core as ec  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402

GCS = "https://storage.googleapis.com/ecmwf-open-data"
CHECK_RUN = datetime(2026, 10, 2, 0, tzinfo=timezone.utc)      # held from S3 by run 43952101715 (not in the 12)


def targets(run):
    """(label, kwargs for ef.ef_url) of the files compared."""
    return [("ens ef 180 index", dict(step=180, ext="index")),
            ("ens ef 336 index", dict(step=336, ext="index")),
            ("hres oper 240 index", dict(step=240, ext="index", stream="oper", typ="fc")),
            ("aifs-ens pf 336 index", dict(step=336, ext="index", typ="pf", model="aifs-ens"))]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def compare(session, run=CHECK_RUN, bases=(ef.AWS_BASE, GCS)):
    """[(label, sha_s3, sha_mirror)]; raises on a non-200 read."""
    rows = []
    for label, kw in targets(run):
        got = []
        for base in bases:
            r = ef._get(session, ef.ef_url(base, run, **kw))
            if r.status_code != 200:
                raise RuntimeError(f"{label}: HTTP {r.status_code} from {base}")
            got.append(r.content)
        rows.append((label, sha(got[0]), sha(got[1])))
        if label == "ens ef 336 index":
            ent = next(e for e in ec.parse_ecmwf_index(got[0].decode()) if e.get("param") == "10u")
            off, ln = int(ent["_offset"]), int(ent["_length"])
            rng = {"Range": f"bytes={off}-{off + ln - 1}"}
            gb = [ef._get(session, ef.ef_url(b, run, 336, "grib2"), headers=rng).content for b in bases]
            rows.append(("ens ef 336 grib 10u message", sha(gb[0]), sha(gb[1])))
    return rows


def main():
    import requests
    rows = compare(requests.Session())
    same = all(a == b for _, a, b in rows)
    for label, a, b in rows:
        print(f"{'SAME' if a == b else 'DIFFERENT'}  {label}  s3 {a[:16]}  mirror {b[:16]}")
    print(f"sameness control on {CHECK_RUN:%Y%m%d%H}: {'PASS' if same else 'FAIL - stop, no collection, no score'}")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main())
