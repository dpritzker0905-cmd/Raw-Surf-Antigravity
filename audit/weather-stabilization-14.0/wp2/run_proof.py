"""Execute real resolver tests with line evidence, or reversible in-memory mutations."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("TESTING", "1")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///test_dev.db")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

mode = sys.argv[1] if len(sys.argv) > 1 else "coverage"
files = {str(BACKEND / "services" / "weather_pipeline" / (name + ".py")).casefold(): set()
         for name in ("grid_resolver", "grid_resolver_selection", "science_registry")}


def trace(frame, event, arg):
    key = frame.f_code.co_filename.casefold()
    if key not in files:
        return None
    if event == "line":
        files[key].add(frame.f_lineno)
    return trace


if mode == "coverage":
    sys.settrace(trace)

from services.weather_pipeline import grid_resolver, grid_resolver_selection, science_registry

if mode == "disable_selection":
    grid_resolver.prefer_overlapping_marine_region = lambda current, *args: current
elif mode == "hide_shortfall":
    source = Path(grid_resolver.__file__).read_text(encoding="utf-8")
    needle = "product.partial_coverage = not is_bbox_covered_by("
    assert source.count(needle) == 1
    exec(compile(source.replace(needle, "product.partial_coverage = False and not is_bbox_covered_by("),
                 grid_resolver.__file__, "exec"), grid_resolver.__dict__)
elif mode == "allow_sliver":
    name = "MARINE_REGIONAL_MIN_COVERAGE_FRACTION"
    science_registry._REGISTRY[name] = science_registry.get(name)._replace(value=0.0)

import pytest

if mode == "coverage":
    sys.settrace(trace)
code = pytest.main(["-q", "-p", "no:cacheprovider", "tests/test_regional_edge_selection.py",
                    "--junitxml=" + str(Path(__file__).with_name(mode + ".xml"))])
sys.settrace(None)
if mode == "coverage":
    Path(__file__).with_name("executed-lines.json").write_text(
        json.dumps({k: sorted(v) for k, v in files.items()}, indent=2), encoding="utf-8")
raise SystemExit(code)
