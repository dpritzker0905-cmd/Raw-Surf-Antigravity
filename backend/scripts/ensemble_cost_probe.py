"""ensemble_cost_probe.py — what would the 50-member wave ensemble actually COST per cycle?

THE QUESTION, AND WHY IT COMES BEFORE THE SCIENCE
------------------------------------------------
`ifs/waef` is a 50-member ensemble wave stream, free, on the endpoint `ecmwf_opendata_fetcher`
already talks to, while production ships ONE deterministic number. At realistic spread, 2 of 4
sampled spots span multiple rating LEVELS; at +/-30%, all four. That is the single largest
differentiator left in the forecast.

⛔ BUT THE BINDING CONSTRAINT IS NOT THE SCIENCE. `SURF_PARTITIONS` was measured to cost 4x, on a
1-CPU box with a documented three-incident melt history, and the ingest lane already runs at ~82%
of its 165-minute timeout (measured 2026-08-02: 95-135 min across the last seven completed runs).
An ensemble that cannot fit in the remaining ~30 minutes is not a feature, it is an outage.

⇒ MEASURE THE COST FIRST. This probe reads ECMWF's own `.index` sidecars — the same byte-range
manifests `ecmwf_opendata_fetcher` uses — and sums the packed byte length of the fields an ensemble
ingest would have to pull. No GRIB decoding, no full download: an index is a few hundred KB and the
answer is arithmetic on `_length`.

⚠️ WHAT THIS DOES AND DOES NOT ANSWER. It bounds the DOWNLOAD, which is the part that scales with
member count and is the obvious melt risk. It does NOT measure decode CPU, which needs the decoder
and a real file — that is the next probe, and it must run where pygrib lives
(`.github/workflows/ecmwf-band-closure-probe.yml` is the pattern).

⚠️ IT VOIDS ITSELF rather than guessing: no network, a missing stream, or an index without the
expected params returns VOID. A cost probe that reports "cheap" because it read nothing is worse
than no probe — the house contract.

USAGE
    python backend/scripts/ensemble_cost_probe.py                 # newest complete cycle
    python backend/scripts/ensemble_cost_probe.py --step 0 --params swh,mwd,pp1d
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "https://data.ecmwf.int/forecasts"
DETERMINISTIC = ("ifs", "wave")          # what we fetch today
ENSEMBLE = ("ifs", "waef")               # the 50-member wave ensemble
DEFAULT_PARAMS = ("swh", "mwd", "pp1d", "mwp")

VOID = "VOID"


def _fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-cost-probe"})
    with urllib.request.urlopen(req, timeout=timeout) as fh:
        return fh.read()


def _latest_cycle():
    """Walk back from today until a cycle directory answers. Returns (date, hh) or None."""
    import datetime as _dt          # local: this script is a probe, not part of the hot path
    now = _dt.datetime.now(_dt.timezone.utc)
    for back in range(0, 3):
        day = (now - _dt.timedelta(days=back)).strftime("%Y%m%d")
        for hh in ("18", "12", "06", "00"):
            url = f"{BASE}/{day}/{hh}z/{ENSEMBLE[0]}/0p25/{ENSEMBLE[1]}/"
            try:
                _fetch(url, timeout=20)
                return day, hh
            except Exception:
                continue
    return None


def index_rows(day, hh, stream, step):
    """Every row of a cycle's .index sidecar as dicts. Raises on any failure — caller voids."""
    fam, strm = stream
    stem = f"{BASE}/{day}/{hh}z/{fam}/0p25/{strm}/{day}{hh}0000-{step}h-{strm}-ef.index"
    if strm == "wave":
        stem = f"{BASE}/{day}/{hh}z/{fam}/0p25/{strm}/{day}{hh}0000-{step}h-{strm}-fc.index"
    raw = _fetch(stem).decode("utf-8", "replace")
    return [json.loads(l) for l in raw.splitlines() if l.strip()]


def summarise(rows, params):
    """Bytes and row counts for the requested params, plus the member census."""
    want = set(params)
    hit = [r for r in rows if r.get("param") in want]
    members = sorted({r.get("number") for r in hit if r.get("number") is not None})
    total = sum(int(r.get("_length", 0)) for r in hit)
    per_param = {}
    for p in sorted(want):
        rs = [r for r in hit if r.get("param") == p]
        per_param[p] = {"rows": len(rs), "bytes": sum(int(r.get("_length", 0)) for r in rs)}
    return {"rows": len(hit), "bytes": total, "members": len(members), "per_param": per_param}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, default=0)
    ap.add_argument("--params", default=",".join(DEFAULT_PARAMS))
    args = ap.parse_args()
    params = tuple(p.strip() for p in args.params.split(",") if p.strip())

    cycle = _latest_cycle()
    if cycle is None:
        print(json.dumps({"verdict": VOID, "reason": "no reachable ifs/waef cycle in the last 3 days"}))
        sys.exit(2)
    day, hh = cycle

    out = {"cycle": f"{day}/{hh}z", "step_h": args.step, "params": list(params)}
    try:
        det = summarise(index_rows(day, hh, DETERMINISTIC, args.step), params)
        ens = summarise(index_rows(day, hh, ENSEMBLE, args.step), params)
    except Exception as e:
        print(json.dumps({"verdict": VOID, "reason": f"index unreadable: {type(e).__name__}: {e}",
                          **out}))
        sys.exit(2)

    if det["rows"] == 0 or ens["rows"] == 0:
        print(json.dumps({"verdict": VOID, "reason": "one stream returned no rows for these params",
                          "deterministic": det, "ensemble": ens, **out}))
        sys.exit(2)

    out["deterministic"] = det
    out["ensemble"] = ens
    out["ratio_bytes"] = round(ens["bytes"] / det["bytes"], 2) if det["bytes"] else None
    out["ensemble_members"] = ens["members"]
    out["verdict"] = "MEASURED"
    # The number that decides the schedule: one step's worth, scaled to a 10-day fetch at the
    # 3-hourly/6-hourly cadence `_step_list` already uses (65 steps).
    out["est_full_fetch_mb"] = {
        "deterministic": round(det["bytes"] * 65 / 1e6, 1),
        "ensemble": round(ens["bytes"] * 65 / 1e6, 1),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
