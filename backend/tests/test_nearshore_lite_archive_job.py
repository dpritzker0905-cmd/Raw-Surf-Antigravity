"""MOP-lite ETA reader, the forward-archive job and its dispatch-only workflow. No network, no bucket."""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import tide_own
from services.weather_pipeline.nearshore_lite import archive, eta
from scripts import nearshore_lite_archive as job

INIT = datetime(2027, 1, 15, 0, 0, tzinfo=timezone.utc)
SAMPLE = ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT\n"
          "2027 01 15 00 00 270  5.0  6.0   1.20  10.0   7.5 280\n")


def table(with_am=True, generated=None, key="33.0,-118.0"):
    start = INIT - timedelta(days=3)
    hours = 24 * 12
    am = {key: [int(1000 * ((h % 12) - 6) / 6) for h in range(hours)]} if with_am else {}      # mm, +-1 m ramp
    doc = {"schema": tide_own.SCHEMA, "start": start.replace(tzinfo=None).isoformat(), "hours": hours, "keys": am,
           "cmems": {key: [5000] * hours}, "generated_at": (generated or INIT).isoformat()}
    return tide_own.validate(doc)


def test_eta_reads_the_am_series_and_never_cmems():
    e = eta.eta_for_init(table(), 33.04, -117.96, INIT)
    assert e["source"] == "am" and e["frame"] == "mean sea level" and e["key"] == [33.0, -118.0]
    assert len(e["eta_m"]) == 73 and e["missing"] == 0
    assert max(abs(v) for v in e["eta_m"]) <= 1.0 + 1e-9                  # the +-1 m am ramp, not the 5 m cmems series
    assert len(e["slice_sha256"]) == 64


def test_eta_slice_hash_is_stable_and_changes_with_the_data():
    a = eta.eta_for_init(table(), 33.0, -118.0, INIT)
    b = eta.eta_for_init(table(), 33.0, -118.0, INIT)
    assert a["slice_sha256"] == b["slice_sha256"]
    t2 = table()
    t2["am"]["33.0,-118.0"][3 * 24 + 5] += 10
    assert eta.eta_for_init(t2, 33.0, -118.0, INIT)["slice_sha256"] != a["slice_sha256"]


def test_missing_key_or_table_is_unavailable_never_another_source():
    with pytest.raises(eta.EtaUnavailable):
        eta.eta_for_init(table(with_am=False), 33.0, -118.0, INIT)       # cmems has the key; am does not: still refused
    with pytest.raises(eta.EtaUnavailable):
        eta.eta_for_init(None, 33.0, -118.0, INIT)
    # dev's #1138: `am` (FES + mean level) is deterministic, so an OLD table still serves it while it covers the hours. Only the
    # forecast `cmems` ages (2 days), and this reader never reads cmems. The table's generated_at is archived with every record.
    old = eta.eta_for_init(table(generated=INIT - timedelta(days=9)), 33.0, -118.0, INIT)
    assert old["source"] == "am" and old["generated_at"] == (INIT - timedelta(days=9)).isoformat()


def test_gaps_are_none_not_zero():
    t = table()
    t["am"]["33.0,-118.0"][3 * 24 + 7] = tide_own._MISSING
    e = eta.eta_for_init(t, 33.0, -118.0, INIT)
    assert e["missing"] == 1 and e["eta_m"][7] is None


TARGETS = [{"id": "T1", "lat": 33.0, "lon": -118.0, "station_id": "46086"}]
DOC = {"version": 2, "stations": [{"id": "46086", "purposes": ["nearshore_eval"]}, {"id": "41001", "purposes": ["served"]}]}
EMPTY_DOC = {"version": 2, "stations": [{"id": "41001", "purposes": ["served"]}]}
WORD = "owner, chat, 2027-01-15 08:02 EST: run the first archive"
FETCHED = datetime(2027, 1, 15, 8, 0, tzinfo=timezone.utc)


def _store(tmp_path):
    from services.point_archive import storage
    return storage.LocalStore(tmp_path / "o")


def test_dry_run_reads_but_writes_nothing(tmp_path):
    code, s = job.run(INIT, TARGETS, DOC, _store(tmp_path), "", table(), lambda u: pytest.fail("no fetch"), dry_run=True)
    assert code == 0 and s["plan"].startswith("dry run") and s["eta"]["T1"]["missing"] == 0
    assert s["stations"] == ["46086"]                                       # from the list's nearshore_eval tag
    assert not (tmp_path / "o").exists()


