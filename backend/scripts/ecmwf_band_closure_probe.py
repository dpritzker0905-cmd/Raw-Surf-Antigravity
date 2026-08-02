"""ecmwf_band_closure_probe.py — do ECMWF's period bands actually close against its own total?

THE QUESTION THIS ANSWERS, AND WHY IT COMES FIRST
-------------------------------------------------
ECMWF publishes six significant heights BY PERIOD BAND on the free Open-Data wave stream —
`h1012 h1214 h1417 h1721 h2125 h2530` (10-12 … 25-30 s) — alongside the total `swh`. Verified live
by index probe of `data.ecmwf.int/forecasts/<cycle>/ifs/0p25/wave`. We fetch only swh/mwp/pp1d/mwd.

`services/weather_pipeline/period_bands.py` can already turn those bands into the partition shape
`estimate_surf_partitioned` consumes, and the composition is measured to be worth a full rating
LEVEL on a chop-dominated sea. But NONE of that is safe to ingest until one thing is established
against real data:

    SPECTRAL CLOSURE:   sqrt( sum(band_i^2) ) / swh   must be <= ~1

If the bands routinely exceed the total, the residual wind-sea reconstruction is fabricating energy,
and `period_bands.bands_represent` would be rejecting real data rather than catching a defect. The
recorded precedent is exact: the CMEMS partitions do NOT reconcile with their total (median 9.5%
off, max 43.8%, over at 10 of 16 spots), which is why `reconcile_partitions` exists at all. Assuming
ECMWF's own bands behave better than that is a hypothesis, not a fact.

⇒ RUN THIS BEFORE EXTENDING THE FETCHER. It is step 1 of the period-band work and it costs one
cycle's worth of byte-range reads.

⛔ WHY IT IS A PROBE AND NOT A TEST. ECMWF packs these fields with CCSDS/AEC (GRIB2 data-
representation template 5.42, confirmed by parsing Section 5), so decoding needs ecCodes built with
libaec — `pygrib` on Render and in CI has it; a Windows dev box on Python 3.14 does not (no wheel,
and the `eccodes` package ships no `_eccodes` glue). The DECODE half therefore runs where the
decoder exists. The JUDGEMENT half — `assess_closure` — is pure and is unit-tested.

⚠️ IT VOIDS ITSELF rather than answering when it cannot measure: no pygrib, no network, no ocean
samples, or a cycle whose index lacks the bands. A probe that reports "closure fine" because it
decoded nothing is worse than no probe.

USAGE
    python backend/scripts/ecmwf_band_closure_probe.py                 # newest complete cycle
    python backend/scripts/ecmwf_band_closure_probe.py --step 24 --max-samples 40000
"""
import argparse
import json
import math
import os
import sys

BASE = "https://data.ecmwf.int/forecasts"
BANDS = ("h1012", "h1214", "h1417", "h1721", "h2125", "h2530")
TOTAL = "swh"

VERDICT_VOID = "VOID"
VERDICT_CLOSES = "BANDS_CLOSE"
VERDICT_EXCEEDS = "BANDS_EXCEED_TOTAL"

# The bands cover >= 10 s only, so the ratio is expected to be WELL BELOW 1 on most of the ocean —
# that is wind sea, not an error. Only the upper tail is diagnostic.
TOLERANCE = 1.02          # 2% headroom for packing precision (16 bits/value) and band-edge overlap
MAX_EXCEED_SHARE = 0.01   # >1% of ocean cells exceeding the total means the fields disagree


def assess_closure(ratios, tolerance=TOLERANCE, max_exceed_share=MAX_EXCEED_SHARE):
    """PURE. Given per-cell sqrt(sum(band^2))/swh ratios, decide whether the bands close.

    Separated from the I/O so CI can exercise every branch without a network or a GRIB decoder —
    the same split as `shore_normal_coverage_census.assess`.

    Returns a dict with the verdict, the percentile spread, and the exceed share. VOIDs on an empty
    or unusable sample rather than reporting closure it did not observe.
    """
    vals = []
    for r in (ratios or []):
        try:
            v = float(r)
        except (TypeError, ValueError):
            continue
        if v == v and v >= 0.0 and v != float("inf"):
            vals.append(v)
    if len(vals) < 100:
        return {"verdict": VERDICT_VOID,
                "reason": f"only {len(vals)} usable ocean samples — too few to characterise closure",
                "n": len(vals)}
    vals.sort()

    def pct(p):
        return round(vals[min(len(vals) - 1, int(len(vals) * p))], 4)

    exceed = sum(1 for v in vals if v > tolerance)
    share = exceed / len(vals)
    out = {"n": len(vals), "p50": pct(0.50), "p90": pct(0.90), "p99": pct(0.99),
           "max": round(vals[-1], 4), "exceed_share": round(share, 5),
           "tolerance": tolerance}
    if share > max_exceed_share:
        out["verdict"] = VERDICT_EXCEEDS
        out["reason"] = (f"{share*100:.2f}% of ocean cells have bands carrying MORE energy than the "
                         f"total (tolerance {tolerance}); the residual wind-sea reconstruction would "
                         f"fabricate energy on those cells")
    else:
        out["verdict"] = VERDICT_CLOSES
        out["reason"] = (f"bands stay within the total on {(1-share)*100:.2f}% of ocean cells; the "
                         f"low median is EXPECTED — bands cover >= 10 s only, so the remainder is "
                         f"wind sea, not an error")
    return out


