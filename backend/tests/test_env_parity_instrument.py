"""
Guards for the environment-parity instrument.

⚠️ THIS EXISTS BECAUSE conftest.py CALLS THAT INSTRUMENT INSIDE A BARE `except Exception: return`.
That swallow is correct — an instrument must never fail the suite it describes — but it also means
a broken instrument reports NOTHING and looks exactly like a healthy environment. An instrument
that cannot fail loudly needs a test that can, or it joins the diagnostics nobody reads.

★ The cases below are the ones that matter: does it REFUSE when it cannot know (rather than
  reporting a parity it never verified), and does it stay SILENT on a healthy input (rather than
  crying wolf until it is ignored)? Both directions were checked by hand against the live repo on
  2026-08-06; these keep them checked.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import check_env_parity as parity  # noqa: E402


CI_ONE = "jobs:\n  a:\n    steps:\n      - with:\n          python-version: '3.11'\n"
CI_TWO = CI_ONE + "  b:\n    steps:\n      - with:\n          python-version: '3.12'\n"


@pytest.fixture
def fake_repo(tmp_path, monkeypatch):
    """A minimal, valid repo layout the instrument can read. Cases break it one piece at a time."""
    backend = tmp_path / "backend"
    (backend / "scripts").mkdir(parents=True)
    (backend / "requirements.txt").write_text("pytest==9.0.3\n", encoding="utf-8")
    (backend / "requirements-dev.txt").write_text("aiosqlite==0.22.1\nsomelib>=1.0\n", encoding="utf-8")
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(CI_ONE, encoding="utf-8")
    (tmp_path / "render.yaml").write_text(
        "services:\n  - envVars:\n      - key: PYTHON_VERSION\n        value: 3.11.0\n", encoding="utf-8")
    monkeypatch.setattr(parity, "BACKEND", backend)
    monkeypatch.setattr(parity, "REPO", tmp_path)
    monkeypatch.setattr(parity, "CI_WORKFLOW", workflows / "ci.yml")
    monkeypatch.setattr(parity, "RENDER_BLUEPRINT", tmp_path / "render.yaml")
    return tmp_path


# ── It must REFUSE rather than report a parity it did not verify ──────────────

def test_refuses_when_requirements_are_absent(fake_repo, monkeypatch):
    (fake_repo / "backend" / "requirements.txt").unlink()
    with pytest.raises(parity.Refused):
        parity.summarize()


def test_refuses_when_nothing_parses_as_a_pin(fake_repo):
    (fake_repo / "backend" / "requirements.txt").write_text("# only comments\n", encoding="utf-8")
    (fake_repo / "backend" / "requirements-dev.txt").write_text("somelib>=1.0\n", encoding="utf-8")
    with pytest.raises(parity.Refused):
        parity.summarize()


def test_refuses_when_the_ci_workflow_is_absent(fake_repo, monkeypatch):
    monkeypatch.setattr(parity, "CI_WORKFLOW", fake_repo / "nope.yml")
    with pytest.raises(parity.Refused):
        parity.summarize()


def test_refuses_when_ci_declares_more_than_one_python(fake_repo):
    parity.CI_WORKFLOW.write_text(CI_TWO, encoding="utf-8")
    with pytest.raises(parity.Refused):
        parity.summarize()


def test_a_missing_render_blueprint_is_unknown_not_a_refusal(fake_repo, monkeypatch):
    """The local-vs-CI half is still honest without it, so it must degrade rather than refuse."""
    monkeypatch.setattr(parity, "RENDER_BLUEPRINT", fake_repo / "absent.yaml")
    reading = parity.summarize()
    assert reading["deploy_py"] is None
    assert reading["ci_matches_deploy"] is True
    assert parity.chain_line(reading) is None


# ── It must stay SILENT on a healthy input ────────────────────────────────────

def test_chain_is_silent_when_ci_and_production_agree(fake_repo):
    assert parity.chain_line(parity.summarize()) is None


def test_chain_speaks_when_ci_and_production_disagree(fake_repo):
    (fake_repo / "render.yaml").write_text(
        "services:\n  - envVars:\n      - key: PYTHON_VERSION\n        value: 3.12.0\n", encoding="utf-8")
    reading = parity.summarize()
    assert reading["deploy_py"] == "3.12"
    assert reading["ci_matches_deploy"] is False
    message = parity.chain_line(reading)
    assert message and "3.11" in message and "3.12" in message


def test_a_matching_environment_reports_ok(fake_repo, monkeypatch):
    """The healthy-input control: with the declared python equal to this one and every pin
    satisfied, the instrument must say OK. Verified live in CI run 31103393912 as well:
    'env parity OK: python 3.11, 38/38 pins match'."""
    here = ".".join(str(p) for p in sys.version_info[:2])
    parity.CI_WORKFLOW.write_text(CI_ONE.replace("3.11", here), encoding="utf-8")
    (fake_repo / "render.yaml").write_text(
        f"services:\n  - envVars:\n      - key: PYTHON_VERSION\n        value: {here}.0\n", encoding="utf-8")
    monkeypatch.setattr(parity, "compare", lambda pinned: ([("pytest", "x", "x")], [], []))
    reading = parity.summarize()
    assert reading["matches"] is True
    assert parity.one_line(reading).startswith("env parity OK")
    assert parity.chain_line(reading) is None


def test_a_diverging_environment_names_what_diverged(fake_repo, monkeypatch):
    monkeypatch.setattr(parity, "compare",
                        lambda pinned: ([], [("stripe", "8.11.0", "15.1.0")], [("openai", "1.51.0")]))
    line = parity.one_line(parity.summarize())
    assert line.startswith("ENVIRONMENT IS NOT THE DECLARED ONE")
    assert "1 of 2 pins differ" in line
    assert "1 declared packages absent" in line


def test_floating_requirements_are_collected_separately_from_pins(fake_repo):
    """`somelib>=1.0` is not a divergence, but it CAN move with no commit, so it must be visible."""
    reading = parity.summarize()
    assert "somelib" in reading["floating"]
    assert "pytest" not in reading["floating"]
