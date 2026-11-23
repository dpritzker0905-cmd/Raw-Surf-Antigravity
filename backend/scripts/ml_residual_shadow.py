"""Shadow read of a gradient-boosted residual correction vs Move 4's ocf_rolling (pre-registered, aggregates only).

Pre-registration: docs/weather-program/log/2026-11-16-claude-verifier-ml-residual-shadow.md, section 1 (fe5a9143f).
Reads the scored ledger segments from private Storage (the monitor's read pair); runs only in the dispatch-only workflow
ml-residual-shadow.yml. Prints per-lead and per-region-x-lead aggregates, the null, the planted-shift control and the
verdict. No row, observation series or credential is printed. Serves nothing.

    python scripts/ml_residual_shadow.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import skill_ml_residual as M  # noqa: E402

MIN_PAIRS, MIN_BUOYS = 1000, 20


def _i(t):
    return "n/a" if not t else "[%+.3f, %+.3f]" % t


def run(rows):
    pairs = M.build_pairs(rows)
    base = M.ocf_rolling(pairs)
    served_roll = M.ocf_rolling(pairs, members=(M.SERVED,))
    ml = M.cross_validate(pairs)
    null = M.cross_validate(pairs, null=True)
    planted = M.cross_validate(pairs, plant=True)
    main = M.grade(pairs, ml, base)
    null_g = M.grade(pairs, null, base)
    side = M.grade(pairs, ml, served_roll)
    shift = M.plant_recovery(pairs, ml, planted)
    coverage_ok = all((c := main["pooled"].get(lead)) and c["n"] >= MIN_PAIRS and c["buoys"] >= MIN_BUOYS
                      for lead in M.LEADS)
    call, reasons = M.verdict(main, null_g, shift, coverage_ok)
    out = ["== ML residual shadow (pre-registered; aggregates only). dMAE = MAE(ML) - MAE(ocf_rolling), m",
           "-- pairs %d (hole buoys excluded), predicted out of sample %d" % (len(pairs), len(ml))]
    for lead in M.LEADS:
        c, n, s = main["pooled"].get(lead), null_g["pooled"].get(lead), side["pooled"].get(lead)
        if not c:
            out.append("  +%dh no test pairs" % lead)
            continue
        out.append("  +%dh n=%d buoys=%d days=%d | MAE ML %.3f vs ocf_rolling %.3f | dMAE %+.3f 3-day %s 1-day %s"
                   % (lead, c["n"], c["buoys"], c["days"], c["mae_ml"], c["mae_base"], c["dmae"], _i(c["i3"]), _i(c["i1"])))
        out.append("        null dMAE %+.3f %s | vs served-rolling %+.3f %s"
                   % (n["dmae"], _i(n["i3"]), s["dmae"], _i(s["i3"])) if n and s else "        null/side n/a")
    out.append("-- region x lead (testable: >= 100 pairs on >= 7 days)")
    for (reg, lead), c in sorted(main["regions"].items()):
        tag = "" if (c["n"] >= 100 and c["days"] >= 7) else " UNTESTABLE"
        out.append("  %-12s +%dh n=%5d %2dd | %.3f vs %.3f | %+.3f %s%s"
                   % (reg, lead, c["n"], c["days"], c["mae_ml"], c["mae_base"], c["dmae"], _i(c["i3"]), tag))
    out.append("-- planted +%.2f m where tp >= %.0f s: shift recovered %s on %d pairs; others %s on %d"
               % (M.PLANT_M, M.PLANT_TP, "n/a" if shift["planted"] is None else "%+.3f" % shift["planted"],
                  shift["n_planted"], "n/a" if shift["other"] is None else "%+.3f" % shift["other"], shift["n_other"]))
    out.append("== VERDICT: %s%s" % (call, ("  (" + "; ".join(reasons) + ")") if reasons else ""))
    return out, call


def main():
    from scripts.forecast_accuracy_monitor import _fetch_scored_month
    from services import buoy_holdout      # the LOCKED final buoy holdout (#1199)
    now = datetime.now(timezone.utc)
    through = (now + timedelta(days=1)).date()
    rows, m = [], datetime(2026, 8, 1, tzinfo=timezone.utc)
    while m <= now:
        got = _fetch_scored_month(f"{m:%Y-%m}", through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % f"{m:%Y-%m}")
            return 3
        rows += buoy_holdout.drop(got, "buoy_id")
        m = (m + timedelta(days=32)).replace(day=1)
    out, call = run(rows)
    print("\n".join(out))
    return 0 if call == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
