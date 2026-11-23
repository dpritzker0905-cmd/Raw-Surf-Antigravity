"""served-wave-verify-v1 wiring (gate sections 2, 2a, 7a, 9): the sampler job's placement and kill switch, the scorer
workflow's schedule and gates, credentials by NAME only, and the frozen set tables still matching the publisher's."""
import re
from pathlib import Path

import yaml

from services import frame_set as fs
from services import frame_set_bundle as fsb
from services.point_archive import served_sampler as ss

ROOT = Path(__file__).resolve().parents[2]
PILOTS = ROOT / ".github" / "workflows" / "forecast-ingest-pilots.yml"
SCORE = ROOT / ".github" / "workflows" / "served-wave-verify-score.yml"


def _wf(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def test_sampler_job_follows_the_publish_and_cannot_block_it():
    job = _wf(PILOTS)["jobs"]["served-wave-verify-sample"]
    assert job["needs"] == "ingest-pilots"
    assert job["if"] == "${{ always() && vars.SERVED_WAVE_VERIFY == '1' }}"      # dark: an unset variable skips it
    assert job["continue-on-error"] is True and job["timeout-minutes"] == 10
    run = [s for s in job["steps"] if "run" in s and "served_wave_verify_sample.py" in s["run"]][0]
    assert run["env"]["SERVED_WAVE_VERIFY"] == "${{ vars.SERVED_WAVE_VERIFY || '0' }}"
    assert any("setup-node" in s.get("uses", "") and s["with"]["node-version-file"] == "frontend/.node-version"
               for s in job["steps"])


def test_scorer_workflow_schedule_and_kill_switch():
    wf = _wf(SCORE)
    on = wf.get("on") or wf.get(True)
    assert on["schedule"] == [{"cron": "30 6 * * *"}] and "workflow_dispatch" in on
    assert wf["concurrency"]["group"] == "served-wave-verify-score"
    for name, job in wf["jobs"].items():
        assert "vars.SERVED_WAVE_VERIFY == '1'" in job["if"], name
    steps = wf["jobs"]["score"]["steps"]
    scoring = [s for s in steps if "run" in s and "--score" in s["run"]][0]
    assert not any("SECRET" in k or "KEY" in k for k in scoring.get("env", {}))   # the scoring step holds no credential


def test_snapshot_pr_uses_a_named_pat_not_github_token():
    """Amendment 1, A3: a PR opened with GITHUB_TOKEN triggers no CI, so the weekly snapshot PR uses a PAT by name."""
    job = _wf(SCORE)["jobs"]["snapshot"]
    text = SCORE.read_text(encoding="utf-8")
    assert "github.token" not in text and "GITHUB_TOKEN }}" not in text
    checkout = [s for s in job["steps"] if "actions/checkout" in s.get("uses", "")][0]
    assert checkout["with"]["token"] == "${{ secrets.SERVED_WAVE_VERIFY_PR_TOKEN }}"
    pr = [s for s in job["steps"] if "run" in s and "gh pr create" in s["run"]][0]
    assert pr["env"]["GH_TOKEN"] == "${{ secrets.SERVED_WAVE_VERIFY_PR_TOKEN }}"
    assert job["permissions"] == {"contents": "read"}


def test_credentials_by_name_only():
    for p in (PILOTS, SCORE):
        text = p.read_text(encoding="utf-8")
        assert not re.search(r"eyJ[A-Za-z0-9_-]{10,}|sb_secret_|https://[a-z0-9]{20}\.supabase\.co", text)
    for f in ("scripts/served_wave_verify_sample.py", "scripts/served_wave_verify_score.py", "services/point_archive/storage.py"):
        src = (ROOT / "backend" / f).read_text(encoding="utf-8")
        assert not re.search(r"eyJ[A-Za-z0-9_-]{10,}|sb_secret_|\.supabase\.co", src), f


def test_sampler_script_is_dark_without_the_variable(monkeypatch, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("swv_sample", ROOT / "backend" / "scripts" / "served_wave_verify_sample.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.delenv("SERVED_WAVE_VERIFY", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert mod.main([]) == 0
    assert "dark" in capsys.readouterr().out


def test_frozen_set_tables_still_match_the_publisher():
    tier_a = {}
    for t in fs.SETS:
        if t.get("domain") == "marine" and t.get("region_id") == "global_mid" and not t.get("variant") and \
                t["layer"] in ("waves", "swell_1", "swell_2", "wind_waves"):
            tier_a.setdefault(t["model"], []).append(t["layer"])
    assert {m: tuple(v) for m, v in tier_a.items()} == ss.TIER_A_LAYERS
    assert ss.EURO_SWELL_LAYERS == fs.EURO_SWELL_LAYERS
    assert ss.TIER_B_LAYERS["GFS"] == fsb.REGIONAL_LAYERS
    assert {m: ss.TIER_B_LAYERS[m] for m in ("EURO", "ICON")} == fsb.OTHER_MODEL_LAYERS
