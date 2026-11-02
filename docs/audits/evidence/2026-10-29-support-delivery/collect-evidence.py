"""Bind tested owned support units and untouched shared boundaries; no application imports."""
import hashlib
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()


changed_prior = {"backend/routes/admin/support.py", "frontend/src/components/admin/AdminSupportDashboard.js",
                 "frontend/src/components/admin/AdminSupportDashboard.test.js", "frontend/src/components/admin/AdminSupportDashboard.metrics.test.js"}
entry = read("entry-hashes.json")
for field in ["prior_files", "observed"]:
    entry[field] = {path: value["sha256"] if isinstance(value, dict) else value for path, value in entry[field].items()}
format_proof = read("fingerprint-format.json")
formatted = {item["path"]: item for item in format_proof["records"]}
readers = {item["path"]: item for item in format_proof["readerCompatibility"]}
for file, proof in formatted.items():
    raw = (ROOT / file).read_bytes()
    data = json.loads(raw)
    for field in ["files", "prior_files", "observed"]:
        if field in data:
            data[field] = {path: value["sha256"] if isinstance(value, dict) else value for path, value in data[field].items()}
    original = json.dumps(data, indent=2).encode() + b"\n"
    if proof["legacyNewlines"] == "CRLF":
        original = original.replace(b"\n", b"\r\n")
    assert sha(raw) == proof["afterSha256"] and sha(original) == proof["beforeSha256"], file
for file, proof in readers.items():
    raw = (ROOT / file).read_bytes()
    newline = b"\r\n" if proof["newlines"] == "CRLF" else b"\n"
    addition = proof["addedLine"].encode() + newline
    assert raw.count(addition) == 1 and sha(raw.replace(addition, b"", 1)) == proof["beforeSha256"], file
    assert sha(raw) == proof["afterSha256"], file
semantic_metadata, compatibility_readers = [], []
protected = []
for file, digest in entry["prior_files"].items():
    actual = sha((ROOT / file).read_bytes())
    if file not in changed_prior:
        if file in formatted:
            proof = formatted[file]
            data = json.loads((ROOT / file).read_bytes())
            for field in ["files", "prior_files", "observed"]:
                if field in data:
                    data[field] = {path: value["sha256"] if isinstance(value, dict) else value for path, value in data[field].items()}
            original = json.dumps(data, indent=2).encode() + b"\n"
            if proof["legacyNewlines"] == "CRLF":
                original = original.replace(b"\n", b"\r\n")
            assert sha(original) == digest == proof["beforeSha256"] and actual == proof["afterSha256"], file
            semantic_metadata.append(file)
        elif file in readers:
            proof = readers[file]
            newline = b"\r\n" if proof["newlines"] == "CRLF" else b"\n"
            addition = proof["addedLine"].encode() + newline
            current = (ROOT / file).read_bytes()
            assert current.count(addition) == 1 and sha(current.replace(addition, b"", 1)) == digest == proof["beforeSha256"], file
            assert actual == proof["afterSha256"], file
            compatibility_readers.append(file)
        else:
            assert actual == digest, file
            protected.append(file)
for file in ["frontend/src/App.js", "frontend/src/lib/apiClient.js", "frontend/src/components/routing/ProtectedRoute.js"]:
    assert sha((ROOT / file).read_bytes()) == entry["observed"][file], file
ui = read("ui-raw.json")
assert ui["numPassedTests"] == ui["numTotalTests"] == 95 and ui["numFailedTests"] == 0
browser = read("browser-results.json")
assert len(browser["results"]) == 6 and all(case["passed"] and not case["externalRequests"] and not case["pageErrors"] and not case["horizontalOverflow"] for case in browser["results"])
for name, count in [("delivery-results.json", 37), ("delivery-postgresql.json", 37), ("final-sqlite.json", 17), ("final-postgresql.json", 17)]:
    result = read(name)
    assert result["passed"] == result["total"] == count, name
