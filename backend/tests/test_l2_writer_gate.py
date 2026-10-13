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


# ─── Transient-rejection retry on the L2 upload path (l2_retry.py, 2026-09-25) ──────────────────
# Measured on pilots run 36155404099: 521 of ~6,929 uploads (7.5%) were lost to
# `429 too_many_connections / SlowDown` with no retry, leaving manifest entries without files.

class _Resp:
    def __init__(self, status, headers=None, text=""):
        self.status_code, self.headers, self.text = status, headers or {}, text


def _scripted(statuses):
    seq = list(statuses)
    calls = []

    def post():
        calls.append(1)
        s = seq.pop(0)
        if isinstance(s, BaseException):
            raise s
        return s if isinstance(s, _Resp) else _Resp(s)
    return post, calls


def test_retry_recovers_a_slowdown_burst(monkeypatch):
    from services.weather_pipeline.l2_retry import post_with_retry
    monkeypatch.delenv("L2_UPLOAD_MAX_ATTEMPTS", raising=False)
    post, calls = _scripted([429, 429, 200])
    slept = []
    resp, retries = post_with_retry(post, "f.json", sleep=slept.append, rand=lambda: 0.5)
    assert resp.status_code == 200 and retries == 2 and len(calls) == 3
    assert slept == [0.5, 1.0], "exponential backoff from the 0.5 s base (jitter pinned to 1.0x)"


def test_a_real_refusal_is_not_retried(monkeypatch):
    """⛔ A 4xx that means NO (bad key, duplicate with x-upsert false) must surface on attempt one —
    retrying it would hide a genuine error behind five slow copies of itself."""
    from services.weather_pipeline.l2_retry import post_with_retry
    for status in (400, 401, 403, 409):
        post, calls = _scripted([status, 200])
        slept = []
        resp, retries = post_with_retry(post, "f.json", sleep=slept.append)
        assert (resp.status_code, retries, len(calls), slept) == (status, 0, 1, []), status


def test_retry_is_bounded_and_returns_the_last_answer(monkeypatch):
    from services.weather_pipeline.l2_retry import post_with_retry
    monkeypatch.setenv("L2_UPLOAD_MAX_ATTEMPTS", "3")
    post, calls = _scripted([503, 503, 503, 200])
    slept = []
    resp, retries = post_with_retry(post, "f.json", sleep=slept.append, rand=lambda: 0.5)
    assert resp.status_code == 503 and retries == 2 and len(calls) == 3 and len(slept) == 2
    monkeypatch.setenv("L2_UPLOAD_MAX_ATTEMPTS", "1")          # 1 disables retrying entirely
    post, calls = _scripted([429, 200])
    assert post_with_retry(post, "f.json", sleep=slept.append)[0].status_code == 429 and len(calls) == 1


def test_retry_after_is_honoured_and_capped(monkeypatch):
    from services.weather_pipeline.l2_retry import post_with_retry
    monkeypatch.delenv("L2_UPLOAD_MAX_ATTEMPTS", raising=False)
    monkeypatch.setenv("L2_UPLOAD_RETRY_CAP_SEC", "8")
    post, _ = _scripted([_Resp(429, {"Retry-After": "3"}), _Resp(429, {"Retry-After": "120"}), 200])
    slept = []
    post_with_retry(post, "f.json", sleep=slept.append)
    assert slept == [3.0, 8.0], "the server's hint wins, but never past the cap"


def test_transport_errors_retry_but_bugs_do_not(monkeypatch):
    import requests
    from services.weather_pipeline.l2_retry import post_with_retry
    monkeypatch.delenv("L2_UPLOAD_MAX_ATTEMPTS", raising=False)
    post, calls = _scripted([requests.ConnectionError("reset"), requests.Timeout("slow"), 201])
    resp, retries = post_with_retry(post, "f.json", sleep=lambda s: None)
    assert resp.status_code == 201 and retries == 2
    post, calls = _scripted([ValueError("a bug, not the network"), 200])
    with pytest.raises(ValueError):
        post_with_retry(post, "f.json", sleep=lambda s: None)
    assert len(calls) == 1


