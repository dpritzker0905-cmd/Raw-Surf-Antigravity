"""ING-2: two lanes write the spot-ratings L2 object (core ingest tail + precompute.yml). An OLDER run/code
must never overwrite a NEWER one. Offline: no network, no bucket; L2 read/upload are monkeypatched."""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import services.weather_pipeline.spot_ratings_precompute as pc  # noqa: E402

SPOTS = [{"id": "trestles", "lat": 33.38, "lng": -117.59}]


def _frame(model, vt, score):
    return {"model": model, "valid_time": vt, "spots": [{"spot_id": "trestles", "score": score}]}


def test_is_older_stamp_orders_run_then_code_then_start():
    from datetime import datetime, timezone
    now = datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc)
    new = {"code_ts": 2000, "run_id": 20, "started_at": "2026-11-10T12:00:00+00:00"}
    old = {"code_ts": 1000, "run_id": 10, "started_at": "2026-11-10T10:00:00+00:00"}
    assert pc.is_older_stamp(old, new, now) and not pc.is_older_stamp(new, old, now)
    # same run id: code_ts breaks the tie
    assert pc.is_older_stamp({"code_ts": 1000, "run_id": 5}, {"code_ts": 2000, "run_id": 5}, now)
    # same run id and code: later start wins
    assert pc.is_older_stamp({"code_ts": 1, "run_id": 5, "started_at": "2026-11-10T11:00:00+00:00"},
                             {"code_ts": 1, "run_id": 5, "started_at": "2026-11-10T12:00:00+00:00"}, now)
    assert not pc.is_older_stamp(new, dict(new), now)


def test_a_larger_code_ts_with_a_smaller_run_id_does_not_block_a_newer_run():
    """workflow_dispatch from a branch with a newer head commit must not wedge later scheduled runs on dev."""
    from datetime import datetime, timezone
    now = datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc)
    stored = {"code_ts": 9000, "run_id": 10, "started_at": "2026-11-10T12:00:00+00:00"}
    later_dev_run = {"code_ts": 1000, "run_id": 20, "started_at": "2026-11-10T13:00:00+00:00"}
    assert not pc.is_older_stamp(later_dev_run, stored, now)


def test_a_stale_stored_stamp_never_blocks(monkeypatch):
    from datetime import datetime, timezone
    now = datetime(2026, 11, 10, 22, 0, tzinfo=timezone.utc)
    stored = {"code_ts": 2000, "run_id": 20, "started_at": "2026-11-10T12:00:00+00:00"}   # 10 h old > 6 h
    ours = {"code_ts": 1000, "run_id": 10, "started_at": "2026-11-10T21:00:00+00:00"}
    assert not pc.is_older_stamp(ours, stored, now)
    monkeypatch.setenv("SPOT_RATINGS_STALE_TOLERANCE_S", "86400")
    assert pc.is_older_stamp(ours, stored, now)


def test_missing_or_partial_stamps_never_block():
    s = {"code_ts": 1000, "run_id": 10, "started_at": "2026-11-10T10:00:00+00:00"}
    assert not pc.is_older_stamp(s, None) and not pc.is_older_stamp(s, {})   # legacy unstamped object
    assert not pc.is_older_stamp(None, s) and not pc.is_older_stamp({}, s)
    assert not pc.is_older_stamp({"code_ts": 0, "run_id": 0}, {"code_ts": 9, "run_id": 9})  # unprovable


def test_build_run_stamp_reads_ci_env():
    st = pc.build_run_stamp(env={"GITHUB_SHA": "abc", "GITHUB_RUN_ID": "77", "CODE_COMMIT_TS": "1234"})
    assert st["code_sha"] == "abc" and st["run_id"] == 77 and st["code_ts"] == 1234 and st["started_at"]


