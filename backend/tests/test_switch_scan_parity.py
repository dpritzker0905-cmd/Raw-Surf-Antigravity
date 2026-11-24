"""P0-3 (Fable inspection 2026-11-23): every switch is listed, by a scan, and no new one can go unlisted.

The admin's switch board is built by `services/switch_scan.build_registry` from the code and the workflows. These tests
are the parity half: an independent, BROADER pattern finds every env read by a literal name in the backend (any call
whose function name says env / flag / switch, any literal default) and every repository variable a workflow reads,
and each must be in the registry. A new read through a helper the scan does not know fails here with its name.
They also pin the inspection's named cases and that nothing credential-like is ever listed.
"""
import os
import re

import pytest

from routes.admin.surf_forecast import _RATING_FLAGS
from services import runtime_flags as rf
from services import switch_scan as s

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
WORKFLOWS = os.path.join(REPO, ".github", "workflows")

# Broader than the scanner on purpose: any function whose (dotted) name says env/flag/switch, any default form.
# Dotted names count (os.environ.get, settings.env_int): the mutation case below showed that a last-name-only pattern
# never matched a plain os.environ.get read.
_BROAD = re.compile(r"\b([\w.]*(?:env|Env|ENV|getenv|flag|Flag|FLAG|switch)[\w.]*)\(\s*[\"']([A-Z][A-Z0-9_]{2,})[\"']"
                    r"\s*(?:,\s*(?:default\s*=\s*)?[\"']?([^,\"')\s]{0,40})[\"']?)?")
_SWITCHY = re.compile(r"^(?:0|1|true|false|True|False|-?\d+(?:\.\d+)?)$")
# Reads the broad pattern sees that are NOT switches, each with its reason. Keep this short; never add a switch here.
NOT_A_SWITCH = {
    "SENDGRID_FROM_NAME": "a display name (text), not a switch",
}


@pytest.fixture(scope="module")
def registry():
    return s.build_registry(REPO, rf.GUARDED, {k: v[0] for k, v in _RATING_FLAGS.items()})


