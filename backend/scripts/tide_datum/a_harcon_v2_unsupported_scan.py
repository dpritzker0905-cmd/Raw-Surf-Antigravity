"""tide-a-harcon-v2 §13 (PRE-DATA): which stations' published harmonic constants the PINNED pyTMD cannot synthesise.

INPUTS ONLY. For every station v2 can read (each stratum's deciding stations and ALL its reserves, every prefix donor of
those, and the 383 pre-flight stations) it reads the CO-OPS harcon.json (the constants are inputs, not outcomes) and
tries the candidate's own synthesis, `arms.harcon_eval`, verbatim, at ONE instant. It records only whether that raised
and the constituent NAMES the pinned pyTMD's coefficient table lacks. No synthesised value is kept, printed or compared
with anything: no NOAA prediction, no water level, no FES, no window data is read.

Run (repo root, under the paced CO-OPS access):
  python backend/scripts/tide_datum/paced_run.py --budget-s 3600 --outcome scan_outcome.json \
      backend/scripts/tide_datum/a_harcon_v2_unsupported_scan.py --json tide_a_harcon_v2_unsupported.json
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
for sub in ("tide_own", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent))
RESEARCH = HERE.parent.parent.parent / "docs" / "weather-program" / "research"
V2_STATIONS = RESEARCH / "tide-a-harcon-v2-stations.json"
PREFLIGHT = RESEARCH / "tide-a-harcon-v2-preflight-set.json"
PROBE = datetime(2000, 1, 1, tzinfo=timezone.utc)         # an arbitrary instant OUTSIDE every gate window


def station_sets(doc, pre, universe):
    """PURE: {id: sorted roles} over the candidates (deciding + every reserve), their prefix donors, the pre-flight."""
    import a_harcon_parity as P
    by_id = {s["id"]: s for s in universe}
    roles = {}
    cand = [(i, k) for k, s in doc["strata"].items() for i in s["deciding"] + s["reserve"]]
    cand_ids = {i for i, _ in cand}
    for sid, _ in cand:
        roles.setdefault(sid, set()).add("candidate")
        s = by_id[sid]
        for dn in P.donor_prefix(sid, s["lat"], s["lng"], universe, cand_ids):
            roles.setdefault(dn["id"], set()).add("prefix_donor")
    for sid in pre["ids"]:
        roles.setdefault(sid, set()).add("preflight")
    return {k: sorted(v) for k, v in roles.items()}


def unsupported_names(harcon):
    """The constituent NAMES in `harcon` the pinned pyTMD's coefficient table rejects (names only)."""
    import pyTMD.constituents as C
    bad = []
    for _num, name, amp, *_ in harcon:
        try:
            c = C._parse_name(name)
        except Exception:                                  # noqa: BLE001 - harcon_eval drops these itself
            continue
        try:
            C.coefficients_table([c])
        except Exception:                                  # noqa: BLE001 - the crash's own cause
            bad.append(name)
    return sorted(set(bad))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="tide_a_harcon_v2_unsupported.json")
    a = ap.parse_args(argv)
    import numpy as np
    import pyTMD
    import arms
    import sources as S
    import a_harcon_select as SEL
    doc = json.loads(V2_STATIONS.read_text(encoding="utf-8"))
    pre = json.loads(PREFLIGHT.read_text(encoding="utf-8"))
    roles = station_sets(doc, pre, SEL.universe())
    probe = arms.to_np([PROBE])
    out = {}
    for sid in sorted(roles):
        try:
            hc = S.coops_harcon(sid)
        except Exception as e:                             # noqa: BLE001 - recorded, never retried here
            out[sid] = {"roles": roles[sid], "status": "no_constants", "error": type(e).__name__}
            continue
        if not hc:
            out[sid] = {"roles": roles[sid], "status": "no_constants"}
            continue
        try:
            arms.harcon_eval(hc, probe)                    # value discarded: only "does it raise" is recorded
            status, err = "ok", None
        except Exception as e:                             # noqa: BLE001 - the pre-flight-1 crash class
            status, err = "unsupported", f"{type(e).__name__}: {e}"
        row = {"roles": roles[sid], "status": status, "unsupported_names": unsupported_names(hc)}
        if err:
            row["error"] = err
        out[sid] = row
        np.seterr(all="ignore")
    summary = {}
    for r in out.values():
        for role in r["roles"]:
            summary.setdefault(role, {}).setdefault(r["status"], 0)
            summary[role][r["status"]] += 1
    Path(a.json).write_text(json.dumps({
        "schema": "raw-surf/tide-a-harcon-v2-unsupported/1", "gate": "gates/tide-a-harcon-v2.md section 13",
        "pytmd": pyTMD.__version__, "probe": PROBE.isoformat(), "inputs_only": True,
        "summary": summary, "stations": out}, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
