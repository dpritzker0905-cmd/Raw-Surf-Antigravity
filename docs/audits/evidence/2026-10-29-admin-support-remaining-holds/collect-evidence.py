"""Preservation recheck and bounded source observations; no app or external delivery."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


entry = read("entry-hashes.json")
entry["files"] = {path: value["sha256"] if isinstance(value, dict) else value for path, value in entry["files"].items()}
assert all(digest(ROOT / file) == value for file, value in entry["files"].items())
sqlite, postgres, control = read("final-sqlite.json"), read("final-postgresql.json"), read("final-postgres-control.json")
reopen = read("reopen-recheck.json")
assert sqlite["passed"] == sqlite["total"] == postgres["passed"] == postgres["total"] == 17
assert reopen["passed"] == reopen["total"] == 26
assert control["expectationsMet"] and control["pgStatusStopped"] and control["osListenerAbsent"]
source = (ROOT / "backend/routes/admin/support.py").read_text(encoding="utf-8")
deep_links = (ROOT / "frontend/src/utils/notificationDeepLinks.js").read_text(encoding="utf-8")
page = (ROOT / "frontend/src/components/NotificationsPage.js").read_text(encoding="utf-8")
assert '@router.post("/support/tickets")' in source and '@router.get("/support/tickets' not in source
assert 'updates["sla_due_at"] = calculate_sla_due(TicketPriorityEnum(request.priority))' in source
assert "case 'support_reply':" not in deep_links and "case 'support_ticket':" not in deep_links
assert "line-clamp-2" in page
observers = ["backend/routes/admin/support.py", "backend/models/social.py", "frontend/src/utils/notificationDeepLinks.js",
             "frontend/src/components/NotificationsPage.js", "frontend/src/components/BookingPaymentSuccess.js", "frontend/src/components/DispatchPaymentSuccess.js"]
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
assert head == entry["head"]
subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)
result = {"verifiedAt": datetime.now(timezone.utc).isoformat(), "head": head, "priorFilesPreserved": len(entry["files"]), "productionChangesThisTurn": [],
          "freshChecks": {"sqliteAllocation": {"passed": 17, "total": 17}, "postgresAllocation": {"passed": 17, "total": 17}, "reopen": {"passed": 26, "total": 26}},
          "postgresControl": control, "retainedEarlierEvidenceNotRerun": {"uiTests": 78, "chromeThemeViewportScenarios": 6},
          "remainingAuditFindings": [{"ids": [175, 176, 464], "state": "delivery workflow and user entry/read surface require product decision; notification consumers reserved by companion"},
                                     {"ids": [179], "state": "remaining priority-to-SLA reset semantics require product policy"}],
          "sourceObservations": [{"path": file, "sha256": digest(ROOT / file)} for file in observers],
          "limits": ["Targeted source searches; alternate clients/entry points not excluded", "No mounted auth/API, provider/live ticket delivery or hosted qualification",
                     "No source edits, shared integration/migration, flags, paid resource, security probe, commit/push/merge/deploy or weather runtime actions",
                     "No direct Claude messaging or app/internal-folder inspection; shared repository plans read only"]}
(OUT / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"preservedHashes": len(entry["files"]), "sqlite": "17/17", "postgresql": "17/17", "reopen": "26/26", "productionChanges": 0, "postgresStopped": True}))
