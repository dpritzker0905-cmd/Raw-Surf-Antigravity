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
    with pytest.raises(eta.EtaUnavailable):
        eta.eta_for_init(table(generated=INIT - timedelta(days=9)), 33.0, -118.0, INIT)      # stale table


def test_gaps_are_none_not_zero():
    t = table()
    t["am"]["33.0,-118.0"][3 * 24 + 7] = tide_own._MISSING
    e = eta.eta_for_init(t, 33.0, -118.0, INIT)
    assert e["missing"] == 1 and e["eta_m"][7] is None


TARGETS = [{"id": "T1", "lat": 33.0, "lon": -118.0}]


def test_dry_run_reads_but_writes_nothing(tmp_path):
    code, s = job.run(INIT, TARGETS, ["46086"], str(tmp_path / "o"), "", table(), lambda u: pytest.fail("no fetch"), dry_run=True)
    assert code == 0 and s["plan"].startswith("dry run") and s["eta"]["T1"]["missing"] == 0
    assert not (tmp_path / "o").exists()


@pytest.mark.parametrize("ref", ["", "  ", "tbd", "TODO", "short"])
def test_a_real_run_refuses_a_missing_or_placeholder_owner_word(tmp_path, ref):
    with pytest.raises(ValueError, match="owner-word-ref"):
        job.run(INIT, TARGETS, [], str(tmp_path / "o"), ref, table(), lambda u: SAMPLE, dry_run=False)
    assert not (tmp_path / "o").exists()


WORD = "David, chat, 2027-01-15 08:02 EST: run the first archive"


def test_without_a_partition_source_the_run_is_incomplete_and_writes_no_archive_init(tmp_path):
    code, s = job.run(INIT, TARGETS, ["46086"], str(tmp_path / "o"), WORD, table(), lambda u: SAMPLE, partition_source=None, dry_run=False)
    assert code == job.EXIT_INCOMPLETE and s["status"].startswith("INCOMPLETE")
    assert (tmp_path / "o" / "aux").is_dir() and (tmp_path / "o" / "truth" / "SHA256SUMS").exists()
    assert not (tmp_path / "o" / "archive").exists()                        # a partial init would block the real one


def test_the_unbuilt_partition_interface_refuses_to_pretend():
    with pytest.raises(NotImplementedError, match="not ruled"):
        job.PartitionSource().rows(INIT, TARGETS)


class _Parts(job.PartitionSource):
    def rows(self, init, targets):
        return [{"target": t["id"], "lead_h": h, "partitions": [{"h": 1.0, "tp": 12.0, "dir": 270.0, "kind": "swell"}]}
                for t in targets for h in range(0, 73)]


def test_with_a_partition_source_the_init_is_archived_with_eta_and_provenance(tmp_path):
    code, s = job.run(INIT, TARGETS, ["46086"], str(tmp_path / "o"), WORD, table(), lambda u: SAMPLE,
                      partition_source=_Parts(), dry_run=False)
    assert code == 0 and s["status"] == "ARCHIVED"
    d = str(tmp_path / "o" / "archive")
    assert archive.verify_archive(d) == [] and archive.missing_run(d, ["T1"]) == []
    name = next(n for n in os.listdir(d) if n.endswith(".json"))
    doc = json.loads(open(os.path.join(d, name), encoding="utf-8").read())
    assert doc["meta"]["owner_word_ref"] == WORD and doc["meta"]["tide_source"] == "am"
    assert doc["meta"]["eta_slice_sha256"]["T1"] == s["eta"]["T1"]["sha256"]
    assert doc["rows"][0]["eta_m"] is not None and "46086" in doc["meta"]["truth_sha256"]


def test_the_cli_refuses_a_real_run_without_the_owner_word(tmp_path, monkeypatch):
    t = tmp_path / "t.json"
    t.write_text(json.dumps(TARGETS), encoding="utf-8")
    monkeypatch.setattr(job, "_load_tide_table", lambda: table())
    rc = job.main(["--init", "2027-01-15T00:00Z", "--targets", str(t), "--out", str(tmp_path / "o"), "--go"])
    assert rc == job.EXIT_REFUSED and not (tmp_path / "o").exists()


def _workflow():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return open(os.path.join(root, ".github", "workflows", "nearshore-lite-archive.yml"), encoding="utf-8").read()


def test_the_archive_workflow_is_dispatch_only_requires_the_owner_word_and_names_secrets_only():
    text = _workflow()
    on = text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert "workflow_dispatch:" in on and "schedule" not in on and "push:" not in on and "pull_request" not in on
    assert "owner_word_ref:" in on and "required: true" in on.split("owner_word_ref:", 1)[1].split("init:", 1)[0]
    assert "${{ secrets.SUPABASE_URL }}" in text and "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" in text
    assert "service_role" not in text.lower().replace("supabase_service_role_key", "")           # no key material, names only
    assert "eyJ" not in text and "sk_" not in text
