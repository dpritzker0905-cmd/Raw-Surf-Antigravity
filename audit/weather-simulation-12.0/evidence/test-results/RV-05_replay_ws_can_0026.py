# -*- coding: utf-8 -*-
"""RV-05 -- replay the WS-CAN-0026 paired gate against REAL production numbers.

WHY NOT READ THE ARCHIVE LOCALLY: `backend/.env` points at the PHANTOM Supabase project
(`weewaulkwfwlbhqemxma`), not production (`jnfbxcvcbtndtsvscppt`), so a local L2 read would grade a
different population and silently. Production truth comes from the production lane -- here, the
grade-step log of the scheduled runs themselves.

Rows below are transcribed verbatim from the `grade` step of the named GitHub Actions runs.
ASCII stdout only (cp1252).
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")
os.environ.pop("ACCURACY_PAIRED_GATE", None)

from scripts.forecast_accuracy_monitor import (           # noqa: E402
    OK, RED, REFUSED, default_cfg, evaluate_scored_segment,
)

NAME = {OK: "OK", RED: "RED", REFUSED: "REFUSED"}


def row(source, lead_h, n, ours, theirs, win, ours_total=None, theirs_total=None):
    return {"source": source, "lead_h": lead_h, "n_paired": n,
            "n_ours_total": ours_total if ours_total is not None else n,
            "n_theirs_total": theirs_total if theirs_total is not None else n,
            "mae_ours_m": ours, "mae_theirs_m": theirs,
            "delta_m": round(ours - theirs, 4), "win_rate": win, "we_lose": ours > theirs}


# --- run 31606511901, 2026-08-12T14:23:43Z (captured in RV-02_accuracy_monitor_*.log) ----------
RUN_0812 = [
    row("open_meteo:ncep_gfswave025", 24, 427, 0.199, 0.198, 0.45, 1918, 427),
    row("open_meteo_marine", 24, 1770, 0.181, 0.143, 0.41),
    row("open_meteo_marine", 48, 1796, 0.202, 0.150, 0.39),
    row("open_meteo_marine", 72, 1678, 0.215, 0.151, 0.38),
    row("persistence", 24, 1790, 0.183, 0.176, 0.46),
    row("persistence", 48, 1036, 0.188, 0.239, 0.60),
    row("persistence", 72, 371, 0.227, 0.278, 0.63, 1728, 371),
    row("raw_surf:EURO", 24, 1918, 0.184, 0.168, 0.43),
    row("raw_surf:EURO", 48, 1870, 0.201, 0.198, 0.46),
    row("raw_surf:EURO", 72, 1728, 0.215, 0.204, 0.47),
    row("raw_surf:ICON", 24, 1918, 0.184, 0.314, 0.70),
    row("raw_surf:ICON", 48, 1870, 0.201, 0.345, 0.67),
    row("raw_surf:ICON", 72, 1728, 0.215, 0.390, 0.71),
]

# --- Audit 11.1's measurement, run 31426692621, 2026-08-10 (BEFORE_AFTER_EVIDENCE_MATRIX.md) ---
RUN_0810 = [
    row("open_meteo_marine", 24, 790, 0.201, 0.151, 0.39),
    row("open_meteo_marine", 48, 799, 0.243, 0.164, 0.36),
    row("open_meteo_marine", 72, 714, 0.245, 0.164, 0.37),
    row("persistence", 24, 530, 0.181, 0.199, 0.51),
    row("raw_surf:EURO", 24, 658, 0.185, 0.172, 0.47),
]

SCENARIOS = [
    ("2026-08-10  run 31426692621 (Audit 11.1's own numbers)", RUN_0810),
    ("2026-08-12  run 31606511901 (live, this audit's RV-02)", RUN_0812),
]


def grade(rows, when, cfg=None):
    return evaluate_scored_segment([], when, paired=rows, cfg=cfg or default_cfg())


def main():
    print("=" * 96)
    print("RV-05  WS-CAN-0026 replay -- what the paired gate WOULD have returned")
    print("=" * 96)

    for label, rows in SCENARIOS:
        print("\n### %s" % label)
        for when, tag in ((datetime(2026, 8, 12, 19, 0, tzinfo=timezone.utc), "TODAY (pre-arm, grace to 08-22)"),
                          (datetime(2026, 8, 25, 0, 0, tzinfo=timezone.utc), "AFTER 08-22 (armed)")):
            code, lines = grade(rows, when)
            print("\n  as of %s -> %-8s   %s" % (when.strftime("%Y-%m-%d"), NAME[code], tag))
            for l in lines:
                if "::error::" in l or "::warning::" in l or "not gradeable" in l:
                    print("      " + l.replace("::error::", "[ERROR] ").replace("::warning::", "[warn]  ")[:160])

    print("\n" + "=" * 96)
    print("CONTROLS")
    print("=" * 96)
    armed = datetime(2026, 8, 25, 0, 0, tzinfo=timezone.utc)

    cfg = default_cfg()
    cfg["paired_gate"] = False
    print("  kill switch ACCURACY_PAIRED_GATE=0, armed date, 08-12 data -> %s"
          % NAME[grade(RUN_0812, armed, cfg)[0]])

    winning = [row("persistence", 24, 1790, 0.150, 0.176, 0.58),
               row("open_meteo_marine", 24, 1770, 0.140, 0.143, 0.52)]
    print("  POSITIVE CONTROL (we beat both, armed)                       -> %s"
          % NAME[grade(winning, armed)[0]])

    thin = [r for r in RUN_0812 if r["source"] != "persistence"]
    print("  no persistence row at all (armed)                            -> %s"
          % NAME[grade(thin, armed)[0]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
