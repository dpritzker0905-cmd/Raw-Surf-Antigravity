"""Bind exact support sources and fresh local verification; no application imports."""
import ast
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
SOURCE = "backend/routes/admin/support.py"


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


entry = read("entry-hashes.json")
entry["files"] = {path: value["sha256"] if isinstance(value, dict) else value for path, value in entry["files"].items()}
checkpoint = []
for name, digest in entry["files"].items():
    final = sha((ROOT / name).read_bytes())
    if name != SOURCE:
        assert final == digest, name
    checkpoint.append({"path": name, "sha256": digest, "finalSha256": final, "intendedChange": name == SOURCE})
text = (ROOT / SOURCE).read_text(encoding="utf-8")
head = git("show", "HEAD:" + SOURCE) + "\n"
lines, head_lines = text.splitlines(keepends=True), head.splitlines(keepends=True)
names = {"generate_ticket_number", "create_ticket"}
old_nodes = {node.name: node for node in ast.parse(head).body if isinstance(node, ast.AsyncFunctionDef) and node.name in names}
new_nodes = [node for node in ast.parse(text).body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
assert len(old_nodes) == len(new_nodes) == 2
for node in sorted(new_nodes, key=lambda node: node.lineno, reverse=True):
    old = old_nodes[node.name]
    lines[node.lineno - 1:node.end_lineno] = head_lines[old.lineno - 1:old.end_lineno]
restored = "".join(lines)
for line in ["from sqlalchemy.dialects.postgresql import insert as pg_insert\n", "from sqlalchemy.dialects.sqlite import insert as sqlite_insert\n", "import secrets\n"]:
    assert restored.count(line) == 1
    restored = restored.replace(line, "")
assert sha(restored.encode()) == entry["files"][SOURCE], "Only two functions and three imports may change"
ui = read("recheck-raw.json")
assert ui["numPassedTests"] == ui["numTotalTests"] == 78 and ui["numFailedTests"] == 0
databases = {}
for dialect in ["sqlite", "postgresql"]:
    baseline, final = read("baseline-" + dialect + ".json"), read("final-" + dialect + ".json")
    assert baseline["passed"] == 0 and baseline["total"] == 2
    assert final["passed"] == final["total"] == 17
    assert all(case.get("existingRowsPreserved", True) and case.get("noCountQuery", True) for case in final["cases"])
    databases[dialect] = {"baselinePassed": baseline["passed"], "baselineTotal": baseline["total"], "finalPassed": final["passed"], "finalTotal": final["total"],
                          "cases": [{"name": case["name"], "passed": case["passed"]} for case in final["cases"]]}
controls = {label: read(label + "-postgres-control.json") for label in ["baseline", "final"]}
assert all(control["expectationsMet"] and control["pgStatusStopped"] and control["osListenerAbsent"] for control in controls.values())
contracts = {}
for file, expected in [("recheck-reopen.json", 26), ("final-reopen.json", 26), ("metrics-recheck.json", 12), ("metrics-final.json", 12),
                       ("status-contract.json", 10), ("sla-scope-cases.json", 11), ("list-final.json", 10)]:
    data = read(file)
    assert data["passed"] == data["total"] == expected
    contracts[file] = {"passed": data["passed"], "total": data["total"]}
browser = read("browser-results.json")
assert len(browser["results"]) == 6
assert all(case["passed"] and case["numberFit"]["passed"] and case["characterSet"] == "UTF-8" and not case["externalRequests"] and not case["pageErrors"] and not case["horizontalOverflow"] for case in browser["results"])
fixture_files = [SOURCE] + [str(file.relative_to(ROOT)).replace("\\", "/") for file in OUT.iterdir() if file.suffix in {".py", ".cjs", ".js", ".jsx"}]
subprocess.run([sys.executable, "-m", "flake8", SOURCE, str(OUT / "verify-numbering.py"), str(OUT / "run-postgres.py"), str(OUT / "collect-evidence.py"), "--select", "E9,F63,F7,F82"], cwd=ROOT, check=True)
for file in fixture_files:
    if file.endswith(".py"):
        compile((ROOT / file).read_text(encoding="utf-8"), file, "exec")
git("diff", "--check")
runtime = sorted(git("diff", "--name-only", "HEAD", "--", "frontend/src", "backend").splitlines())
assert runtime == [SOURCE, "frontend/src/components/admin/AdminSupportDashboard.js"]
result = {"verifiedAt": datetime.now(timezone.utc).isoformat(), "head": git("rev-parse", "HEAD"), "branch": git("branch", "--show-current"),
          "entryHashes": len(checkpoint), "checkpoint": checkpoint, "onlyTwoFunctionsAndThreeImportsChanged": True, "frontendUnchangedThisSlice": True,
          "uiRecheck": {"passed": ui["numPassedTests"], "total": ui["numTotalTests"], "startedAtEpochMs": ui["startTime"],
                        "suites": [{"file": Path(suite["name"]).name, "passed": sum(case["status"] == "passed" for case in suite["assertionResults"])} for suite in ui["testResults"]]},
          "databaseCases": databases, "postgresControl": controls, "priorContracts": contracts,
          "browser": {"version": browser["browserVersion"], "passed": len(browser["results"]), "themes": ["light", "dark", "beach"],
                      "viewports": ["1440x1000", "390x844"], "fullTwentyCharacterReferenceFit": True, "externalRequests": 0, "pageErrors": 0, "horizontalOverflow": False},
          "quality": {"narrowFlake8": "pass E9,F63,F7,F82", "pythonSyntax": "pass", "whitespace": "pass"},
          "files": [{"path": file, "sha256": sha((ROOT / file).read_bytes())} for file in fixture_files], "cumulativeRuntimeChanges": runtime,
          "limits": ["Owned SQLite and PostgreSQL17.11 fixtures using actual functions/models; no mounted auth/API or hosted schema qualification",
                     "Concurrent insert and forced number-collision tests do not establish request-level idempotency; commit uncertainty propagates without automatic retry",
                     "New random references replace sequential numbering only for future tickets; no historical rewrite or migration",
                     "Actual UI/Chrome with fictional transport; no physical device, other browser or assistive technology acceptance",
                     "No application/env/weather runtime, shared database, provider/security/paid/commit/push/merge/deploy action"]}
(OUT / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"entryHashes": len(checkpoint), "protectedFiles": len(checkpoint) - 1, "ui": ui["numPassedTests"],
                  "sqlite": "17/17", "postgresql": "17/17", "browser": 6, "postgresStopped": True, "sourceBoundary": "two functions and three imports"}))
