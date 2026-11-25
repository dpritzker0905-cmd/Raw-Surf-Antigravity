"""Rated sets the publisher no longer builds are RETIRED in latest.json, never left frozen (2026-11-25, frames lane).

Since bug hunt 2026-11-22 D a partition layer is never rated (band_partition.height_only), so rated_publish_sets() stopped baking the
GFS / ICON swell_1, swell_2 and wind_waves rated sets. Their latest.json records stayed at the last run built (2026-11-23 00Z / 06Z,
read 55-61 h old on 2026-11-25) and the freshness report counted them stale while the rated step reported success. These tests pin:
which sets are retired, the record, that the publisher writes it only with a real pointer move, the kill switch, that it reverses
itself when partitions are rated again, and that the freshness report reads a retired record as `empty`, never stale."""
import json
import os
import sys
from datetime import datetime, timezone
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import frame_set_freshness as fresh  # noqa: E402
import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_rating as fsr  # noqa: E402

NOW = "2026-11-25T12:00:00Z"
STALE = "GFS/marine/swell_1/global_mid_rated"
LIVE = "GFS/marine/waves/global_mid_rated"


def _keys(ts):
    return {fs.set_key(t) for t in ts}


def test_every_rated_partition_set_is_retired_and_no_waves_set_is(monkeypatch):
    monkeypatch.delenv("FRAME_RATED_RETIRE", raising=False)
    monkeypatch.delenv("BAND_PARTITION_HEIGHT_ONLY", raising=False)
    retired = _keys(fsr.retired_rated_sets())
    live = _keys(fsr.rated_publish_sets())
    assert retired and not (retired & live)
    assert {STALE, "GFS/marine/wind_waves/global_mid_rated", "ICON/marine/swell_1/global_mid_rated"} <= retired
    assert all("/waves/" not in k for k in retired)
    assert retired | live == _keys(tuple(fsr.rated_regional_sets()) + fsr.RATED_SETS)   # every rated set is one or the other


def test_the_kill_switch_retires_nothing(monkeypatch):
    monkeypatch.setenv("FRAME_RATED_RETIRE", "0")
    assert fsr.retired_rated_sets() == ()


def test_it_reverses_itself_when_partitions_are_rated_again(monkeypatch):
    monkeypatch.setenv("BAND_PARTITION_HEIGHT_ONLY", "0")            # partition layers rated again: back in the publish list
    assert fsr.retired_rated_sets() == ()
    assert STALE in _keys(fsr.rated_publish_sets())


def test_the_retired_record():
    prev = {"index": "v1/gfs/marine/swell_1/global_mid_rated/index/20261123T060000Z-ab.json", "run": "2026-11-23T06:00:00Z"}
    rec = fsr.retired_record(prev, NOW, "w")
    assert rec["empty"] is True and rec["retired"] == "partition_height_only" and "index" not in rec and "run" not in rec
    assert rec["previous_index"] == prev["index"] and rec["written_at"] == NOW
    assert fsr.retired_record(None, NOW, "w") is None                 # nothing to retire
    assert fsr.retired_record(rec, NOW, "w") is None                  # already retired: written once, not every run


def _tree(root, sets):
    (root / "v1").mkdir(parents=True, exist_ok=True)
    (root / "v1" / "latest.json").write_text(json.dumps({"version": 1, "written_at": "2026-11-23T15:03:32Z", "sets": sets}))


def _fake_publish(index_path):
    def publish_set(source, sink, target, prev_index, upload, **kw):
        return {"path": index_path, "run": "2026-11-25T00:00:00Z", "run_time": "2026-11-25T05:32:00Z", "coverage": 1.0,
                "coverage_authoritative": 1.0, "frames": []}, {"entries": 1}
    return publish_set


def test_the_publisher_retires_with_a_real_pointer_move_and_never_drops_a_record(tmp_path, monkeypatch):
    out = tmp_path / "o"
    stale_rec = {"index": "v1/gfs/marine/swell_1/global_mid_rated/index/20261123T060000Z-ab.json", "run": "2026-11-23T06:00:00Z",
                 "written_at": "2026-11-23T15:03:32Z"}
    _tree(out, {STALE: stale_rec})
    monkeypatch.setattr(pub.fs, "publish_set", _fake_publish("v1/gfs/marine/waves/global_mid_rated/index/20261125T000000Z-cd.json"))
    sink = pub.LocalSink(out)
    (tmp_path / "manifest.json").write_text(json.dumps({"products": []}))   # the rated step reads its chain inputs once
    monkeypatch.setattr(fsr, "ChainInputs", lambda *a, **k: None)
    live_target = next(t for t in fsr.RATED_SETS if fs.set_key(t) == LIVE)
    pub.publish_frame_sets(pub.LocalCache(tmp_path), sink, sets=[live_target], budget_s=600, retire=[STALE], log=lambda *a: None)
    latest = json.loads((out / "v1" / "latest.json").read_text())
    assert latest["sets"][LIVE]["index"].endswith("cd.json")
    rec = latest["sets"][STALE]
    assert rec["empty"] is True and "index" not in rec and rec["previous_index"] == stale_rec["index"]


def test_a_run_that_moves_no_pointer_writes_nothing(tmp_path, monkeypatch):
    out = tmp_path / "o"
    stale_rec = {"index": "v1/x/index/a.json", "run": "2026-11-23T06:00:00Z"}
    _tree(out, {STALE: stale_rec})
    before = (out / "v1" / "latest.json").read_bytes()
    pub.publish_frame_sets(pub.LocalCache(tmp_path), pub.LocalSink(out), sets=[], budget_s=600, retire=[STALE],
                           log=lambda *a: None)
    assert (out / "v1" / "latest.json").read_bytes() == before        # written only WITH the next real pointer move


def test_the_freshness_report_reads_a_retired_record_as_empty_not_stale(tmp_path, capsys):
    latest = {"sets": {STALE: fsr.retired_record({"index": "x", "run": "2026-11-23T06:00:00Z"}, NOW, "w"),
                       "GFS/marine/waves/global_mid": {"run": "2026-11-25T00:00:00Z"}}}
    report_time = datetime.fromisoformat(NOW)
    rows = {r["key"]: r for r in fresh.check(latest, report_time)}
    assert rows[STALE]["verdict"] == "empty"
    assert not any(r["verdict"] in fresh.BAD for r in rows.values())
    p = tmp_path / "latest.json"
    p.write_text(json.dumps(latest))
    capsys.readouterr()
    with patch.object(fresh, "datetime", wraps=datetime) as clock:
        clock.now.return_value = report_time
        assert fresh.main(["--latest", str(p), "--fail-on-stale"]) == 0
    assert "Frame sets stale" not in capsys.readouterr().out


def test_only_a_retired_record_reads_empty_a_bundle_explicit_empty_still_reads_no_run():
    """Advisor limit L1 on #1316: the exemption is for RETIRED rated records only, never every empty record."""
    latest = {"sets": {STALE: fsr.retired_record({"index": "x", "run": "2026-11-23T06:00:00Z"}, NOW, "w"),
                       "GFS/marine/waves/azores": {"empty": True, "reason": "no stored product for this layer in this box"}}}
    rows = {r["key"]: r for r in fresh.check(latest, datetime(2026, 11, 25, 12, tzinfo=timezone.utc))}
    assert rows[STALE]["verdict"] == "empty"
    assert rows["GFS/marine/waves/azores"]["verdict"] == "no_run"            # as before #1316
    table = "\n".join(fresh.summary(list(rows.values())))
    assert "| empty (retired) |" in table and "| GFS | rated | 1 | 0 | 1 |" in table
