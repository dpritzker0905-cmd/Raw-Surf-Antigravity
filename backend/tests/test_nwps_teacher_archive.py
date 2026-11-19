"""The NWPS teacher archive: it keeps NOAA's nearshore forecasts unaltered, within caps, and can not leak a key.

Owner, 2026-11-19 (typed in the director's session, relayed): "start the NWPS archive, but if we can be more SOTA
than NOAA, we need to use their forecast to help us, not just parrot what they say". What these pin:

  1. UNALTERED: a kept GRIB2 message is byte-identical to the source; only whole messages are dropped, by lead time
     read from fixed octets; a truncated or foreign file stops the split without raising;
  2. BOUNDED AND IDEMPOTENT: nothing already stored is planned again; the two caps stop a run cleanly and say what is
     left; the office order rotates so the same offices are not left out every day;
  3. NO CREDENTIAL in the collector, STANDARD LIBRARY ONLY in both scripts, create-only uploads, and an index is never
     stored without its data;
  4. NOT SELF-STARTING: the workflow's job runs only by hand or when a repository variable says so, and the key is in
     the environment of the two storage steps only;
  5. OUT OF THE CLEAN-UP'S REACH: no archive key is a product name.
"""
import ast
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(BACKEND, "scripts")
for p in (BACKEND, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import nwps_archive_bucket_io as IO  # noqa: E402
import nwps_teacher_archive as A  # noqa: E402

NOW = datetime(2026, 11, 19, 13, 23, tzinfo=timezone.utc)
STDLIB_OK = {"argparse", "gzip", "hashlib", "json", "os", "re", "sys", "time", "urllib", "datetime"}


def grib(lead, unit=1, discipline=10, category=0, number=3, payload=b"wavefield!", edition=2):
    """A minimal, well-formed GRIB2 message: sections 0, 1, 3, 4, 7 and the end marker."""
    sec1 = (21).to_bytes(4, "big") + bytes([1]) + bytes(16)
    sec3 = (15).to_bytes(4, "big") + bytes([3]) + bytes(10)
    sec4 = bytearray((34).to_bytes(4, "big") + bytes([4]) + bytes(29))
    sec4[9], sec4[10], sec4[17] = category, number, unit
    sec4[18:22] = int(lead).to_bytes(4, "big")
    sec7 = (5 + len(payload)).to_bytes(4, "big") + bytes([7]) + payload
    inner = sec1 + sec3 + bytes(sec4) + sec7
    total = 16 + len(inner) + 4
    return b"GRIB" + bytes(2) + bytes([discipline, edition]) + total.to_bytes(8, "big") + inner + b"7777"


# ── the directory listing ────────────────────────────────────────────────────────────────────────────────────
def test_the_index_parser_reads_entries_and_ignores_the_parent_and_sort_links():
    html = ('<a href="?C=N;O=D">Name</a> <a href="/pub/data/nccf/com/nwps/">Parent Directory</a> '
            '<a href="lox/">lox/</a> <a href="mtr/">mtr/</a> <a href="nwps.t12z.cg1.lox.grib2">f</a> <a href="lox/">again</a>')
    assert A.parse_index(html) == ["lox/", "mtr/", "nwps.t12z.cg1.lox.grib2"]
    assert A.parse_index("") == [] and A.parse_index(None) == []


# ── splitting on the bytes ───────────────────────────────────────────────────────────────────────────────────
def test_messages_are_found_and_a_truncated_or_foreign_tail_stops_the_split_without_raising():
    a, b = grib(0), grib(3)
    assert list(A.iter_messages(a + b)) == [(0, len(a)), (len(a), len(a) + len(b))]
    assert list(A.iter_messages(a + b[:-9])) == [(0, len(a))]                    # a truncated download
    assert list(A.iter_messages(a + b"<html>not found</html>")) == [(0, len(a))]
    assert list(A.iter_messages(grib(0, edition=1))) == []                        # another edition is not parsed
    assert list(A.iter_messages(b"")) == [] and list(A.iter_messages(b"GRIB")) == []


@pytest.mark.parametrize("lead,unit,hours", [(0, 1, 0.0), (12, 1, 12.0), (4, 10, 12.0), (90, 0, 1.5), (2, 2, 48.0)])
def test_the_lead_time_is_read_from_fixed_octets(lead, unit, hours):
    assert A.field_info(grib(lead, unit=unit, discipline=10, category=0, number=3)) == (10, 0, 3, pytest.approx(hours))


def test_an_unlisted_time_unit_is_not_guessed():
    assert A.field_info(grib(5, unit=77))[3] is None


def test_kept_messages_are_byte_identical_and_only_whole_messages_are_dropped():
    msgs = [grib(0, number=3), grib(6, number=11), grib(12, number=3), grib(13, number=3), grib(48, number=11),
            grib(5, unit=77, number=9)]                                           # the last: lead unreadable
    kept, stats = A.select(b"".join(msgs), keep_hours=12)
    assert kept == msgs[0] + msgs[1] + msgs[2] + msgs[5]
    assert stats["messages"] == 6 and stats["kept"] == 4 and stats["unknown_lead"] == 1
    assert stats["fields_kept"] == {"10.0.3": 2, "10.0.11": 1, "10.0.9": 1}
    assert stats["lead_hours_kept"] == [0.0, 12.0] and stats["unparsed_tail_bytes"] == 0


def test_garbage_keeps_nothing_and_says_how_much_was_not_parsed():
    kept, stats = A.select(b"<html>503</html>", keep_hours=12)
    assert kept == b"" and stats["messages"] == 0 and stats["unparsed_tail_bytes"] == 16


# ── the plan, the caps and idempotence ───────────────────────────────────────────────────────────────────────
def _listing(tree):
    return lambda url: tree.get(url, [])


def _tree(day="20261119", nested=False, spectra=False):
    """A fake NOAA server: every cycle folder lists its grids, every grid folder lists its files."""
    wr = "%s/wr.%s/" % (A.BASE, day)
    er = "%s/er.%s/" % (A.BASE, day)
    t = {wr: ["lox/", "mtr/", "readme.txt"], wr + "lox/": ["00/", "06/", "tmp/"], wr + "mtr/": ["00/"],
         er: ["mhx/"], er + "mhx/": ["00/"]}
    for root, wfo, cycle in ((wr, "lox", "00"), (wr, "lox", "06"), (wr, "mtr", "00"), (er, "mhx", "00")):
        c = "%s%s/%s/" % (root, wfo, cycle)
        t[c] = ["CG1/", "notes/"]
        t[c + "CG1/"] = ["nwps.t%sz.cg1.%s.grib2" % (cycle, wfo), "nwps.t%sz.20m_cg1_runup.%s.txt" % (cycle, wfo)]
    lox00 = wr + "lox/00/"
    if nested:
        t[lox00] = ["CG1/", "CG2/", "CG3/"]
        t[lox00 + "CG2/"] = ["nwps.t00z.cg2.lox.grib2"]
        t[lox00 + "CG3/"] = []                                    # the folder exists before its file does
    if spectra:
        t[lox00 + "CG1/"] = t[lox00 + "CG1/"] + ["nwps.t00z.spc2d_46025_cg1.lox.txt"]
    return t


def test_the_plan_lists_cycles_once_and_never_what_is_stored():
    jobs = A.plan(_listing(_tree()), ["20261119"], set(), 12)
    assert [(j[2], j[3]) for j in jobs] == [("mhx", "00"), ("lox", "00"), ("lox", "06"), ("mtr", "00")]
    assert jobs[1][5] == A.BASE + "/wr.20261119/lox/00/CG1/nwps.t00z.cg1.lox.grib2"
    assert jobs[1][4] == "calibration/nwps_teacher/v1/20261119/lox/t00z.cg1.f000-012.grib2"
    stored = {"20261119/lox/t00z.cg1.f000-012.grib2"}                             # as the storage step lists it
    assert [(j[2], j[3]) for j in A.plan(_listing(_tree()), ["20261119"], stored, 12)] == [
        ("mhx", "00"), ("lox", "06"), ("mtr", "00")]
    assert [(j[2], j[3]) for j in A.plan(_listing(_tree()), ["20261119"], set(), 12, wfos={"mtr"})] == [("mtr", "00")]


def test_the_office_order_rotates_and_the_set_of_jobs_does_not_change():
    base = A.plan(_listing(_tree()), ["20261119"], set(), 12)
    firsts = {A.plan(_listing(_tree()), ["20261119"], set(), 12, rotate=r)[0][2] for r in (1, 2, 3)}
    assert firsts == {"lox", "mhx", "mtr"}
    for r in (1, 2, 3):
        assert sorted(A.plan(_listing(_tree()), ["20261119"], set(), 12, rotate=r)) == sorted(base)


def _run(tmp_path, files, max_kept=10**9, max_download=10**9, existing=()):
    return A.run(_listing(_tree()), lambda u: files.get(u), str(tmp_path), ["20261119"], set(existing), 12,
                 max_kept, max_download, now=NOW, log=lambda *_: None)


def _files():
    blob = grib(0) + grib(6) + grib(24)
    return {j[5]: blob for j in A.plan(_listing(_tree()), ["20261119"], set(), 12)}, blob


def test_every_grid_an_office_publishes_and_every_spectrum_file_is_planned():
    """The nested grids are the ones that resolve the coast; the spectra let the teacher be checked before breaking."""
    tree = _tree(nested=True, spectra=True)
    jobs = [j for j in A.plan(_listing(tree), ["20261119"], set(), 12) if (j[2], j[3]) == ("lox", "00")]
    assert sorted((j[6], j[4].split("/")[-1]) for j in jobs) == [
        ("cg1", "t00z.cg1.f000-012.grib2"), ("cg2", "t00z.cg2.f000-012.grib2"),
        ("spectra", "t00z.spc2d_46025_cg1.txt.gz")]
    assert [j[5] for j in jobs if j[6] == "cg2"] == [A.BASE + "/wr.20261119/lox/00/CG2/nwps.t00z.cg2.lox.grib2"]
    # CG3 lists no file yet: not planned now, picked up by a later run; the run-up text is not a spectrum
    assert not any("cg3" in j[4] or "runup" in j[5] for j in jobs)


def test_a_spectrum_is_stored_whole_gzipped_and_gunzips_to_the_source(tmp_path):
    import gzip
    tree = _tree(spectra=True)
    text = b"NWPS 2D SPECTRUM\n" + b"0.05 0.06 0.07\n" * 400
    files = {j[5]: (text if j[6] == "spectra" else grib(0) + grib(24))
             for j in A.plan(_listing(tree), ["20261119"], set(), 12)}

    def go(where):
        return A.run(_listing(tree), lambda u: files.get(u), str(where), ["20261119"], set(), 12, 10**9, 10**9,
                     now=NOW, log=lambda *_: None)

    s = go(tmp_path / "a")
    d = tmp_path / "a" / "out" / "20261119" / "lox"
    stored = (d / "t00z.spc2d_46025_cg1.txt.gz.new").read_bytes()
    assert gzip.decompress(stored) == text and len(stored) < len(text)
    idx = json.loads((d / "t00z.spc2d_46025_cg1.index.json.new").read_text())
    assert idx["kind"] == "spectra" and idx["keep_hours"] is None
    assert idx["source_sha256"] == hashlib.sha256(text).hexdigest()
    assert s["files_by_kind"] == {"cg1": 4, "spectra": 1}
    assert s["kept_bytes_by_kind"]["spectra"] == len(stored) and s["source_bytes_by_kind"]["spectra"] == len(text)
    go(tmp_path / "b")                                            # the same source gives the same stored bytes
    assert (tmp_path / "b" / "out" / "20261119" / "lox" / "t00z.spc2d_46025_cg1.txt.gz.new").read_bytes() == stored


def test_a_run_writes_the_kept_bytes_and_an_index_that_names_its_source(tmp_path):
    files, blob = _files()
    s = _run(tmp_path, files)
    assert s["planned"] == 4 and s["saved"] == 4 and s["stopped"] is None and s["left_for_next_run"] == 0
    assert s["downloaded_bytes"] == 4 * len(blob) and s["kept_bytes"] == 4 * len(grib(0) + grib(6))
    assert s["kept_bytes_by_day"] == {"20261119": s["kept_bytes"]}
    d = tmp_path / "out" / "20261119" / "lox"
    kept = (d / "t00z.cg1.f000-012.grib2.new").read_bytes()
    assert kept == grib(0) + grib(6)
    idx = json.loads((d / "t00z.cg1.f000-012.index.json.new").read_text())
    assert idx["kept_sha256"] == hashlib.sha256(kept).hexdigest()
    assert idx["source_sha256"] == hashlib.sha256(blob).hexdigest() and idx["source_bytes"] == len(blob)
    assert idx["source"].endswith("/wr.20261119/lox/00/CG1/nwps.t00z.cg1.lox.grib2")
    assert "NOAA" in idx["attribution"] and idx["retrieved_at"] == "2026-11-19T13:23:00Z"
    assert idx["kept"] == 2 and idx["messages"] == 3 and idx["keep_hours"] == 12 and idx["kind"] == "cg1"
    assert s["files_by_kind"] == {"cg1": 4} and s["kept_bytes_by_kind"] == {"cg1": s["kept_bytes"]}
    assert s["source_bytes_by_kind"] == {"cg1": 4 * len(blob)}


def test_the_kept_cap_stops_the_run_and_says_what_is_left(tmp_path):
    files, _ = _files()
    s = _run(tmp_path, files, max_kept=1)                       # the first file reaches it
    assert s["saved"] == 1 and s["stopped"] == "kept cap" and s["left_for_next_run"] == 3


def test_the_download_cap_stops_the_run_too(tmp_path):
    files, blob = _files()
    s = _run(tmp_path, files, max_download=len(blob) + 1)
    assert s["saved"] == 2 and s["stopped"] == "download cap" and s["left_for_next_run"] == 2


def test_a_file_that_was_listed_and_then_fails_is_counted_and_left_for_later(tmp_path):
    files, _ = _files()
    gone = sorted(files)[0]
    del files[gone]
    s = _run(tmp_path, files)
    assert s["saved"] == 3 and s["skipped_absent"] == 1


def test_a_second_run_over_what_the_first_stored_plans_nothing(tmp_path):
    files, _ = _files()
    _run(tmp_path, files)
    stored = [j[4][len(A.PREFIX) + 1:] for j in A.plan(_listing(_tree()), ["20261119"], set(), 12)]
    s = _run(tmp_path, files, existing=stored)
    assert s["planned"] == 0 and s["saved"] == 0 and s["downloaded_bytes"] == 0


# ── the switches and the credential rule ─────────────────────────────────────────────────────────────────────
def _no_network(monkeypatch):
    monkeypatch.setattr(A, "_http", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network used")))


def test_the_kill_switch_fetches_nothing(monkeypatch, tmp_path):
    monkeypatch.setenv(A.FLAG, "0")
    _no_network(monkeypatch)
    assert A.main(["--cache", str(tmp_path)]) == 0
    assert list(tmp_path.iterdir()) == []


def test_without_the_stored_key_list_the_collector_refuses_to_run(monkeypatch, tmp_path):
    monkeypatch.delenv(A.FLAG, raising=False)
    _no_network(monkeypatch)
    assert A.main(["--cache", str(tmp_path)]) == 2


def _top_imports(path):
    tree = ast.parse(open(path, encoding="utf-8").read())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names.add((node.module or "").split(".")[0])
    return names


@pytest.mark.parametrize("name", ["nwps_teacher_archive.py", "nwps_archive_bucket_io.py"])
def test_both_scripts_import_the_standard_library_only(name):
    assert _top_imports(os.path.join(SCRIPTS, name)) <= STDLIB_OK


def test_the_collector_names_no_credential():
    src = open(os.path.join(SCRIPTS, "nwps_teacher_archive.py"), encoding="utf-8").read()
    assert "os.environ.get(\"SUPABASE" not in src and "SERVICE_ROLE" not in src and "apikey" not in src


# ── the storage script ───────────────────────────────────────────────────────────────────────────────────────
def test_uploads_are_create_only(monkeypatch):
    seen = []
    monkeypatch.setattr(IO, "_req", lambda m, p, body=None, ctype=None, extra=None: seen.append((m, p, extra)) or (200, b""))
    assert IO.put_new("calibration/nwps_teacher/v1/x", b"b") == 200
    assert seen == [("POST", "/storage/v1/object/weather-products/calibration/nwps_teacher/v1/x", {"x-upsert": "false"})]


def test_a_failed_listing_gives_no_key_list_at_all():
    tree = {IO.PREFIX + "/20261119": ["lox", "mtr"], IO.PREFIX + "/20261119/lox": ["a.grib2"],
            IO.PREFIX + "/20261119/mtr": None}
    assert IO.existing_keys(["20261119"], lister=lambda p: tree.get(p, [])) is None
    tree[IO.PREFIX + "/20261119/mtr"] = ["b.grib2"]
    assert IO.existing_keys(["20261119"], lister=lambda p: tree.get(p, [])) == ["20261119/lox/a.grib2", "20261119/mtr/b.grib2"]


def test_data_goes_up_before_its_index_and_an_index_never_goes_up_alone(monkeypatch, tmp_path, capsys):
    d = tmp_path / "out" / "20261119" / "lox"
    d.mkdir(parents=True)
    (d / "t00z.cg1.f000-012.grib2.new").write_bytes(b"data")
    (d / "t00z.cg1.f000-012.index.json.new").write_text("{}")
    order = [k for _p, k in IO.pending_uploads(str(tmp_path))]
    assert order == [IO.PREFIX + "/20261119/lox/t00z.cg1.f000-012.grib2", IO.PREFIX + "/20261119/lox/t00z.cg1.f000-012.index.json"]
    sent = []
    monkeypatch.setattr(IO, "put_new", lambda key, blob: sent.append(key) or 409)        # the data file is refused
    assert IO.main(["x", "upload", "--dir", str(tmp_path)]) == 0
    assert sent == [order[0]] and "index skipped" in capsys.readouterr().out


def test_a_spectrum_index_goes_up_only_with_its_gzipped_data(monkeypatch, tmp_path):
    d = tmp_path / "out" / "20261119" / "lox"
    d.mkdir(parents=True)
    (d / "t00z.spc2d_46025_cg1.txt.gz.new").write_bytes(b"gz")
    (d / "t00z.spc2d_46025_cg1.index.json.new").write_text("{}")
    sent = []
    monkeypatch.setattr(IO, "put_new", lambda key, blob: sent.append(key.split("/")[-1]) or 200)
    assert IO.main(["x", "upload", "--dir", str(tmp_path)]) == 0
    assert sent == ["t00z.spc2d_46025_cg1.txt.gz", "t00z.spc2d_46025_cg1.index.json"]


# ── the workflow and the clean-up ────────────────────────────────────────────────────────────────────────────
def test_the_workflow_does_not_start_itself_and_the_key_is_in_the_storage_steps_only():
    path = os.path.join(os.path.dirname(BACKEND), ".github", "workflows", "nwps-teacher-archive.yml")
    text = open(path, encoding="utf-8").read()
    assert "if: ${{ github.event_name == 'workflow_dispatch' || vars.NWPS_TEACHER_ARCHIVE == '1' }}" in text
    steps = text.split("\n      - ")[1:]
    with_key = [s for s in steps if "SUPABASE_SERVICE_ROLE_KEY" in s]
    assert len(with_key) == 2 and all("nwps_archive_bucket_io.py" in s and "python3 -I -S" in s for s in with_key)
    collect = [s for s in steps if "nwps_teacher_archive.py" in s]
    assert len(collect) == 1 and "SUPABASE" not in collect[0] and "pip install" not in text


def test_no_archive_key_is_a_product_name():
    from services.weather_pipeline.product_object_gc import is_product_object
    key = A.object_key("20261119", "lox", "00", 12)
    assert key.startswith("calibration/nwps_teacher/v1/")
    spec = A.spectrum_key("20261119", "lox", "nwps.t12z.spc2d_46025_cg1.lox.txt")
    assert spec == "calibration/nwps_teacher/v1/20261119/lox/t12z.spc2d_46025_cg1.txt.gz"
    assert A.object_key("20261119", "lox", "00", 12, "CG2").endswith("/t00z.cg2.f000-012.grib2")
    for k in (key, key.split("/")[-1], key[:-len(".grib2")] + ".index.json", spec, spec.split("/")[-1]):
        assert not is_product_object(k)


# ── advisor HOLD fixes (2026-11-19): a partial file is never stored; an outage or a failed upload is a red run ──
def test_a_truncated_download_is_never_stored_and_is_left_for_the_next_run(tmp_path):
    files, blob = _files()
    first = sorted(files)[0]
    files[first] = blob + grib(3)[:-9]                          # whole messages, then a cut-off one
    s = _run(tmp_path, files)
    assert s["skipped_truncated"] == 1 and s["saved"] == len(files) - 1
    stored = [p for p in tmp_path.rglob("*.new")]
    assert all(open(p, "rb").read() != blob + grib(3)[:-9] for p in stored)


def test_a_source_outage_turns_the_collector_run_red(monkeypatch, tmp_path):
    monkeypatch.delenv(A.FLAG, raising=False)
    (tmp_path / "existing.json").write_text("[]")
    monkeypatch.setitem(A.NET_FAILURES, "count", 0)

    def refused(url, pause, limit=None):
        A.NET_FAILURES["count"] += 1                             # what _http does for a non-404 failure
        return None
    monkeypatch.setattr(A, "_http", refused)
    assert A.main(["--cache", str(tmp_path), "--pause", "0"]) == 1
    assert (tmp_path / "collect_report_nwps.json").exists()     # the report is still written


def test_a_failed_upload_turns_the_storage_run_red(monkeypatch, tmp_path):
    d = tmp_path / "out" / "20261119" / "lox"
    d.mkdir(parents=True)
    (d / "t00z.cg1.f000-012.grib2.new").write_bytes(b"data")
    monkeypatch.setattr(IO, "put_new", lambda key, blob: 500)
    assert IO.main(["x", "upload", "--dir", str(tmp_path)]) == 1


def test_the_job_reads_the_key_only_through_the_supabase_service_environment():
    wf = open(os.path.join(BACKEND, "..", ".github", "workflows", "nwps-teacher-archive.yml"), encoding="utf-8").read()
    assert "environment: supabase-service" in wf
