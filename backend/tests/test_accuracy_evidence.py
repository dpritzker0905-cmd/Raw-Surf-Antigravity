"""An evidence artifact must reproduce the verdict without network or credentials."""
import json
from datetime import datetime, timezone

import pytest

from scripts import forecast_accuracy_monitor as monitor
from scripts.accuracy_evidence import quality_counts, replay


@pytest.mark.parametrize("mae,enabled,missing,expected", [
    (0.2, False, False, monitor.OK),
    (0.5, False, False, monitor.RED),
    (0.2, True, True, monitor.REFUSED),
    (0.2, True, False, monitor.OK),
])
def test_capture_replays_same_verdict_without_credentials(
        tmp_path, monkeypatch, mae, enabled, missing, expected):
    now = datetime(2026, 9, 8, 12, tzinfo=timezone.utc).isoformat()
    report = {"available": True, "generated_at": now,
              "summary": {"height_mae_m": mae, "height_n": 60, "height_bias_m": 0.0},
              "forecast_skill_ops": {"ledgered": 600, "scored": 300,
                                     "pending_kept": 500, "pending_evicted_cap": 0}}
    scored = [{"source": source, "buoy_id": str(i), "target_time": now,
               "lead_h": 24, "err_m": err}
              for i in range(220) for source, err in [("raw_surf", 0.1), ("persistence", 0.2)]]
    monkeypatch.setattr(monitor, "_fetch_json", lambda url: (
        {"version": "control-sha", "irrelevant": "exclude-me"} if url.endswith("/health") else report))
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key: None if missing else (
        scored if "/skill/" in key else [{"buoy_time": now}]))
    for key in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(key, raising=False)
    if enabled:
        monkeypatch.setenv("SUPABASE_URL", "https://unused.invalid")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "never-capture-this-credential")
    monkeypatch.setattr("sys.argv", ["monitor", "--as-of", now, "--evidence-dir", str(tmp_path)])
    assert monitor.main() == expected
    for path in tmp_path.iterdir():
        assert "never-capture-this-credential" not in path.read_text()
        assert "exclude-me" not in path.read_text()
    monkeypatch.setattr(monitor, "_fetch_json", lambda *_: pytest.fail("Replay made a network call"))
    monkeypatch.setattr(monitor, "_fetch_l2", lambda *_: pytest.fail("Replay made a storage call"))
    assert replay(tmp_path)[0] == expected
    payload = json.loads((tmp_path / "inputs.json").read_text())
    assert payload["scored"] == (scored if enabled and not missing else None)
    with (tmp_path / "inputs.json").open("a") as stream:
        stream.write(" ")
    with pytest.raises(ValueError, match="hash mismatch"):
        replay(tmp_path)


def test_quality_counts_distinguish_duplicates_and_unaligned_truth():
    base = {"buoy_id": "private-station", "target_time": "2026-09-08T00:00:00Z",
            "lead_h": 24, "obs_time": "2026-09-08T00:00:00Z", "obs_hs_m": 1.0,
            "err_m": 0.1}
    ours = {**base, "source": "raw_surf"}
    theirs = {**base, "source": "persistence", "obs_hs_m": 2.0}
    quality = quality_counts([ours, theirs])
    assert quality["primary_persistence"]["obs_hs_m_different"] == 1
    assert quality["primary_persistence"]["unique_pairs"] == 1
    assert "private-station" not in json.dumps(quality)
    quality = quality_counts([ours, ours, theirs])
    assert quality["duplicate_keys"] == 1
    assert quality["primary_persistence"] == {}
