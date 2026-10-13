"""Mutate a copied module in this disposable process; never edit checkout source."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
import pytest
from services.weather_pipeline import forecast_skill as fs

OUT = Path(__file__).with_name("retention-mutation")
OUT.mkdir(exist_ok=True)
source_path = ROOT / "backend/services/weather_pipeline/forecast_skill.py"
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
                               stdin=subprocess.DEVNULL).strip()
original_bytes = source_path.read_bytes()
source = original_bytes.decode("utf-8")
loop_start = source.index("    for key, rows, exists in archives:\n")
pending_start = source.index("    upload_calibration_l2(store, still, SKILL_PENDING_L2_KEY,\n", loop_start)
summary_start = source.index("    summary = skill_summary(scored)\n", pending_start)
archive_block = source[loop_start:pending_start]
pending_block = source[pending_start:summary_start]
mutated = source[:loop_start] + pending_block + archive_block + source[summary_start:]
(OUT / "forecast_skill.original.py").write_bytes(original_bytes)
mutant_path = OUT / "forecast_skill.pending_first.py"
mutant_path.write_text(mutated, encoding="utf-8")
# This changes only the imported module in this child process. Production files,
# another test process, provider services and storage objects are unaffected.
exec(compile(mutated, str(mutant_path), "exec"), fs.__dict__)
receipt_path = OUT / "ordering.xml"
exit_code = pytest.main([
    "-q", "-p", "no:cacheprovider",
    "tests/test_forecast_skill_retention.py::test_failed_archive_write_preserves_pending_for_retry[503]",
    "tests/test_forecast_skill_retention.py::test_success_preserves_old_rows_and_repeated_run_does_not_duplicate",
    f"--junitxml={receipt_path}",
])
cases = ET.parse(receipt_path).findall(".//testcase")
failed = [case.get("name") for case in cases if case.find("failure") is not None]
passed = [case.get("name") for case in cases if case.find("failure") is None and case.find("error") is None]
assert exit_code == 1 and len(cases) == 2 and len(failed) == len(passed) == 1
assert failed[0] == "test_failed_archive_write_preserves_pending_for_retry[503]"
assert passed[0] == "test_success_preserves_old_rows_and_repeated_run_does_not_duplicate"
assert source_path.read_bytes() == original_bytes, "checkout source changed during mutation probe"
receipt = {"head": head,
           "mutation": "consume pending before archive writes acknowledge",
           "original_sha256": hashlib.sha256(original_bytes).hexdigest(),
           "mutated_sha256": hashlib.sha256(mutant_path.read_bytes()).hexdigest(),
           "checkout_source_unchanged": True, "expected_failure": failed, "healthy_control_passed": passed}
(OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print("Mutation detected: one expected retention failure; healthy control still passed.")
