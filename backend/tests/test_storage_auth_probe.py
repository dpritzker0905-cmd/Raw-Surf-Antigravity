"""Storage-auth plan B (approved by David, 2026-11-25): a READ-ONLY probe workflow and the key-rotation runbook.

Pins: the probe is dispatch-only, has no GitHub token (so it can open, comment on or close nothing), reads the same
secrets by name from the same environment as the lanes, and runs the check in block mode so a bad key turns it red.
The runbook names secrets only (never a key-shaped value), points at a probe that exists, and names workflows that
exist by their exact `name:`."""
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows"
PROBE = WF / "storage-auth-probe.yml"
RUNBOOK = ROOT / "docs" / "runbooks" / "storage-key-rotation.md"


def _doc():
    return yaml.safe_load(PROBE.read_text(encoding="utf-8"))


def test_the_probe_is_dispatch_only_and_read_only():
    doc = _doc()
    on = doc.get("on") or doc.get(True)
    assert set(on) == {"workflow_dispatch"}
    assert doc["permissions"] == {"contents": "read"}
    text = PROBE.read_text(encoding="utf-8")
    assert "GH_TOKEN" not in text and "github.token" not in text and "GITHUB_TOKEN" not in text
    job = doc["jobs"]["probe"]
    assert job["environment"] == "supabase-service"
    step = next(s for s in job["steps"] if "storage_auth_check.py" in (s.get("run") or ""))
    assert step["env"]["STORAGE_AUTH_CHECK"] == "block"                  # a bad key turns the probe red
    assert step["env"]["SUPABASE_SERVICE_ROLE_KEY"] == "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
    assert not any("pip install" in (s.get("run") or "") for s in job["steps"])   # stdlib only


def test_the_probe_uses_the_same_environment_and_secret_names_as_the_lanes():
    for wf in ("forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml", "flag-guardrail.yml"):
        text = (WF / wf).read_text(encoding="utf-8")
        assert "environment: supabase-service" in text and "secrets.SUPABASE_SERVICE_ROLE_KEY" in text, wf


KEYISH = re.compile(r"sb_secret_[A-Za-z0-9_\-]{6,}|sb_publishable_[A-Za-z0-9_\-]{6,}|eyJ[A-Za-z0-9_\-]{10,}")


def test_the_runbook_names_secrets_only_never_a_value():
    text = RUNBOOK.read_text(encoding="utf-8")
    assert not KEYISH.search(text), "a key-shaped value in a PUBLIC runbook"
    for name in ("SUPABASE_SERVICE_ROLE_KEY", "supabase-service", "raw-surf-backend", "SECURITY-2026-09-19"):
        assert name in text


def test_the_runbook_points_at_things_that_exist():
    text = RUNBOOK.read_text(encoding="utf-8")
    assert "storage-auth-probe.yml" in text and PROBE.exists()
    names = {yaml.safe_load(p.read_text(encoding="utf-8")).get("name") for p in WF.glob("*.yml")}
    for wf_name in ("Storage auth probe (read-only)", "Forecast Ingestion (decoupled)",
                    "Forecast Ingestion Pilots (regional tiles)", "Precompute Spot Ratings (decoupled)"):
        assert wf_name in text and wf_name in names, wf_name
    assert (ROOT / "docs" / "runbooks" / "SECURITY-2026-09-19-committed-credentials.md").exists()
    for step in ("## 1. Update the secret", "## 2. Probe", "## 3. Re-run the lanes", "## 4. Verify", "## 5. Close"):
        assert step in text