# ─────────────────────────────── the decode half (runs where pygrib exists) ───────────────────────

def _void(reason):
    print(json.dumps({"verdict": VERDICT_VOID, "reason": reason}, indent=2))
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--step", type=int, default=24, help="forecast hour to sample")
    ap.add_argument("--max-samples", type=int, default=200000)
    ap.add_argument("--cycle", default=None, help="YYYYMMDD/HH, else the newest complete one")
    args = ap.parse_args()

    try:
        import numpy as np
        import pygrib
    except ImportError as e:
        _void(f"no GRIB decoder available ({e}). ECMWF packs these fields with CCSDS/AEC "
              f"(template 5.42), so this needs ecCodes built with libaec — run where pygrib is "
              f"installed (CI / Render). VOIDING rather than reporting a closure it cannot measure.")

    import urllib.request
    from datetime import datetime, timedelta, timezone

    def _idx(cycle_ymd, hh, step):
        stem = f"{cycle_ymd}{hh}0000-{step}h-wave-fc"
        url = f"{BASE}/{cycle_ymd}/{hh}z/ifs/0p25/wave/{stem}"
        try:
            body = urllib.request.urlopen(url + ".index", timeout=45).read().decode("utf-8", "ignore")
        except Exception:
            return None, None
        return [json.loads(l) for l in body.splitlines() if l.strip()], url

    rows = url = None
    if args.cycle:
        ymd, hh = args.cycle.split("/")
        rows, url = _idx(ymd, hh, args.step)
    else:
        now = datetime.now(timezone.utc)
        for back in range(0, 5):
            d = now - timedelta(hours=12 * back)
            rows, url = _idx(d.strftime("%Y%m%d"), "%02d" % ((d.hour // 12) * 12), args.step)
            if rows:
                break
    if not rows:
        _void("no reachable ECMWF wave index for any recent cycle — network or upstream outage")

    want = {r["param"]: (int(r["_offset"]), int(r["_length"])) for r in rows
            if r.get("param") in BANDS + (TOTAL,)}
    missing = [p for p in BANDS + (TOTAL,) if p not in want]
    if missing:
        _void(f"cycle index is missing {missing} — cannot compute closure without every band "
              f"AND the total")

    fields = {}
    tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ecmwf_band_probe.grib2")
    for param, (off, ln) in want.items():
        req = urllib.request.Request(url + ".grib2", headers={"Range": f"bytes={off}-{off+ln-1}"})
        with open(tmp, "wb") as fh:
            fh.write(urllib.request.urlopen(req, timeout=120).read())
        g = pygrib.open(tmp)
        m = g.read(1)[0]
        fields[param] = np.ma.filled(np.ma.asarray(m.values, dtype=float), np.nan)
        g.close()
    try:
        os.unlink(tmp)
    except OSError:
        pass

    total = fields[TOTAL]
    # Ocean only, and only where there is a sea worth decomposing — a 0.05 m sea makes the ratio
    # numerically meaningless and would dominate the percentiles with noise.
    ocean = np.isfinite(total) & (total > 0.25)
    quad_sq = np.zeros_like(total)
    for b in BANDS:
        v = fields[b]
        quad_sq = quad_sq + np.where(np.isfinite(v), v, 0.0) ** 2
    ratios = np.sqrt(quad_sq[ocean]) / total[ocean]
    if ratios.size > args.max_samples:
        ratios = ratios[:: max(1, ratios.size // args.max_samples)]

    result = assess_closure(ratios.tolist())
    result["cycle_url"] = url
    result["step_h"] = args.step
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["verdict"] == VERDICT_CLOSES else (2 if result["verdict"] == VERDICT_VOID else 1))


if __name__ == "__main__":
    main()
