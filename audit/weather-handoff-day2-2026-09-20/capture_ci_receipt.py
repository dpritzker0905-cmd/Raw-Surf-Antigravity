"""Read-only exact-run receipt capture; save only sanitized logs and metadata."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

OUT = Path(__file__).resolve().parent
REPO = "dpritzker0905-cmd/Raw-Surf-Antigravity"
RUN = "35487375744"
HEAD = "d82032f5cd5978967622721b8c9638da36a87f7d"


def gh(*args):
    result = subprocess.run(["gh", *args, "--repo", REPO], capture_output=True, check=True)
    return result.stdout.decode("utf-8", errors="replace")


run = json.loads(gh("run", "view", RUN, "--json",
    "databaseId,headSha,headBranch,event,createdAt,startedAt,updatedAt,conclusion,status,url,workflowName,jobs"))
assert run["headSha"] == HEAD
assert run["status"] == "completed" and run["conclusion"] == "success"
assert len(run["jobs"]) == 11 and all(job["conclusion"] == "success" for job in run["jobs"])
pr = json.loads(gh("pr", "view", "47", "--json",
    "number,headRefOid,baseRefOid,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup"))
assert pr["headRefOid"] == HEAD
raw = gh("run", "view", RUN, "--log")
redactions = {}
patterns = {
    "private_key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    "jwt": r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b",
    "provider_token": r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{25,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b",
    "url_userinfo": r"(?<=https://)[^/\s:@]+:[^/\s@]+@",
    "credential_assignment": r"(?i)(\b(?:authorization|apikey|(?:api|service_role|private)[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*)[^\s,;]+",
}
for label, pattern in patterns.items():
    raw, count = re.subn(pattern, "[REDACTED]", raw)
    redactions[label] = count
logs = {}
for line in raw.splitlines():
    parts = line.split("\t", 2)
    if len(parts) == 3:
        name, step, message = parts
        logs.setdefault(name, []).append(f"{step}\t{message}")
    else:
        logs.setdefault("unparsed", []).append(line)
(OUT / "logs").mkdir(parents=True, exist_ok=True)
log_records = []
for job in run["jobs"]:
    name = job["name"]
    assert name in logs, name
    text = "\n".join(logs[name]) + "\n"
    filename = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".log"
    path = OUT / "logs" / filename
    path.write_text(text, encoding="utf-8")
    log_records.append({"job_id": job["databaseId"], "name": name, "path": "logs/" + filename,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "lines": len(logs[name])})
payload = {"captured_at_utc": datetime.now(timezone.utc).isoformat(), "expected_head": HEAD,
           "run": run, "pr_snapshot": pr, "log_files": log_records,
           "sanitization": {"note": "Allowlisted GitHub metadata; logs additionally scrubbed for credential-like values. No environment or auth-store dump.",
                            "pattern_replacements": redactions}}
(OUT / "ci-receipt.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"head": HEAD, "jobs_saved": len(log_records), "sanitization": redactions,
                  "log_lines": sum(item["lines"] for item in log_records)}))
