"""Stdlib line-execution receipt for changed capability code; no coverage dependency."""
import dis
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import types

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = ROOT / "backend/services/weather_pipeline/capabilities.py"
os.chdir(ROOT / "backend")
sys.path.insert(0, str(ROOT / "backend"))
os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///test_dev.db"
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_SERVICE_KEY"] = "test-service-key"
os.environ.pop("REACT_APP_BACKEND_URL", None)
executed = set()
diff = subprocess.check_output(["git", "diff", "--unified=0", "--", str(SOURCE)],
                               cwd=ROOT, text=True, stdin=subprocess.DEVNULL,
                               stderr=subprocess.PIPE)


def trace(frame, event, arg):
    if not frame.f_code.co_filename.replace("\\", "/").endswith(
            "/services/weather_pipeline/capabilities.py"):
        return None
    if event == "line":
        executed.add(frame.f_lineno)
    return trace


def executable_lines(code):
    found = {line for _, line in dis.findlinestarts(code) if line is not None}
    for constant in code.co_consts:
        if isinstance(constant, types.CodeType):
            found.update(executable_lines(constant))
    return found


sys.settrace(trace)
threading.settrace(trace)
import pytest
try:
    exit_code = pytest.main(["-q", "-p", "no:cacheprovider", "tests/test_capabilities_contract.py",
                             "--junitxml=" + str(HERE / "line-traced.xml")])
finally:
    sys.settrace(None)
    threading.settrace(None)

added = set()
line_number = 0
for line in diff.splitlines():
    match = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)", line)
    if match:
        line_number = int(match.group(1))
    elif line.startswith("+") and not line.startswith("+++"):
        added.add(line_number)
        line_number += 1
    elif line.startswith(" "):
        line_number += 1
traceable_added = added & executable_lines(compile(SOURCE.read_bytes(), str(SOURCE), "exec"))
receipt = {"source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
           "pytest_exit": int(exit_code), "executed_lines": sorted(executed),
           "added_traceable_lines": sorted(traceable_added),
           "added_traceable_executed": sorted(traceable_added & executed),
           "added_traceable_unexecuted": sorted(traceable_added - executed),
           "method": "sys.settrace + threading.settrace; dis.findlinestarts; git diff added lines",
           "limit": "Line execution is not branch coverage or proof of live deployment."}
(HERE / "line-execution.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: len(value) for key, value in receipt.items() if key.startswith("added_")}))
sys.exit(exit_code)
