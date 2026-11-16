"""PyFES is GPL (director 2026-11-15): it runs only in the offline Actions job (scripts/tide_fes/); the served backend
serves its OUTPUT and never imports it or that folder."""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PAT = re.compile(r"^\s*(import\s+pyfes|from\s+pyfes\b|.*\btide_fes\b.*import|import\s+.*\btide_fes\b)", re.M)


def test_served_backend_never_imports_pyfes_or_the_offline_job():
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    hits = [str(p.relative_to(BACKEND)) for p in served if p.is_file() and PAT.search(p.read_text(encoding="utf-8", errors="ignore"))]
    assert hits == []
    assert not re.search(r"(?im)^\s*pyfes", (BACKEND / "requirements.txt").read_text(encoding="utf-8"))


def test_the_guard_pattern_catches_the_forms_it_must():
    for bad in ("import pyfes", "from pyfes import config", "from scripts.tide_fes import fes_gate", "import scripts.tide_fes.fes_gate"):
        assert PAT.search(bad), bad
    assert not PAT.search("# reads tides/fes/*.json written by the offline job")