def test_upload_path_survives_a_slowdown_end_to_end(tmp_path, monkeypatch):
    """The whole point, through the real `_upload_to_supabase`: two SlowDowns then success must land
    the product with NO failure recorded. Before l2_retry this exact sequence logged
    'L2 upload failed' and the file never reached L2. Positive control: a persistent 429 still fails."""
    import requests
    from services.weather_pipeline import l2_retry
    monkeypatch.setenv("L2_WRITER", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    monkeypatch.delenv("L2_UPLOAD_MAX_ATTEMPTS", raising=False)
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: object())
    monkeypatch.setattr(l2_retry.time, "sleep", lambda s: None)
    replies = [_Resp(429, text="SlowDown"), _Resp(429, text="SlowDown"), _Resp(200)]
    monkeypatch.setattr(requests, "post", lambda *a, **k: replies.pop(0))
    before = list(ProductStore._last_upload_errors)
    s = ProductStore(cache_dir=tmp_path)
    assert s._upload_to_supabase("gfs_marine_waves_srilanka_maldives_20260925T180000Z.json", b"{}",
                                 strict=True) is True
    assert ProductStore._last_upload_errors == before and replies == []

    monkeypatch.setattr(requests, "post", lambda *a, **k: _Resp(429, text="SlowDown"))
    with pytest.raises(RuntimeError, match="429.*after 4 retries"):
        s._upload_to_supabase("gfs_marine_waves_x_20260925T180000Z.json", b"{}", strict=True)


@pytest.mark.parametrize("key,overwrite", [
    ("calibration/skill_archive_2026-09.json", False),   # create-only: a retry after a lost ack = duplicate
    ("calibration/skill/scored-2026-09.json", True),     # namespaced state: caller owns pending/redo
    ("spot_ratings/latest.json", True),
    ("gfs_marine_waves_x_20260925T180000Z.json", False), # even a product, if the caller asked create-only
])
def test_state_blobs_and_create_only_writes_are_never_retried(tmp_path, monkeypatch, key, overwrite):
    """⛔ Only idempotent PIPELINE writes (product files, manifest.json, manifests/...) are retried.
    State blobs keep their callers' own recovery protocols, and create-only writes must never be
    repeated blindly, so each of these makes exactly ONE attempt."""
    import requests
    from services.weather_pipeline import l2_retry
    monkeypatch.setenv("L2_WRITER", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: object())
    monkeypatch.setattr(l2_retry.time, "sleep", lambda s: None)
    calls = []
    monkeypatch.setattr(requests, "post", lambda *a, **k: calls.append(1) or _Resp(429, text="SlowDown"))
    with pytest.raises(RuntimeError, match="429"):
        ProductStore(cache_dir=tmp_path)._upload_to_supabase(key, b"[]", strict=True, overwrite=overwrite)
    assert calls == [1]


def test_run_keyed_manifest_copies_are_retried(tmp_path, monkeypatch):
    """`manifests/manifest-g....json` is namespaced but IS a pipeline artifact (20 of the run's 521
    losses) and an idempotent upsert, so it gets the retry. Positive control for the scope rule."""
    import requests
    from services.weather_pipeline import l2_retry
    monkeypatch.setenv("L2_WRITER", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    monkeypatch.delenv("L2_UPLOAD_MAX_ATTEMPTS", raising=False)
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: object())
    monkeypatch.setattr(l2_retry.time, "sleep", lambda s: None)
    replies = [_Resp(429, text="SlowDown"), _Resp(201)]
    monkeypatch.setattr(requests, "post", lambda *a, **k: replies.pop(0))
    assert ProductStore(cache_dir=tmp_path)._upload_to_supabase(
        "manifests/manifest-g000000082147.json", b"{}", strict=True) is True
    assert replies == []