@pytest.mark.parametrize("ref", ["", "  ", "tbd", "TODO", "short"])
def test_a_real_run_refuses_a_missing_or_placeholder_owner_word(tmp_path, ref):
    with pytest.raises(ValueError, match="owner-word-ref"):
        job.run(INIT, TARGETS, DOC, _store(tmp_path), ref, table(), lambda u: SAMPLE, dry_run=False)
    assert not (tmp_path / "o").exists()


def test_stations_come_from_the_frozen_list_and_a_list_without_the_tag_refuses(tmp_path):
    with pytest.raises(ValueError, match="no nearshore_eval station"):
        job.run(INIT, TARGETS, EMPTY_DOC, _store(tmp_path), WORD, table(), lambda u: SAMPLE, dry_run=False)
    assert not (tmp_path / "o").exists()
    import inspect
    assert "--stations" not in inspect.getsource(job.main)                  # no dispatch input names the stations


def test_without_a_partition_source_the_run_is_incomplete_and_writes_truth_only(tmp_path):
    code, s = job.run(INIT, TARGETS, DOC, _store(tmp_path), WORD, table(), lambda u: SAMPLE, partition_source=None,
                      fetched_at=FETCHED, dry_run=False)
    assert code == job.EXIT_INCOMPLETE and s["status"].startswith("INCOMPLETE")
    files = _store(tmp_path).list("verify/point-archive/v1")
    assert any("/truth/46086/" in f for f in files) and not any("/nearshore_eval/" in f for f in files)   # a partial run would block the real one


def test_the_unbuilt_partition_interface_refuses_to_pretend():
    with pytest.raises(NotImplementedError, match="not ruled"):
        job.PartitionSource().rows(INIT, TARGETS)


class _Parts(job.PartitionSource):
    def rows(self, init, targets):
        return [{"target": t["id"], "lead_h": h, "basis": "partitions",
                 "partitions": [{"h": 1.0, "tp": 12.0, "dir": 270.0, "kind": "swell"},
                                {"h": 0.4, "tp": 6.0, "dir": 250.0, "kind": "windsea"}],
                 "total": {"h": 1.1, "tp": 12.0, "dir": 270.0}} for t in targets for h in range(0, 73)]


def test_with_a_partition_source_the_run_is_archived_in_the_shared_schema(tmp_path):
    from services.point_archive import core, writer
    store = _store(tmp_path)
    code, s = job.run(INIT, TARGETS, DOC, store, WORD, table(), lambda u: SAMPLE, partition_source=_Parts(), fetched_at=FETCHED,
                      coefficient_freeze_hash="cf" * 32, dry_run=False)
    assert code == 0 and s["status"] == "ARCHIVED"
    assert s["archive_path"] == "verify/point-archive/v1/nearshore_eval/euro/20270115T0000Z.jsonl.gz"          # items 1, 2, 6
    assert archive.verify_archive(store, "EURO") == [] and archive.missing_run(store, ["T1"], "EURO") == []
    rows = writer.read_run_rows(store.read(s["archive_path"]))
    r = rows[0]
    assert r["schema"] == core.SCHEMA and r["purpose"] == "nearshore_eval" and r["model"] == "euro" and r["arm"] == "INPUT"
    assert r["run_time"] == "2027-01-15T00:00:00Z" and r["valid_time"] == "2027-01-15T00:00:00Z" and r["lead_h"] == 0
    assert rows[5]["valid_time"] == "2027-01-15T05:00:00Z" and rows[5]["lead_h"] == 5
    assert [p["kind"] for p in r["partitions"]] == ["swell_1", "wind_waves"]                                # shared kind names
    assert r["buoy_list_hash"] == s["buoy_list_hash"] and r["station_id"] == "46086" and r["status"] == "ok"
    assert r["owner_word_ref"] == WORD and r["coefficient_freeze_hash"] == "cf" * 32
    assert r["eta_slice_sha256"] == s["eta"]["T1"]["sha256"] and r["eta_m"] is not None
    assert any("/truth/46086/" in f for f in store.list("verify/point-archive/v1/truth"))                  # item 5
    with pytest.raises(FileExistsError):                                                                 # item 7: immutable
        job.run(INIT, TARGETS, DOC, store, WORD, table(), lambda u: SAMPLE, partition_source=_Parts(), fetched_at=FETCHED, dry_run=False)


