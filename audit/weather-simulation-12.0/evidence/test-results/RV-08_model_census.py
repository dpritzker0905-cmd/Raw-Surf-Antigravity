# -*- coding: utf-8 -*-
"""RV-08 -- DEFAULT-MODEL CENSUS: is raw_surf:EURO durably better than the served raw_surf (GFS)?

METHOD, and why it is two measurements and not one:
  STABILITY  the trailing-7d PAIRED head-to-head printed by every scheduled accuracy-monitor run,
             read across 17 runs (2026-08-09 .. 08-12). Large n (~1900), one question: does the
             sign hold, or is one storm carrying it? A single cross-section cannot answer this --
             the 08-10 vs 08-12 persistence flip in RV-05 is the proof that it cannot.
  SHAPE      the live /api/weather/buoy-calibration `forecast_skill` block: per source x lead,
             with bias, RMSE, scatter index, correlation and an observed-height band split. Small
             n (~34), one question: WHERE does the difference live, and which direction is the
             error. MAE alone hides both.

ASCII stdout only (cp1252).
"""
import json
import os
import re
import sys

CACHE = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Temp", "claude",
                     "C--Users-dprit-Raw-Surf", "5cb6b5f8-99a2-4160-8d87-7ecdb27103b9",
                     "scratchpad", "runlogs")
REPO = r"C:\Users\dprit\Raw-Surf"
CAL = os.path.join(REPO, "audit", "weather-simulation-12.0", "evidence",
                   "runtime-verification", "RV-07_buoy_calibration_20260812.json")

PAIRED = re.compile(
    r"vs\s+(\S+)\s+\+(\d+)h\s+n=(\d+)\s+ours=([\d.]+)\s+theirs=([\d.]+)\s+"
    r"delta=([+-][\d.]+)\s+win=(\d+)%")
MAE = re.compile(r"height MAE ([\d.]+) m over n=(\d+) buoys")


def load_runs():
    idx = json.load(open(os.path.join(CACHE, "_index.json"), encoding="utf-8"))
    out = []
    for r in sorted(idx, key=lambda x: x["createdAt"]):
        p = os.path.join(CACHE, str(r["databaseId"]) + ".log")
        if not os.path.exists(p):
            continue
        txt = open(p, encoding="utf-8", errors="replace").read()
        rows = [{"source": m.group(1), "lead_h": int(m.group(2)), "n": int(m.group(3)),
                 "ours": float(m.group(4)), "theirs": float(m.group(5)),
                 "delta": float(m.group(6)), "win": int(m.group(7))}
                for m in PAIRED.finditer(txt)]
        mm = MAE.search(txt)
        out.append({"id": r["databaseId"], "at": r["createdAt"][:16].replace("T", " "),
                    "mae": float(mm.group(1)) if mm else None, "rows": rows})
    return out


def series(runs, source, lead):
    return [(r["at"], x) for r in runs for x in r["rows"]
            if x["source"] == source and x["lead_h"] == lead]


def main():
    runs = load_runs()
    withp = [r for r in runs if r["rows"]]
    print("=" * 100)
    print("RV-08  DEFAULT-MODEL CENSUS -- raw_surf (GFS, served) vs raw_surf:EURO")
    print("=" * 100)
    print("runs read: %d   with a paired table: %d   window: %s .. %s"
          % (len(runs), len(withp), runs[0]["at"], runs[-1]["at"]))
    print("(the paired table only exists from 60f724d0, 2026-08-10 12:37 -- earlier runs are")
    print(" per-source only and cannot support a comparison; they are excluded, not counted as ties)")

    print("\n" + "=" * 100)
    print("PART 1 -- STABILITY: the trailing-7d paired delta, run by run")
    print("=" * 100)
    for lead in (24, 48, 72):
        s = series(withp, "raw_surf:EURO", lead)
        if not s:
            continue
        print("\n  +%dh   (delta = ours - EURO; POSITIVE means EURO is better)" % lead)
        print("  %-17s %7s %9s %9s %8s %7s" % ("run", "n", "ours", "EURO", "delta", "win%"))
        for at, x in s:
            print("  %-17s %7d %9.3f %9.3f %+8.3f %6d%%" % (at, x["n"], x["ours"], x["theirs"],
                                                            x["delta"], x["win"]))
        d = [x["delta"] for _, x in s]
        wins = sum(1 for v in d if v > 0)
        print("  ---> EURO better in %d of %d runs | delta min %+.3f max %+.3f mean %+.3f"
              % (wins, len(d), min(d), max(d), sum(d) / len(d)))

    print("\n" + "=" * 100)
    print("PART 2 -- CONTROLS: the same statistic for lanes whose answer we already know")
    print("=" * 100)
    for src, expect in (("raw_surf:ICON", "we should WIN (ICON is the weak lane)"),
                        ("open_meteo_marine", "we should LOSE (known since 08-10)"),
                        ("persistence", "the skill floor")):
        s = series(withp, src, 24)
        if not s:
            continue
        d = [x["delta"] for _, x in s]
        wins = sum(1 for v in d if v > 0)
        print("  %-20s +24h  n_runs=%2d  delta mean %+.3f  [they beat us in %d of %d]   %s"
              % (src, len(d), sum(d) / len(d), wins, len(d), expect))

    print("\n" + "=" * 100)
    print("PART 3 -- SHAPE: where the difference lives (live calibration report)")
    print("=" * 100)
    d = json.load(open(CAL, encoding="utf-8"))
    fs = {(s["source"], s["lead_h"]): s for s in d["forecast_skill"]}
    print("  snapshot generated_at %s   (n~34 per cell -- SHAPE only, never stability)"
          % d.get("generated_at", "")[:19])
    print("\n  %-6s | %-32s | %-32s" % ("lead", "raw_surf (GFS, SERVED)", "raw_surf:EURO"))
    print("  %-6s | %8s %8s %7s %6s | %8s %8s %7s %6s" %
          ("", "mae", "bias", "si", "corr", "mae", "bias", "si", "corr"))
    for lead in (24, 48, 72):
        g, e = fs.get(("raw_surf", lead)), fs.get(("raw_surf:EURO", lead))
        if not g or not e:
            continue
        print("  +%-5d| %8.3f %+8.3f %7.3f %6.3f | %8.3f %+8.3f %7.3f %6.3f"
              % (lead, g["mae_m"], g["bias_m"], g["si"] or 0, g["corr"] or 0,
                 e["mae_m"], e["bias_m"], e["si"] or 0, e["corr"] or 0))

    print("\n  OBSERVED-HEIGHT BANDS (the tail question -- MAE alone hides it)")
    for lead in (24, 48, 72):
        g, e = fs.get(("raw_surf", lead)), fs.get(("raw_surf:EURO", lead))
        if not g or not e:
            continue
        print("\n   +%dh  %-17s %4s | %8s %9s | %8s %9s | %s"
              % (lead, "band", "n", "GFS mae", "GFS bias", "EURO mae", "EURO bias", "winner"))
        for b in ("flat <0.5m", "small 0.5-1.5m", "rideable 1.5-3m", "big 3m+"):
            a, c = (g.get("by_obs_band") or {}).get(b), (e.get("by_obs_band") or {}).get(b)
            if not a or not c:
                print("        %-17s %4s | %s" % (b, "-", "NOT SAMPLED in this snapshot"))
                continue
            print("        %-17s %4d | %8.3f %+9.3f | %8.3f %+9.3f | %s"
                  % (b, a["n_paired"], a["mae_m"], a["bias_m"], c["mae_m"], c["bias_m"],
                     "EURO" if c["mae_m"] < a["mae_m"] else "GFS"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
