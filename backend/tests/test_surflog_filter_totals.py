"""Keep the surf-log pagination contract in CI using an isolated actual-route fixture."""
import json
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.fixture(scope="module")
def filter_results():
    root = Path(__file__).resolve().parents[2]
    script = root / "docs/audits/evidence/2026-10-29-surflog-integrity/verify_filtered_total.py"
    result = subprocess.run(
        [sys.executable, "-B", str(script)], cwd=root, capture_output=True, text=True,
        encoding="utf-8", timeout=60,
    )
    # Each parameter reports its exact mismatch even when another case fails.
    assert result.stdout.strip(), result.stderr
    report = json.loads(result.stdout)
    assert report["total"] == 9
    assert report["coordinate_schema"] == {
        "SurfLogCreate": "null accepted; empty strings rejected",
        "SurfLogUpdate": "null accepted; empty strings rejected",
    }
    return {item["case"]: item for item in report["results"]}


@pytest.mark.parametrize("case", [
    "unfiltered", "mood", "year", "month", "spot", "combined", "empty", "paginated", "past-end",
])
def test_filtered_total_matches_the_unpaginated_relation(filter_results, case):
    result = filter_results[case]
    assert result["passed"], result