def _broad_hits():
    hits = {}
    for path in s._py_files(BACKEND):
        if path.endswith("switch_scan.py"):
            continue
        with open(path, encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
        for m in _BROAD.finditer(text):
            fn, name, default = m.groups()
            switchy = (default is not None and _SWITCHY.match(default)) or ("flag" in fn.lower() and default is None)
            if switchy and not s.is_secret_name(name):
                hits.setdefault(name, set()).add(os.path.relpath(path, REPO).replace(os.sep, "/"))
    return hits


def _unlisted_reads(registry, hits):
    return {n: sorted(f)[:2] for n, f in hits.items() if n not in registry and n not in NOT_A_SWITCH}


def _unlisted_vars(registry):
    listed = {v for e in registry.values() for v in e["repo_vars"]}
    return set(s.repo_vars_referenced(WORKFLOWS)) - listed


@pytest.fixture(scope="module")
def broad_hits():
    return _broad_hits()


def test_every_env_read_with_a_switch_or_number_default_is_listed(registry, broad_hits):
    missing = _unlisted_reads(registry, broad_hits)
    assert not missing, ("env reads the switch scan does not list (teach services/switch_scan.py the helper, or, for a "
                         f"non-switch, add it to NOT_A_SWITCH with its reason): {missing}")


def test_every_repo_variable_a_workflow_reads_is_listed(registry):
    assert _unlisted_vars(registry) == set()
    assert len(s.repo_vars_referenced(WORKFLOWS)) >= 32       # the inspection counted 32 repository variables in use


# MUTATION CASES (advisor, 2026-11-23): the two parity checks above must FAIL when the registry loses an entry, so a
# scan that silently stopped seeing a switch or a repository variable cannot pass. Each deletes one real entry.
@pytest.mark.parametrize("victim", ["GFS_WORLD_FULL_HORIZON", "MANIFEST_PUBLISH_ONE_STEP", "SURF_FACE_RANGE"])
def test_mutation_deleting_a_switch_from_the_registry_fails_parity(registry, broad_hits, victim):
    assert victim in broad_hits or victim in rf.GUARDED or registry[victim]["repo_vars"]
    mutated = {k: v for k, v in registry.items() if k != victim}
    caught = (victim in _unlisted_reads(mutated, broad_hits) or victim in _unlisted_vars(mutated)
              or any(n not in mutated for n in rf.GUARDED))
    assert caught, f"deleting {victim} from the registry went unnoticed"
    assert not _unlisted_reads(registry, broad_hits) and not _unlisted_vars(registry)   # the unmutated one passes


def test_mutation_deleting_a_repo_variable_reader_fails_parity(registry):
    mutated = {k: v for k, v in registry.items() if k != "SERVED_WAVE_VERIFY"}
    assert "SERVED_WAVE_VERIFY" in _unlisted_vars(mutated)


def test_every_guarded_and_registered_flag_is_listed(registry):
    for name in list(rf.GUARDED) + list(_RATING_FLAGS):
        assert name in registry or s.is_secret_name(name), name
    assert all(registry[n]["guarded"] for n in rf.GUARDED)


@pytest.mark.parametrize("name", ["CONSENSUS_SERVE", "SERVED_WAVE_VERIFY", "FRAME_RASTER_GUST_RISK", "ICON_SWELL2_STORED",
                                  "SAMPLER_SCALAR_HEIGHT", "SPOT_SERIES_PUBLISH", "GFS_WORLD_FULL_HORIZON",
                                  "ECMWF_WAVE_LAND_CENTRE_BLOCK", "MARINE_EXT_CEILING_MARGIN_H",
                                  "MANIFEST_PUBLISH_ONE_STEP", "MANIFEST_ONE_ENTRY_PER_OBJECT"])
def test_the_inspection_named_switches_are_listed(registry, name):
    assert name in registry


def test_lane_forms_of_the_inspection_cases(registry):
    gfs = registry["GFS_WORLD_FULL_HORIZON"]
    assert {(x["workflow"], x["form"], x["var"], x["fallback"]) for x in gfs["lanes"]} == {
        ("forecast-ingest.yml", "var", "GFS_WORLD_FULL_HORIZON", "0"),
        ("forecast-ingest-pilots.yml", "var", "GFS_WORLD_FULL_HORIZON", "0")}
    one = registry["MANIFEST_PUBLISH_ONE_STEP"]
    assert {x["workflow"] for x in one["lanes"] if x["form"] == "literal" and x["value"] == "1"} >= {
        "forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml", "sim-parity-monitor.yml"}


def test_no_credential_is_ever_listed(registry):
    assert not [n for n in registry if s.is_secret_name(n)]
    for e in registry.values():
        for lane in e["lanes"]:
            assert "secrets" not in str(lane)
            assert lane.get("value") is None or s.safe_value(lane["value"]) == lane["value"]


@pytest.mark.parametrize("name,secret", [
    ("SUPABASE_SERVICE_ROLE_KEY", True), ("SUPABASE_URL", True), ("STRIPE_WEBHOOK_SECRET", True),
    ("GITHUB_DISPATCH_TOKEN", True), ("COPERNICUS_MARINE_PASSWORD", True), ("FRAME_WIND_GFS_HOURLY", False),
    ("PRODUCT_RUN_KEYED_NAMES", False), ("GFS_WORLD_FULL_HORIZON", False),
])
def test_is_secret_name_is_by_word(name, secret):
    assert s.is_secret_name(name) is secret


@pytest.mark.parametrize("raw,expected", [
    ("'1' # ENABLED", {"form": "literal", "value": "1"}),
    ("${{ vars.GFS_WORLD_FULL_HORIZON || '0' }}  # DARK", {"form": "var", "var": "GFS_WORLD_FULL_HORIZON", "fallback": "0"}),
    ("${{ vars.X_Y }}", {"form": "var", "var": "X_Y", "fallback": ""}),
    ("${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}", None),
    ("${{ github.event.inputs.mode || 'daily' }}", {"form": "expr", "vars": [], "value": None}),
    ("https://example.invalid/x", {"form": "literal", "value": None}),
])
def test_classify_lane_value(raw, expected):
    assert s.classify_lane_value(raw) == expected


def test_a_job_gate_variable_is_a_switch(tmp_path):
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (tmp_path / "backend").mkdir()
    (wf / "a.yml").write_text("jobs:\n  j:\n    if: ${{ vars.SOME_COLLECT == '1' }}\n    env:\n"
                              "      TOKEN_X: ${{ secrets.TOKEN_X }}\n      SOME_FLAG: '1'\n")
    (tmp_path / "backend" / "m.py").write_text("import os\nX = os.environ.get('SOME_FLAG', '0')\n"
                                               "Y = env_int('SOME_LIMIT', 12)\n")
    reg = s.build_registry(str(tmp_path))
    assert reg["SOME_COLLECT"]["kind"] == "switch" and reg["SOME_COLLECT"]["lanes"][0]["form"] == "gate"
    assert reg["SOME_FLAG"]["lanes"] == [{"form": "literal", "value": "1", "workflow": "a.yml"}]
    assert reg["SOME_LIMIT"]["kind"] == "setting"
    assert "TOKEN_X" not in reg