def test_the_arms_read_the_same_inputs_back_from_the_shared_records(tmp_path):
    """The shared `kind` names are mapped back to the chain's shape on READ, so the physics code sees what it always saw."""
    from services.point_archive import writer
    from services.weather_pipeline.nearshore_lite import records
    store = _store(tmp_path)
    _, s = job.run(INIT, TARGETS, DOC, store, WORD, table(), lambda u: SAMPLE, partition_source=_Parts(), fetched_at=FETCHED, dry_run=False)
    back = records.rows_from_records(writer.read_run_rows(store.read(s["archive_path"])))
    assert back[0]["partitions"] == [{"h": 1.0, "tp": 12.0, "dir": 270.0, "kind": "swell"},
                                     {"h": 0.4, "tp": 6.0, "dir": 250.0, "kind": "windsea"}]
    assert back[0]["total"] == {"h": 1.1, "tp": 12.0, "dir": 270.0} and back[0]["basis"] == "partitions"


def test_a_total_basis_row_is_one_total_partition_and_an_unavailable_row_is_a_failed_record_never_zero():
    from services.weather_pipeline.nearshore_lite import records
    t = records.build_record(INIT, "EURO", {"id": "T1"}, {"lead_h": 2, "basis": "total",
                             "partitions": [{"h": 1.0, "tp": 12.0, "dir": 270.0, "kind": "swell"}],
                             "total": {"h": 1.0, "tp": 12.0, "dir": 270.0}}, "v", "h", "r")
    assert [p["kind"] for p in t["partitions"]] == ["total"] and t["status"] == "ok"
    u = records.build_record(INIT, "EURO", {"id": "T1"}, {"lead_h": 2, "basis": "unavailable", "partitions": None, "total": None},
                             "v", "h", "r")
    assert u["status"] == "sampler_fail" and u["partitions"] == [] and "hs_m" not in u and u["cause"] == "unavailable"


def test_the_cli_refuses_a_real_run_without_the_owner_word(tmp_path, monkeypatch):
    t = tmp_path / "t.json"
    t.write_text(json.dumps(TARGETS), encoding="utf-8")
    monkeypatch.setattr(job, "_load_tide_table", lambda: table())
    rc = job.main(["--init", "2027-01-15T00:00Z", "--targets", str(t), "--store", "local", "--out", str(tmp_path / "o"), "--go"])
    assert rc == job.EXIT_REFUSED and not (tmp_path / "o").exists()


def _workflow():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return open(os.path.join(root, ".github", "workflows", "nearshore-lite-archive.yml"), encoding="utf-8").read()


def test_the_archive_workflow_is_dispatch_only_requires_the_owner_word_and_names_secrets_only():
    text = _workflow()
    on = text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert "workflow_dispatch:" in on and "schedule" not in on and "push:" not in on and "pull_request" not in on
    assert "stations:" not in on and "STATIONS" not in text
    assert "owner_word_ref:" in on and "required: true" in on.split("owner_word_ref:", 1)[1].split("init:", 1)[0]
    assert "${{ secrets.SUPABASE_URL }}" in text and "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" in text
    assert "service_role" not in text.lower().replace("supabase_service_role_key", "")           # no key material, names only
    assert "eyJ" not in text and "sk_" not in text


def test_ablation_the_arms_inputs_are_byte_identical_before_and_after_the_schema_move(tmp_path):
    """ABLATION: what CHAIN_SERVED, CHAIN_PART, LITE and OFFSHORE read (the partition train and the total train; #1157's
    `arms.input_hash` hashes exactly these) is the same whether the row goes straight to the arms or through the shared archive and back. No served
    number can move: the arms see identical bytes."""
    from services.point_archive import writer
    from services.weather_pipeline.nearshore_lite import records
    store = _store(tmp_path)
    src = _Parts().rows(INIT, TARGETS)
    _, s = job.run(INIT, TARGETS, DOC, store, WORD, table(), lambda u: SAMPLE, partition_source=_Parts(), fetched_at=FETCHED, dry_run=False)
    back = records.rows_from_records(writer.read_run_rows(store.read(s["archive_path"])))
    assert len(back) == len(src) == 73
    for a, b in zip(sorted(src, key=lambda r: r["lead_h"]), sorted(back, key=lambda r: r["lead_h"])):
        assert json.dumps(a["partitions"], sort_keys=True) == json.dumps(b["partitions"], sort_keys=True)
        assert json.dumps(a["total"], sort_keys=True) == json.dumps(b["total"], sort_keys=True)