def _drive(monkeypatch, current_l2, our_env, climatology_calls=None):
    uploads = []

    async def fake_pass(resolver, spots, models, hours, **kw):
        return pc.build_l2_object([_frame(models[0], "2026-11-10T12:00:00Z", 55.0)])

    monkeypatch.setenv("SPOT_RATINGS_PRECOMPUTE_MODELS", "GFS,ICON")
    monkeypatch.setenv("SPOT_RATINGS_MIN_COVERAGE", "0")
    monkeypatch.setenv("RATING_OBS_GATE", "0")
    monkeypatch.setenv("SPOT_RATINGS_STALE_TOLERANCE_S", "999999999")
    monkeypatch.setenv("RATING_SIZE_CLIMATOLOGY", "1" if climatology_calls is not None else "0")
    for k, v in our_env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(pc, "fetch_active_spots_via_rest", lambda *a, **k: SPOTS)
    monkeypatch.setattr(pc, "_make_point_resolver", lambda: None)
    monkeypatch.setattr("services.weather_pipeline.store.ProductStore", lambda *a, **k: object())
    monkeypatch.setattr(pc, "load_spot_ratings_l2", lambda: current_l2)
    monkeypatch.setattr(pc, "upload_spot_ratings_l2", lambda store, obj: uploads.append(obj))
    monkeypatch.setattr(pc, "precompute_spot_ratings", fake_pass)
    if climatology_calls is not None:
        import services.weather_pipeline.spot_size_climatology as ssc
        monkeypatch.setattr(ssc, "load_size_climatology_l2", lambda: climatology_calls.append("load") or {"spots": {}})
    return uploads


def test_an_older_run_cannot_overwrite_a_newer_one(monkeypatch):
    newer = pc.build_l2_object([_frame("EURO", "2026-11-10T12:00:00Z", 80.0)])
    newer["run_stamp"] = {"code_ts": 2000, "run_id": 20, "started_at": "2026-11-10T12:00:00+00:00"}
    clim = []
    uploads = _drive(monkeypatch, newer, {"CODE_COMMIT_TS": "1000", "GITHUB_RUN_ID": "10"}, clim)
    n_spots, n_frames = pc.run_spot_ratings_precompute()
    assert uploads == []                      # nothing written: the newer object stands
    assert n_frames == 0
    assert clim == []                         # and the older run does not fold samples either


def test_a_newer_run_replaces_an_older_object_and_stamps_it(monkeypatch):
    older = pc.build_l2_object([_frame("EURO", "2026-11-10T06:00:00Z", 40.0)])
    older["run_stamp"] = {"code_ts": 1000, "run_id": 10, "started_at": "2026-11-10T06:00:00+00:00"}
    uploads = _drive(monkeypatch, older, {"CODE_COMMIT_TS": "2000", "GITHUB_RUN_ID": "20"})
    pc.run_spot_ratings_precompute()
    assert len(uploads) == 2                  # GFS and ICON checkpoints
    assert uploads[-1]["run_stamp"]["run_id"] == 20 and uploads[-1]["run_stamp"]["code_ts"] == 2000
    # the untouched EURO frames from the object read AT CHECKPOINT time are carried through, not lost
    assert ("EURO", "2026-11-10T06:00:00Z") in {(f["model"], f["valid_time"]) for f in uploads[-1]["frames"]}


def test_an_unstamped_legacy_object_is_replaced(monkeypatch):
    legacy = pc.build_l2_object([_frame("GFS", "2026-11-10T06:00:00Z", 40.0)])
    uploads = _drive(monkeypatch, legacy, {"CODE_COMMIT_TS": "1000", "GITHUB_RUN_ID": "10"})
    pc.run_spot_ratings_precompute()
    assert len(uploads) == 2 and "run_stamp" in uploads[0]


def test_checkpoint_merges_onto_the_object_read_at_checkpoint_not_at_start(monkeypatch):
    """The lost-update half of ING-2: another lane's EURO frames land after this run started."""
    reads = iter([None,  # start-of-run read: nothing there yet
                  pc.build_l2_object([_frame("EURO", "2026-11-10T12:00:00Z", 80.0)]),
                  pc.build_l2_object([_frame("EURO", "2026-11-10T12:00:00Z", 80.0)])])
    uploads = _drive(monkeypatch, None, {"CODE_COMMIT_TS": "1000", "GITHUB_RUN_ID": "10"})
    monkeypatch.setattr(pc, "load_spot_ratings_l2", lambda: next(reads))
    pc.run_spot_ratings_precompute()
    assert ("EURO", "2026-11-10T12:00:00Z") in {(f["model"], f["valid_time"]) for f in uploads[0]["frames"]}


def test_workflow_comment_matches_the_code():
    """forecast-ingest.yml's SPOT_RATINGS_PRECOMPUTE comment must describe the guard, not 'precompute.yml is the
    primary owner' alone."""
    root = os.path.dirname(BACKEND)
    with open(os.path.join(root, ".github", "workflows", "forecast-ingest.yml"), encoding="utf-8") as fh:
        line = next(ln for ln in fh if ln.strip().startswith("SPOT_RATINGS_PRECOMPUTE: '1'"))
    assert "run_stamp" in line and "older" in line