controls = {name: read(name) for name in ["final-postgres-control.json", "allocation-final-postgres-control.json"]}
assert all(control["expectationsMet"] and control["pgStatusStopped"] and control["osListenerAbsent"] for control in controls.values())
mailer = ET.parse(OUT / "mailer-junit.xml").getroot()
assert sum(int(suite.attrib["tests"]) for suite in mailer.iter("testsuite")) == 140
assert all(int(suite.attrib.get("failures", 0)) == int(suite.attrib.get("errors", 0)) == 0 for suite in mailer.iter("testsuite"))
lint = read("lint-raw.json")
assert all(file["errorCount"] == file["warningCount"] == 0 for file in lint)
files = ["backend/routes/admin/support.py", "backend/services/support_delivery.py", "backend/services/mailer/outbox.py",
         "backend/services/mailer/senders.py", "backend/services/mailer/templates.py", "backend/tests/test_email_service.py",
         "backend/tests/test_email_templates_and_webhook.py", "backend/tests/test_support_delivery_fixture.py",
         "frontend/src/components/Auth.js", "frontend/src/components/admin/AdminSupportDashboard.js"]
files += [str(path.relative_to(ROOT)).replace("\\", "/") for path in (ROOT / "frontend/src/components/support").glob("*.js")]
files += [str(path.relative_to(ROOT)).replace("\\", "/") for path in (ROOT / "frontend/src/components/admin").glob("AdminSupportDashboard*.test.js")]
fixtures = [str(path.relative_to(ROOT)).replace("\\", "/") for path in OUT.iterdir() if path.suffix in {".py", ".cjs", ".js", ".jsx"}]
subprocess.run([sys.executable, "-m", "flake8", "--select", "E9,F63,F7,F82", *[file for file in files + fixtures if file.endswith(".py")]], cwd=ROOT, check=True)
fingerprints = []
for file in files + fixtures:
    data = (ROOT / file).read_bytes()
    assert len(data.splitlines()) <= 800, file
    if file.endswith(".py"):
        compile(data, file, "exec")
    fingerprints.append({"path": file, "sha256": sha(data), "canonicalLfSha256": sha(data.replace(b"\r\n", b"\n")),
                         "gitBlob": git("hash-object", "--path=" + file, file)})
git("diff", "--check")
result = {"verifiedAt": datetime.now(timezone.utc).isoformat(), "headBeforeLocalCommit": git("rev-parse", "HEAD"),
          "branch": git("branch", "--show-current"), "priorEntryFiles": len(entry["prior_files"]), "protectedPriorFiles": len(protected),
          "metadataOriginalBytesReconstruct": semantic_metadata, "readersOriginalBytesReconstruct": compatibility_readers,
          "typedFingerprintMetadata": {"files": len(formatted), "allOriginalBytesReconstruct": True, "readerAdapters": len(readers), "hookBypass": False},
          "intentionalPriorChanges": sorted(changed_prior), "sharedBoundariesUnchanged": ["App.js", "ProtectedRoute.js", "apiClient.js", "notification consumers"],
          "ui": {"passed": 95, "suites": [{"file": Path(suite["name"]).name, "passed": sum(case["status"] == "passed" for case in suite["assertionResults"])} for suite in ui["testResults"]]},
          "api": {"sqlite": 37, "postgresql": 37, "fakeIdentityDependency": True, "cases": read("delivery-results.json")["cases"]},
          "allocationRegression": {"sqlite": 17, "postgresql": 17}, "mailer": {"passed": 140, "fakeTransportsOnly": True, "cases": [case.attrib["name"] for case in mailer.iter("testcase")]},
          "browser": {"passed": 6, "version": browser["browserVersion"], "realAuthProtectedRouteAndAdapter": True,
                      "fakeApiIdentityShellAndTos": True, "externalRequests": 0, "pageErrors": 0, "horizontalOverflow": False},
          "postgresControl": controls, "scopedLint": {"errors": 0, "warnings": 0}, "pythonSyntaxAndSize": "pass", "whitespace": "pass",
          "files": fingerprints, "limits": ["App.js mounting belongs to booking owner and is not integrated; notification-consumer implementation not integrated; contract/reservations acknowledged",
                                            "Two cross-chat sends were rejected by approval review; no further attempt or alternate transfer",
                                            "ASGI fixture substitutes identity dependencies; not actual JWT cryptography or live accounts",
                                            "Email is opt-in and subject to existing low-priority delay/rate/suppression/budget; no provider/network effects",
                                            "No full-app/hosted schema/hosted CI/device/cross-browser acceptance or merge/deployment authorization",
                                            "Working-tree checks before any local commit; canonical fingerprints bind later committed bytes but do not imply post-commit execution"]}
(OUT / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"protectedPrior": len(protected), "ui": 95, "api": "37 SQLite/37 PostgreSQL", "mailer": 140, "allocation": "17 SQLite/17 PostgreSQL", "chrome": 6, "files": len(fingerprints)}))
