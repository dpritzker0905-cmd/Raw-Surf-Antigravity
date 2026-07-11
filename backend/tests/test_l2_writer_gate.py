"""
Designated-writer gate for L2 pipeline artifacts (audit #28, 2026-07-11 LIVE incident).

manifest.json + the product files are one shared mutable dataset with no concurrency control:
any box holding the Supabase key that runs ingestion/prunes uploads its full in-memory snapshot,
last-writer-wins. A local dev backend (up 14h with in-process 4h ingestion) re-uploaded a manifest
built from its boot-time baseline every cycle — reverting the GH runner's registrations (ICON
marine 12Z lost, 47 dangling entries resurrected, EURO marine estimated-tail window regressed →
user-felt far-hour 404s on every marine layer + engine-clear churn). Its prunes also DELETED prod
L2 objects that the prod manifest still referenced (the dangling-entry minter).

Contract under test:
  * Default: pipeline writes (top-level keys: manifest.json, product files) and ALL deletes are
    BLOCKED unless L2_WRITER=1 (set by scripts/ingest_forecast_ci.py and the maintenance scripts).
  * Namespaced state blobs ("calibration/...", "spot_ratings/...") pass through — serve-box
    features legitimately persist those.
  * Kill switch: L2_WRITER_GATE=0 restores the legacy any-box-writes behavior.
The gate must sit BEFORE any storage/network access — a blocked box must not even initialize the
Supabase client on these paths.
"""
import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline.store import ProductStore, _l2_pipeline_writes_allowed


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("L2_WRITER", raising=False)
    monkeypatch.delenv("L2_WRITER_GATE", raising=False)


@pytest.fixture
def storage_probe(monkeypatch):
    """Counts attempts to reach the storage layer — the gate must keep this at zero when blocking."""
    calls = []
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: calls.append(1))
    return calls


def test_gate_blocked_by_default():
    assert _l2_pipeline_writes_allowed() is False


def test_gate_open_for_designated_writer(monkeypatch):
    monkeypatch.setenv("L2_WRITER", "1")
    assert _l2_pipeline_writes_allowed() is True


def test_kill_switch_restores_legacy_behavior(monkeypatch):
    monkeypatch.setenv("L2_WRITER_GATE", "0")
    assert _l2_pipeline_writes_allowed() is True


def test_pipeline_upload_and_delete_blocked_before_storage(tmp_path, storage_probe):
    s = ProductStore(cache_dir=tmp_path)
    s._upload_to_supabase("manifest.json", b"{}")
    s._upload_to_supabase("gfs_marine_waves_global_coarse_20260711T000000Z.json", b"{}")
    s._delete_from_supabase("icon_marine_waves_global_coarse_20260710T000000Z.json")
    assert storage_probe == [], "gate must block pipeline writes before any storage access"


def test_namespaced_state_blobs_pass_through(tmp_path, storage_probe):
    s = ProductStore(cache_dir=tmp_path)
    s._upload_to_supabase("calibration/buoy_latest.json", b"{}")
    s._upload_to_supabase("spot_ratings/latest.json", b"{}")
    assert len(storage_probe) == 2, "namespaced keys are serve-box state and must not be gated"


def test_designated_writer_reaches_storage(tmp_path, storage_probe, monkeypatch):
    monkeypatch.setenv("L2_WRITER", "1")
    s = ProductStore(cache_dir=tmp_path)
    s._upload_to_supabase("manifest.json", b"{}")
    s._delete_from_supabase("gfs_marine_waves_global_coarse_20260711T000000Z.json")
    assert len(storage_probe) == 2


def test_manifest_l2_dump_stamps_writer_identity(monkeypatch):
    # written_by is the attribution the #28 incident lacked: every L2 serialization names its writer,
    # with the role prefix ("designated:"/"non-writer:") keyed to the same gate predicate.
    from datetime import datetime, timezone
    import json
    from services.weather_pipeline.schemas import PipelineManifest
    from services.weather_pipeline.store import dump_manifest_for_l2

    m = PipelineManifest(last_manifest_update=datetime.now(timezone.utc), products=[])
    assert json.loads(dump_manifest_for_l2(m))["written_by"].startswith("non-writer:")
    monkeypatch.setenv("L2_WRITER", "1")
    monkeypatch.setenv("GITHUB_RUN_ID", "12345")
    assert json.loads(dump_manifest_for_l2(m))["written_by"] == "designated:gh-run-12345"


def test_runner_entrypoint_declares_itself_writer():
    # The GH ingest workflows (core + pilots) both run scripts/ingest_forecast_ci.py — it must
    # self-declare as the designated writer or every cycle's uploads silently no-op.
    import pathlib
    script = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "ingest_forecast_ci.py"
    src = script.read_text(encoding="utf-8")
    assert 'os.environ.setdefault("L2_WRITER", "1")' in src
