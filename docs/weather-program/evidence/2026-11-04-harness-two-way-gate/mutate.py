"""Mutation check for the D-066 two-way gate: every mutant must turn at least one test RED."""
import subprocess
import sys

B = "C:/t/h2w/backend/"
PY = "C:/Users/David/App/raw-surf/backend/.venv/Scripts/python.exe"
TW = B + "services/weather_pipeline/eval_twoway.py"
EG = B + "services/weather_pipeline/eval_gate.py"
EH = B + "scripts/eval_harness.py"
FS = B + "scripts/flip_scorecard.py"
RT = B + "services/weather_pipeline/eval_ratchet.py"
MUTANTS = [
    ("MIN_DAYS 14 -> 7", TW, "MIN_DAYS = 14", "MIN_DAYS = 7"),
    ("normal 1.96 instead of the day-t", TW, "    k = t_quantile(1 - (1 - level) / 2, df) * math.sqrt(fac)\n", "    k = 1.96\n"),
    ("no small-cluster factor", TW, "    fac = nd / (nd - 1) if nd > 1 else 1.0\n", "    fac = 1.0\n"),
    ("single linkage", TW, "far = max(d(a, b) for a in cl[i] for b in cl[j])", "far = min(d(a, b) for a in cl[i] for b in cl[j])"),
    ("block km 100 -> 300", TW, "BLOCK_KM = 100.0", "BLOCK_KM = 300.0"),
    ("untouched stations kept", TW, 'moved = {i["buoy"] for i in items if i["f_cand"] != i["f_ref"]}', 'moved = {i["buoy"] for i in items}'),
    ("day = the hour", TW, '    return t.strftime("%Y-%m-%d") if hasattr(t, "strftime") else str(t)[:10]', '    return t.strftime("%Y-%m-%dT%H") if hasattr(t, "strftime") else str(t)'),
    ("self-test never refuses", TW, '    if not r["ok"]:\n        raise CalibrationFailed', '    if False:\n        raise CalibrationFailed'),
    ("false-pass limit 50%", TW, "MAX_FALSE_PASS = 0.05", "MAX_FALSE_PASS = 0.50"),
    ("gate: lower bound at 0 passes", EG, 'if w2.get("computable") and w2["ci"][0] <= 0:', 'if w2.get("computable") and w2["ci"][0] < 0:'),
    ("gate: two-way ignored", EG, 'if w2.get("computable") and w2["ci"][0] <= 0:', 'if False:'),
    ("gate: short window passes", EG, '    if not w2.get("computable"):\n        return {"verdict": "REFUSED"', '    if False:\n        return {"verdict": "REFUSED"'),
    ("gate: layout calibration ignored", EG, "    cal = tw.calibrate_items(base_items) if calibrate else None", "    cal = None"),
    ("controls: two-way-only positive FAIL stays FAIL", EG, 'all(x.startswith("the binding two-way") for x in r["reasons"])', 'False'),
    ("controls: calibration power shortfall ignored", EG, "underpowered = cal is not None and false_pass_ok and not cal[\"ok\"]", "underpowered = False"),
    ("harness: no self-test", EH, "    self_test = tw.require_calibrated()", "    self_test = tw.self_test()"),
    ("flip: 7-day windows again", FS, "if target_days < tw.MIN_DAYS or days > MAX_WINDOW_DAYS:", "if target_days < 7 or days > MAX_WINDOW_DAYS:"),
    ("ratchet: lock without two-way", RT, 'beats_climatology=bool(ci and ci[0] > 0 and w2["computable"] and w2["ci"][0] > 0)', 'beats_climatology=bool(ci and ci[0] > 0)'),
]
TESTS = ["tests/test_eval_twoway.py", "tests/test_eval_harness_scoring.py", "tests/test_eval_harness_ratchet.py",
         "tests/test_flip_scorecard.py", "tests/test_eval_harness_e2e.py"]


def main():
    only = sys.argv[1:]
    res = []
    for name, path, old, new in MUTANTS:
        if only and not any(o in name for o in only):
            continue
        src = open(path, encoding="utf-8").read()
        assert src.count(old) == 1, (name, src.count(old))
        open(path, "w", encoding="utf-8", newline="\n").write(src.replace(old, new))
        try:
            p = subprocess.run([PY, "-m", "pytest", *TESTS, "-q", "-x", "-p", "no:cacheprovider",
                                "--basetemp=C:/t/h2w-scr/ptm"], cwd=B, capture_output=True, text=True, timeout=1200)
        finally:
            open(path, "w", encoding="utf-8", newline="\n").write(src)
        killed = p.returncode != 0
        tail = [ln for ln in p.stdout.splitlines() if ln.startswith("FAILED")][:1]
        res.append((name, killed, tail))
        print(("KILLED  " if killed else "SURVIVED") + " " + name + " " + " ".join(tail), flush=True)
    print(f"{sum(k for _, k, _ in res)}/{len(res)} killed")


if __name__ == "__main__":
    main()
