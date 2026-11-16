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


def test_aviso_credentials_go_only_to_a_pinned_host_and_names_stay_plain():
    """Security review 2026-11-15: verify the host key BEFORE auth; accept only plain constituent file names."""
    from scripts.tide_fes import fes_gate as G
    kind, b64 = next(iter(G.AVISO_HOST_KEYS))
    assert G.host_key_ok(kind, b64) and not G.host_key_ok(kind, b64[:-4] + "AAAA") and not G.host_key_ok("ssh-rsa", b64)
    assert G.remote_name_ok("m2_fes2022.nc.xz") and G.remote_name_ok("2n2_fes2022.nc.xz")
    for bad in ("../m2_fes2022.nc.xz", "x/m2_fes2022.nc.xz", "m2_fes2022.nc", "M2_FES2022.nc.xz", "m2_fes2022.nc.xz\n"):
        assert not G.remote_name_ok(bad), bad
    src = (BACKEND / "scripts" / "tide_fes" / "fes_gate.py").read_text(encoding="utf-8")
    assert src.index("host_key_ok(key.get_name()") < src.index("t.auth_password(") and "t.connect(" not in src
