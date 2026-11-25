"""The tide-a-harcon-v2 PRE-FLIGHT (gates/tide-a-harcon-v2.md §6, §12): outcome-blind, on the 383 SEEN stations of
research/tide-a-harcon-v2-preflight-set.json, over the half-open [2027-07-01, 2027-07-15).

At each station it computes ONLY the own-constants identity (C2: the candidate's own synthesis, harcon_eval verbatim, on
the 6-min grid, the FIXED bars) and the same identity on four PLANTED breaks: (i) heights x100, (ii) phases sign-flipped,
(iii) times +60 min, (iv) M2 dropped. It never computes a candidate arm: no FES, no donor, no blend, no leg (pinned by
tests/test_a_harcon_v2.py). PASS iff >= 300 records tested AND <= 1 % over the bars AND each break FAILS C2 (status not
PASS, §12) at >= 95 %; else STOP. It never sets or moves a bar.

CI only (pyTMD), run under paced_run.py:
    python backend/scripts/tide_datum/paced_run.py --budget-s 6900 --outcome outcome.json \
        backend/scripts/tide_datum/a_harcon_v2_preflight.py --json tide_a_harcon_v2_preflight.json
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for sub in ("tide_fes",):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent))
import a_harcon_v2 as V2  # noqa: E402

SET = HERE.parents[2] / "docs" / "weather-program" / "research" / "tide-a-harcon-v2-preflight-set.json"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    ap.add_argument("--set", default=str(SET))
    a = ap.parse_args(argv)
    import arms                                                    # pyTMD (harcon_eval), CI only
    import sources as S                                            # coops_harcon
    from metrics import noaa_long_period
    from a_harcon_parity import truth_at                           # the v1 truth fetch, unchanged (NOAA only)
    ids = json.loads(Path(a.set).read_text(encoding="utf-8"))["ids"]
    day0, stop = V2.window(V2.PREFLIGHT_START)

    def synth(consts, times):
        return arms.harcon_eval(consts, arms.to_np(times))

    records = {}
    for sid in ids:
        hc = S.coops_harcon(sid)
        if not hc:
            records[sid] = {"c2": "untestable", "why": "no constants"}
            continue
        ok, err = V2.synth_ok(hc, synth)                           # §13: unsupported constants are NOT TESTED, listed
        if not ok:
            records[sid] = {"c2": "not_tested", "why": "the pinned pyTMD cannot synthesise its constants (§13)", "error": err}
            continue
        tr = truth_at(sid, day0, stop, hc, noaa_long_period)
        rows = V2.c2_rows(hc, tr["hilo"], tr["raw_mean"], day0, stop, synth)
        status, detail = V2.c2_status(rows) if rows is not None else ("untestable", {"why": "no synthesis"})
        plants = {}
        for name, (transform, shift) in V2.PREFLIGHT_PLANTS.items():
            prow = V2.c2_rows(hc, tr["hilo"], tr["raw_mean"], day0, stop, synth, transform, shift)
            plants[name] = V2.c2_status(prow)[0] if prow is not None else "untestable"
        records[sid] = {"c2": status, "c2_detail": detail, "plants": plants}
    out = {"schema": "raw-surf/tide-a-harcon-v2-preflight/1", "gate": "gates/tide-a-harcon-v2.md s6 + s12",
           "window": [day0.isoformat(), stop.isoformat()], "bars": {"h_m": V2.BAR_H_M, "t_min": V2.BAR_T_MIN},
           "records": records, "verdict": V2.preflight_verdict(records), "complete": True}
    with open(a.json + ".tmp", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1, default=str)
    os.replace(a.json + ".tmp", a.json)
    print("PRE-FLIGHT", out["verdict"]["status"], "tested", out["verdict"]["tested"], flush=True)


if __name__ == "__main__":
    main()
