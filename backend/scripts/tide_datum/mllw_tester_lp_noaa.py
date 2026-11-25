"""gates/tide-mllw-tester-v1.md s10 item 1 + s11: the NOAA-side long-period constants (SA, SSA, MF, MM) of every frozen
monitor and reserve, from its CO-OPS harcon.json. INPUTS ONLY: published constants; no prediction, water level, table or
FES value is read. Run under the paced access:

  python backend/scripts/tide_datum/paced_run.py --budget-s 1800 --outcome lp_outcome.json \
      backend/scripts/tide_datum/mllw_tester_lp_noaa.py --json docs/weather-program/research/tide-mllw-tester-v1-lp-noaa.json
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for sub in ("tide_own", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
STATIONS = HERE.parent.parent.parent / "docs" / "weather-program" / "research" / "tide-mllw-tester-v1-stations.json"
LP = ("SA", "SSA", "MF", "MM")


def lp_rows(harcon):
    """PURE: {name: {amplitude_m, phase_gmt_deg}} for the long-period constituents present in a harcon list."""
    return {name: {"amplitude_m": amp, "phase_gmt_deg": ph} for _n, name, amp, ph, *_ in harcon if name in LP}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    a = ap.parse_args(argv)
    import sources as S
    doc = json.loads(STATIONS.read_text(encoding="utf-8"))
    out = {}
    for stratum, s in doc["strata"].items():
        for role in ("monitor", "reserve"):
            for sid in s[role]:
                try:
                    hc = S.coops_harcon(sid)
                except Exception as e:                       # noqa: BLE001 - recorded
                    out[sid] = {"stratum": stratum, "role": role, "error": type(e).__name__}
                    continue
                out[sid] = {"stratum": stratum, "role": role, "n_constituents": len(hc), "lp": lp_rows(hc)}
    body = {"schema": "raw-surf/tide-mllw-tester-v1-lp-noaa/1", "gate": "gates/tide-mllw-tester-v1.md s10 + s11",
            "inputs_only": True, "stations": out}
    Path(a.json).write_bytes((json.dumps(body, indent=1, sort_keys=True) + "\n").encode("utf-8"))   # LF on every OS
    print(len(out), "stations")


if __name__ == "__main__":
    main()
