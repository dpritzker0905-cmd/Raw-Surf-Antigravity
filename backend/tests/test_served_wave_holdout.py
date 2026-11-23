"""Amendment 2 (#1199 section 1a): the LOCKED final holdout and the fit-used tags.

Pinned here: collection archives every buoy; the scorer reads, prints and publishes nothing until #1199's LOCKED list is
frozen, committed and verified by its SHA-256 (NOT_READ, collect-only); once READY, a LOCKED id never appears in any scored
document, printed line or downloaded file, and the scores equal scoring with those buoys simply absent."""
import copy
import gzip
import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.point_archive import buoys as buoylist
from services.point_archive import core, holdout
from services.point_archive import served_scorer as sc
from services.point_archive.storage import LocalStore
from services.point_archive.writer import ArchiveWriter, gzip_bytes, jsonl_bytes

GOLDEN = Path(__file__).parent / "fixtures" / "served_wave_verify" / "golden"
SCORE_CLI = Path(__file__).resolve().parents[1] / "scripts" / "served_wave_verify_score.py"
FREEZE = Path(__file__).resolve().parents[1] / "scripts" / "served_wave_verify_freeze_buoys.py"
LOCKED_ID = "SYN02"


def _mod(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _golden():
    doc = json.loads((GOLDEN / "buoys.json").read_text(encoding="utf-8"))
    records = [json.loads(x) for x in (GOLDEN / "records.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    exp = json.loads((GOLDEN / "expected.json").read_text(encoding="utf-8"))
    return doc, records, exp


def _v2(doc, locked=None, root=None):
    """The golden list as a version 2 list; with `locked`, also the frozen locked-list file under `root` (its sha recorded)."""
    out = copy.deepcopy(doc)
    out["holdout"] = {"locked_list": None}
    for s in out["stations"]:
        s.update(fit_used=False, fit_used_by=[], locked=None)
    if locked is not None:
        raw = (json.dumps({"gate": "docs/weather-program/gates/served-wave-skill-v1.md", "seed": 1199, "fraction": 0.2,
                           "stratified_by": "region", "drawn_from_buoy_list_hash": buoylist.list_hash(out),
                           "locked": sorted(locked)}, indent=1) + "\n").encode("utf-8")
        path = Path(root) / holdout.LOCKED_LIST_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        out["holdout"]["locked_list"] = {"path": holdout.LOCKED_LIST_PATH, "sha256": hashlib.sha256(raw).hexdigest()}
        for s in out["stations"]:
            s["locked"] = s["id"] in locked
    return out


def _truth(exp, ids):
    return {s: sc.Truth([(exp["fetched_at"], (GOLDEN / f"{s}.txt").read_text(encoding="utf-8"))]) for s in ids}


# ---------------------------------------------------------------- the committed list (version 2)

def test_committed_list_is_collect_only_until_1199_freezes():
    doc = buoylist.load()
    status, info = holdout.state(doc)
    assert status == holdout.NOT_READ and info["error"] is False
    assert doc["holdout"]["locked_list"] is None
    assert all(s["locked"] is None for s in doc["stations"])


def test_committed_fit_used_tags_follow_the_census():
    doc = buoylist.load()
    census = json.loads((buoylist.LIST_PATH.parent / "served-wave-verify-v1-fit-used.json").read_text(encoding="utf-8"))
    users = {}
    for name, c in census["consumers"].items():
        for i in c["ids"]:
            users.setdefault(i, set()).add(name)
    for s in doc["stations"]:
        assert set(s["fit_used_by"]) == users.get(s["id"], set()), s["id"]
        assert s["fit_used"] is bool(s["fit_used_by"])
    assert sum(s["fit_used"] for s in doc["stations"]) == 26
    assert doc["holdout"]["fit_used_census"]["canon_sha256"] == core.sha256_hex(core.canon(census).encode("utf-8"))
    assert doc["holdout"]["fit_used_census"]["open"], "the unread wind/gust EMOS station set stays named as open"


def test_hash_ignores_only_the_freeze_filled_fields():
    doc = buoylist.load()
    h = buoylist.list_hash(doc)
    filled = copy.deepcopy(doc)
    filled["holdout"]["locked_list"] = {"path": holdout.LOCKED_LIST_PATH, "sha256": "0" * 64}
    for i, s in enumerate(filled["stations"]):
        s["locked"] = i % 5 == 0
    assert buoylist.list_hash(filled) == h                     # filling #1199's freeze makes no new list version
    retagged = copy.deepcopy(doc)
    retagged["stations"][0]["fit_used"] = not retagged["stations"][0]["fit_used"]
    assert buoylist.list_hash(retagged) != h                   # a fit-used change IS a new version


def test_tag_rejects_a_fit_used_flag_without_its_consumer():
    doc = buoylist.load()
    bad = copy.deepcopy(doc)
    bad["stations"][0]["fit_used_by"] = []
    bad["stations"][0]["fit_used"] = True
    assert any("fit_used" in p for p in buoylist.validate(bad))
    mod = _mod(FREEZE, "swv_freeze_h")
    t = mod.tag({"version": "x", "stations": [{"id": "A1"}, {"id": "b2"}]},
                {"taken_at": "d", "consumers": {"k": {"ids": ["B2", "ZZ"]}}, "open": []})
    assert [(s["id"], s["fit_used"], s["fit_used_by"], s["locked"]) for s in t["stations"]] == [
        ("A1", False, [], None), ("b2", True, ["k"], None)]


# ---------------------------------------------------------------- holdout.state: fails closed

def test_state_ready_only_for_a_verified_list(tmp_path):
    doc, _, _ = _golden()
    ok = _v2(doc, {LOCKED_ID}, tmp_path)
    status, info = holdout.state(ok, tmp_path)
    assert status == holdout.READY and info["locked"] == {LOCKED_ID}

    bad_sha = copy.deepcopy(ok)
    bad_sha["holdout"]["locked_list"]["sha256"] = "f" * 64
    missing = copy.deepcopy(ok)
    missing["holdout"]["locked_list"]["path"] = "docs/nowhere.json"
    disagree = copy.deepcopy(ok)
    disagree["stations"][0]["locked"] = True
    tags_without_list = _v2(doc)
    tags_without_list["stations"][1]["locked"] = True
    for case in (bad_sha, missing, disagree, tags_without_list):
        status, info = holdout.state(case, tmp_path)
        assert status == holdout.NOT_READ and info["error"] is True, info


def test_redact_is_word_bounded():
    assert holdout.redact("SYN02 syn02 SYN021 XSYN02 [SYN02]", {"SYN02"}) == "<locked> <locked> SYN021 XSYN02 [<locked>]"
    assert holdout.is_locked_path("verify/point-archive/v1/truth/SYN02/SYN02_x.txt.gz", {"SYN02"})
    assert not holdout.is_locked_path("verify/point-archive/v1/truth/SYN03/SYN03_x.txt.gz", {"SYN02"})


# ---------------------------------------------------------------- the scorer core

def test_scorer_excludes_locked_exactly_as_if_absent():
    doc, records, exp = _golden()
    ids = ("SYN01", "SYN02", "SYN03", "SYN04")
    kw = {"min_n": 1, "min_buoys": 1, "min_runs": 1}
    with_lock = sc.score(records, _truth(exp, ids), doc, exp["asof"], locked={LOCKED_ID}, locked_sha256="abc", **kw)
    absent_doc = {**doc, "stations": [s for s in doc["stations"] if s["id"] != LOCKED_ID]}
    absent = sc.score([r for r in records if r["station_id"] != LOCKED_ID], _truth(exp, [i for i in ids if i != LOCKED_ID]),
                      absent_doc, exp["asof"], **kw)
    everyone = sc.score(records, _truth(exp, ids), doc, exp["asof"], **kw)
    assert with_lock["windows"] == absent["windows"]
    assert with_lock["windows"] != everyone["windows"]          # the control: SYN02 does move the tables when read
    assert LOCKED_ID not in core.canon(with_lock)
    assert with_lock["holdout"] == {"locked_list_sha256": "abc", "locked_excluded": 1, "fit_used_in_tables": None}


# ---------------------------------------------------------------- the CLI end to end (local store, no network)

def _archive(tmp_path, exp, records):
    store = LocalStore(tmp_path / "bucket")
    w = ArchiveWriter(store)
    by_run = {}
    for r in records:
        by_run.setdefault((r["model"], r["run_time"]), []).append(r)
    for (model, run), rows in sorted(by_run.items()):
        w.write_immutable(core.run_path("served", model, core.parse_time(run)), gzip_bytes(jsonl_bytes(rows)))
    for s in ("SYN01", "SYN02", "SYN03", "SYN04"):
        w.write_truth(s, "txt", core.parse_time(exp["fetched_at"]), (GOLDEN / f"{s}.txt").read_text(encoding="utf-8"))
    return tmp_path / "bucket"


class _NoSupabase:
    def __init__(self, *a, **k):
        raise AssertionError("the private or public bucket was touched")


def _run(cli, monkeypatch, capsys, argv):
    monkeypatch.setenv("SERVED_WAVE_VERIFY", "1")
    monkeypatch.setattr(cli, "SupabaseStore", _NoSupabase)
    rc = cli.main(argv)
    return rc, capsys.readouterr()


@pytest.mark.parametrize("attempt", [1, 2])                     # "test twice": the second run must read identically
def test_cli_ready_never_shows_a_locked_id(tmp_path, monkeypatch, capsys, attempt):
    cli = _mod(SCORE_CLI, f"swv_score_cli_{attempt}")
    doc, records, exp = _golden()
    root = tmp_path / "repo"
    v2 = _v2(doc, {LOCKED_ID}, root)
    (tmp_path / "list.json").write_text(json.dumps(v2), encoding="utf-8")
    bucket = _archive(tmp_path, exp, records)
    dl, out = tmp_path / "dl", tmp_path / "out"
    common = ["--buoy-list", str(tmp_path / "list.json"), "--repo-root", str(root), "--asof", exp["asof"]]
    rc, cap = _run(cli, monkeypatch, capsys, common + ["--local-store", str(bucket), "--download", str(dl),
                                                       "--score", str(dl), "--out", str(out), "--verify"])
    assert rc == 0, cap.out + cap.err
    body = (out / "scores.json").read_text(encoding="utf-8")
    assert json.loads(body)["status"] == "scored"
    assert LOCKED_ID not in body and LOCKED_ID.lower() not in body.lower()
    assert LOCKED_ID not in cap.out + cap.err
    downloaded = [str(p.relative_to(dl)) for p in dl.rglob("*") if p.is_file()]
    assert downloaded and not [p for p in downloaded if LOCKED_ID in p]   # its truth is never fetched
    assert any("SYN03" in p for p in downloaded)
    # the published document is refused if it ever names a locked id (planted)
    planted = json.loads(body)
    planted["note"] = f"look at {LOCKED_ID}"
    (out / "scores.json").write_text(core.canon(planted), encoding="utf-8")
    rc, cap = _run(cli, monkeypatch, capsys, common + ["--publish", str(out)])
    assert rc == 1 and "REFUSED" in cap.out and LOCKED_ID not in cap.out


def test_cli_snapshot_and_verify_lines_are_redacted(tmp_path, monkeypatch, capsys):
    cli = _mod(SCORE_CLI, "swv_score_cli_snap")
    doc, records, exp = _golden()
    root = tmp_path / "repo"
    v2 = _v2(doc, {LOCKED_ID}, root)
    store = LocalStore(tmp_path / "b")
    got = cli.snapshot_truth(ArchiveWriter(store), v2, datetime(2027, 1, 16, tzinfo=timezone.utc), opener=lambda u: None, pause=0)
    assert any(LOCKED_ID in m for m in got["missing"])            # collection still tries every buoy
    monkeypatch.setattr("sys.stdout", __import__("io").StringIO())
    cli.say(json.dumps(got), {LOCKED_ID})
    printed = __import__("sys").stdout.getvalue()
    assert LOCKED_ID not in printed and "SYN03" in printed
    # verify: a tampered locked truth file is reported, but by a redacted path
    bucket = _archive(tmp_path, exp, records)
    p = next((bucket / core.truth_prefix(LOCKED_ID)).glob("*.gz"))
    p.write_bytes(gzip.compress(b"tampered"))
    (tmp_path / "list.json").write_text(json.dumps(v2), encoding="utf-8")
    monkeypatch.undo()
    rc, cap = _run(cli, monkeypatch, capsys, ["--buoy-list", str(tmp_path / "list.json"), "--repo-root", str(root),
                                              "--local-store", str(bucket), "--verify"])
    assert rc == 1 and "sha256 mismatch" in cap.out and LOCKED_ID not in cap.out


@pytest.mark.parametrize("attempt", [1, 2])
def test_cli_not_read_reads_and_publishes_nothing(tmp_path, monkeypatch, capsys, attempt):
    cli = _mod(SCORE_CLI, f"swv_score_cli_nr_{attempt}")
    doc, records, exp = _golden()
    (tmp_path / "list.json").write_text(json.dumps(_v2(doc)), encoding="utf-8")   # no frozen locked list yet
    bucket = _archive(tmp_path, exp, records)
    dl, out = tmp_path / "dl", tmp_path / "out"
    loads = []
    monkeypatch.setattr(cli, "load_local", lambda *a, **k: loads.append(a) or ([], {}))
    rc, cap = _run(cli, monkeypatch, capsys, ["--buoy-list", str(tmp_path / "list.json"), "--repo-root", str(tmp_path),
                                              "--asof", exp["asof"], "--local-store", str(bucket), "--download", str(dl),
                                              "--score", str(dl), "--out", str(out), "--publish", str(out)])
    assert rc == 0, cap.out
    assert not dl.exists() and loads == []                       # nothing downloaded, nothing loaded
    got = json.loads((out / "scores.json").read_text(encoding="utf-8"))
    assert got["status"] == holdout.NOT_READ and "windows" not in got
    assert "nothing published" in cap.out and "NOT_READ" in cap.out
    for s in ("SYN01", "SYN02", "SYN03", "SYN04"):
        assert s not in cap.out and s not in json.dumps(got)


def test_cli_broken_locked_list_fails_loud_and_reads_nothing(tmp_path, monkeypatch, capsys):
    cli = _mod(SCORE_CLI, "swv_score_cli_broken")
    doc, records, exp = _golden()
    root = tmp_path / "repo"
    v2 = _v2(doc, {LOCKED_ID}, root)
    v2["holdout"]["locked_list"]["sha256"] = "0" * 64
    (tmp_path / "list.json").write_text(json.dumps(v2), encoding="utf-8")
    rc, cap = _run(cli, monkeypatch, capsys, ["--buoy-list", str(tmp_path / "list.json"), "--repo-root", str(root),
                                              "--asof", exp["asof"], "--score", str(tmp_path / "none"), "--out", str(tmp_path / "o")])
    assert rc == 1 and "does not verify" in cap.out
    assert json.loads((tmp_path / "o" / "scores.json").read_text(encoding="utf-8"))["status"] == holdout.NOT_READ


def test_snapshot_workflow_commits_only_a_scored_document():
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "served-wave-verify-score.yml").read_text(encoding="utf-8")
    assert "grep -q '\"status\":\"scored\"'" in wf
