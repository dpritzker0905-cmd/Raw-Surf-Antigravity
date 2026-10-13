"""Collect local validation receipts and source hashes without network access."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASELINE = "d82032f5cd5978967622721b8c9638da36a87f7d"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def junit(filename):
    root = ET.parse(HERE / filename).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    totals = {key: sum(int(s.get(key, 0)) for s in suites)
              for key in ("tests", "failures", "errors", "skipped")}
    totals["passed"] = totals["tests"] - totals["failures"] - totals["errors"] - totals["skipped"]
    totals["seconds"] = round(sum(float(s.get("time", 0)) for s in suites), 3)
    totals["receipt"] = filename
    assert totals["failures"] == totals["errors"] == 0, (filename, totals)
    return totals


def require_log(filename, marker):
    data = (HERE / filename).read_text(encoding="utf-8-sig", errors="replace")
    assert marker in data, (filename, marker)
    return {"receipt": filename, "marker": marker}


def main():
    backend = {name: junit(filename) for name, filename in {
        "final_chain": "retention-chain.xml",
        "retention_affected": "retention-affected.xml",
        "adjacent_upload_consumers": "retention-adjacent.xml",
        "size_climatology": "retention-size-climatology.xml",
        "governance": "governance.xml",
    }.items()}
    assert backend["final_chain"]["passed"] == 1148
    assert backend["retention_affected"]["passed"] == 213
    assert backend["governance"]["passed"] == 51
    selected = (HERE / "retention-chain-selected.txt").read_text(encoding="utf-8-sig").splitlines()
    assert len([s for s in selected if s.strip()]) == 101
    # The same candidate is discoverable both before and after the local commit.
    tracked = git("diff", "--name-only", BASELINE).splitlines()
    untracked = git("ls-files", "--others", "--exclude-standard", "frontend/src").splitlines()
    sources = sorted({p for p in tracked + untracked
                      if p.startswith(("backend/", "frontend/")) or p == ".github/workflows/ci.yml"})
    source_hashes = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in sources}
    assert sources and all((ROOT / p).is_file() for p in sources)
    result = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "baseline_head": BASELINE,
        "checkout_head": git("rev-parse", "HEAD"),
        "source_state": "local candidate checkout; hashes identify validated source",
        "python": platform.python_version(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "backend": backend,
        "chain_selected_files": 101,
        "frontend": json.loads((HERE / "frontend-validation-results.json").read_text(encoding="utf-8-sig")),
        "build": {**require_log("logs/day2-frontend-build.log", "Compiled with warnings."),
                  "observed_exit_code": 0, "command": "node node_modules/@craco/craco/dist/bin/craco.js build"},
        "loc": require_log("logs/day2-loc-ratchet.log", "[OK] No new violations."),
        "partition": require_log("logs/day2-lane-partition.log", "partition OK:"),
        "backend_flake8": {"status": "unavailable", "reason": "No module named flake8",
                           "receipt": "logs/day2-backend-changed-lint.log"},
        "source_sha256": source_hashes,
        "limits": ["Counts overlap; do not sum test lanes and affected subsets.",
                   "Local Python 3.14 and Node 24 differ from hosted Python 3.12 and Node 18.",
                   "Full chain preceded a test-only clock freeze; affected suites reran after it.",
                   "No hosted result for this candidate, live pixel acceptance, or deployment is claimed."],
    }
    (HERE / "final-validation.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"backend": backend, "source_files_hashed": len(sources)}, indent=2))


if __name__ == "__main__":
    main()
