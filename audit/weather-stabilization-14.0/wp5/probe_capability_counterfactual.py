"""Run final capability tests against baseline or an in-memory source-list mutant."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
os.chdir(ROOT / "backend")
sys.path.insert(0, str(ROOT / "backend"))
os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///test_dev.db"
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_SERVICE_KEY"] = "test-service-key"
os.environ.pop("REACT_APP_BACKEND_URL", None)

parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=("baseline", "mutation"))
args = parser.parse_args()
from services.weather_pipeline import capabilities

if args.mode == "baseline":
    original = subprocess.check_output([
        "git", "show", "91b90ae9:backend/services/weather_pipeline/capabilities.py"
    ], cwd=ROOT)
    exec(compile(original, "baseline_91b90ae9_capabilities.py", "exec"), capabilities.__dict__)
else:
    for row in capabilities.WEATHER_CAPABILITIES:
        if row.get("native_grid_sources"):
            row["native_grid_sources"] = [source for source in row["native_grid_sources"]
                                           if source["upstream_model"] != "ecmwf_wam025"]

import pytest
sys.exit(pytest.main([
    "-q", "-p", "no:cacheprovider", "tests/test_capabilities_contract.py",
    "--junitxml=" + str(HERE / (args.mode + "-final.xml")),
]))
