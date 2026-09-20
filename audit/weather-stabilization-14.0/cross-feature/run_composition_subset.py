"""Bounded, CI-selector-owned composition regression subset; no source mutations."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BACKEND = ROOT / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
os.environ.update(TESTING="1", DATABASE_URL="sqlite+aiosqlite:///test_dev.db",
                  SUPABASE_URL="https://test.supabase.co",
                  SUPABASE_SERVICE_KEY="test-service-key")
os.environ.pop("REACT_APP_BACKEND_URL", None)
subprocess_args = dict(cwd=BACKEND, stdin=subprocess.DEVNULL, stderr=subprocess.PIPE)
all_guards = subprocess.check_output(
    [sys.executable, "-B", "scripts/ci_test_lanes.py", "--lane", "guards"],
    text=True, **subprocess_args).splitlines()
files = [name for name in all_guards if any(part in name for part in (
    "test_spot_hub_", "test_spot_conditions", "test_rating_composition_parity",
    "test_surf_point", "test_point_surf_augment", "test_glyph"))]
assert len(files) == 8, f"Review changed bounded selection before proceeding: {files}"
patch = subprocess.check_output(["git", "diff", "HEAD"], **subprocess_args)
head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True,
                               **subprocess_args).strip()
receipt = {"head": head, "tracked_working_patch_sha256": hashlib.sha256(patch).hexdigest(),
           "python": sys.version, "selection": files,
           "selector": "backend/scripts/ci_test_lanes.py --lane guards, then bounded named subset",
           "full_guard_selection_count": len(all_guards), "subset_files": len(files),
           "limit": "Not the full guards lane, hosted CI, live production, or independent scientific skill verification."}
(HERE / "composition-selection.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
import pytest
sys.exit(pytest.main([*files, "-q", "-p", "no:cacheprovider", "--durations=15",
                      "--junitxml=" + str(HERE / "composition.xml")]))
