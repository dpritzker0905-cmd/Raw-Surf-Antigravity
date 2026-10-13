"""Reconcile sanitized hosted CI logs for one immutable candidate; no source edits."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
receipt_path = OUT / "ci-receipt.json"
receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
head = receipt["expected_head"]
base = "607af934e74fa87f3b8e58698ef68fdce919ea54"
merge_sha = "21feff6f3b4b225191120201cca9cc0f0157d54c"
repo = "dpritzker0905-cmd/Raw-Surf-Antigravity"


def run(*args):
    return subprocess.check_output(args, cwd=ROOT).decode("utf-8")


merge = json.loads(run("gh", "api", f"repos/{repo}/git/commits/{merge_sha}",
                      "--jq", "{sha,tree:.tree.sha,parents:[.parents[].sha]}"))
assert merge["parents"] == [base, head]
assert merge["tree"] == run("git", "rev-parse", f"{head}^{{tree}}").strip()
receipt["checkout_identity"] = dict(merge, head_tree_matches_merge_tree=True)

logs = {}
for record in receipt["log_files"]:
    raw = (OUT / record["path"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == record["sha256"]
    logs[record["name"]] = raw.decode("utf-8")
    assert f"Z {merge_sha}" in logs[record["name"]], record["name"]

lane_specs = [
    ("guards", "backend-sim-composition-guards", "guard", 160, 1912, 66, 1, 13, 999.13, 1906),
    ("chain", "backend-forecast-chain-guards", "chain", 99, 1022, 0, 0, 6, 377.68, 1016),
    ("estate", "backend-estate-coverage", "estate", 266, 502, 2865, 0, 18, 55.36, 500),
]
lanes = {}
for lane, job, prefix, files, passed, skipped, xfailed, warnings, seconds, floor in lane_specs:
    text = logs[job]
    selected = re.findall(rf"Z   {prefix}: (tests/[^\r\n]+)", text)
    assert len(selected) == len(set(selected)) == files
    summary = f"{passed} passed, "
    if skipped:
        summary += f"{skipped} skipped, "
    if xfailed:
        summary += f"{xfailed} xfailed, "
    summary += f"{warnings} warnings in {seconds:.2f}s"
    assert summary in text
    lanes[lane] = {"job": job, "passed": passed, "skipped": skipped, "xfailed": xfailed,
                   "failed": 0, "errors": 0, "warnings": warnings, "seconds": seconds,
                   "selected_file_count": files, "selected_files": selected,
                   "pass_floor": floor, "reference_pass_count": passed, "margin": passed - floor}
    if lane != "estate":
        junit = f"collected {passed + skipped + xfailed} tests across {files} files -> {passed} passed, {skipped + xfailed} skipped, 0 failed, 0 errors"
        assert junit in text
        lanes[lane]["junit_skipped_including_xfail"] = skipped + xfailed
    else:
        assert "estate: 266 files selected, 264 produced results, 502 passed, 0 silent." in text
        lanes[lane].update(producing_files=264, silent_nonexempt_files=0)
assert "tests/test_nearshore_workflow_eligibility.py" in lanes["estate"]["selected_files"]
assert "Test Suites: 257 passed, 257 total" in logs["lint-and-build (18.x)"]
assert "Tests:       2486 passed, 2486 total" in logs["lint-and-build (18.x)"]
assert "Test Suites: 2 passed, 2 total" in logs["frontend-marine-composition-guards"]
assert "Tests:       48 passed, 48 total" in logs["frontend-marine-composition-guards"]
lanes["frontend"] = {"job": "lint-and-build (18.x)", "suites": 257, "passed": 2486,
                      "failed": 0, "seconds": 24.28, "suite_floor": 185, "pass_floor": 1686}
lanes["frontend_marine"] = {"job": "frontend-marine-composition-guards", "suites": 2,
                             "passed": 48, "failed": 0, "suite_floor": 2, "pass_floor": 48}
receipt["reconciliation"] = lanes

lint_diagnostics = re.findall(r"Z (\./[^\r\n]+: F\d{3} [^\r\n]+)", logs["backend-lint"])
assert len(lint_diagnostics) == 7
lint_files = sorted({"backend/" + line.split(":")[0][2:] for line in lint_diagnostics})
assert not run("git", "diff", "--name-only", base, head, "--", *lint_files).strip()
workflow = run("git", "show", f"{head}:.github/workflows/ci.yml")
assert "continue-on-error: true  # Warn only, don't block" in workflow
assert "MIN_FILES, MIN_PASSED = 160, 1906" in workflow
assert "MIN_FILES, MIN_PASSED = 99, 1016" in workflow
assert "MIN_PASSED = 500" in workflow
pair = run("git", "show", f"{head}:backend/tests/test_ci_floor_staleness.py")
assert '_FLOOR_SET_FROM = {"guards": 1912, "chain": 1022, "estate": 502}' in pair
receipt["floor_pair_verified_at_head"] = True
assert "ESLint gate — 1101 files linted, 154 errors, 923 warnings." in logs["frontend-lint"]
receipt["qualifications"] = {
    "backend_lint": {"broad_step_exit_code": 1, "continue_on_error": True,
                     "diagnostics": lint_diagnostics, "diagnostic_files_unchanged_from_base": True,
                     "strict_condition_reports_F821_step_passed": True},
    "frontend_lint": {"files": 1101, "errors": 154, "warnings": 923,
                      "baseline_ratchet_passed": True, "unused_import_warnings": "128 -> 126"},
    "npm_audit_reported": {"total": 54, "low": 14, "moderate": 12, "high": 24, "critical": 4,
                           "note": "Install-time report; not independently triaged or an exploitability assessment."},
    "runtime": {"python": "3.12.14", "frontend_build_node": "18.20.8",
                "frontend_lint_node": "18.20.2", "node_engine_warnings": "Several dependencies require Node >=20 or newer."},
    "python_warnings": ["AnyIO/Starlette, Pydantic, crypt, gotrue and datetime.utcnow deprecations",
                        "Guards: one unawaited AsyncMock coroutine in test_parity_unification.py at point_resolution.py:444"],
    "frontend_test_console": ["jsdom HTMLCanvasElement.getContext not implemented", "Intentional provider/fallback/error-path fixture console output"],
    "production_build": "Compiled with warnings; frontend tests and build completed successfully.",
    "full_frontend_floor_slack": {"suites": 72, "tests": 800,
                                  "note": "Existing floors185/1686 are much looser than observed257/2486; backend staleness checker does not ratchet these."},
    "floor_staleness_reference": {"run": 35483627338, "head": base,
                                  "observed": {"guards": 1883, "chain": 947, "estate": 488},
                                  "note": "Staleness job compares last green dev, not this PR run. This receipt independently reconciles current candidate floors."},
    "scientific_scope": "CI success does not establish common-observation forecast skill, visual correctness, production readiness, or credential revocation.",
}
receipt["sanitization"]["note"] = "Allowlisted GitHub metadata; logs additionally scrubbed for credential-like values. No environment or auth-store dump. Regex replacement counts include already masked/configuration text; they are not counts of exposed secrets."
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"head": head, "merge_tree_equal": True,
                  "lanes": {key: {k: v for k, v in value.items() if k != "selected_files"}
                            for key, value in lanes.items()},
                  "backend_lint_nonblocking_diagnostics": len(lint_diagnostics)}))
