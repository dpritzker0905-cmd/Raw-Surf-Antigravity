"""services/buoy_holdout.py, the ONE fence around #1199's LOCKED buoys (amendment 3 of served-wave-verify-v1).

Pinned: no list recorded = a strict no-op; a verified list locks its ids AND their aliases; a recorded list that does not
verify QUARANTINES the whole pool (fail closed, no second source trusted, nothing raised); allow_url refuses every URL shape
that names a locked station; drop and redact; the strict served-wave wrapper verifies through the same code."""
import hashlib
import json

import pytest

from services import buoy_holdout as bh
from services.point_archive import holdout as strict

STATIONS = [{"id": "46025", "wmo_id": "46025"}, {"id": "41004", "wmo_id": "41004"}, {"id": "SYN99", "wmo_id": "99001"},
            {"id": "100", "wmo_id": "46225"},
            {"id": "51201", "wmo_id": "51201", "source": "cdip", "name": "Waimea Bay, HI (106)"}]


def _root(tmp_path, locked=None, tags=None, sha=None, write_list=True):
    doc = {"version": "t/2", "holdout": {"locked_list": None},
           "stations": [{**s, "locked": None} for s in STATIONS]}
    if locked is not None:
        raw = (json.dumps({"seed": 1199, "locked": locked}) + "\n").encode("utf-8")
        p = tmp_path / "docs/weather-program/gates/served-wave-skill-v1-locked.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        if write_list:
            p.write_bytes(raw)
        doc["holdout"]["locked_list"] = {"path": "docs/weather-program/gates/served-wave-skill-v1-locked.json",
                                         "sha256": sha or hashlib.sha256(raw).hexdigest()}
        for s in doc["stations"]:
            s["locked"] = (tags or {}).get(s["id"], s["id"] in locked)
    elif tags:
        for s in doc["stations"]:
            s["locked"] = tags.get(s["id"])
    p = tmp_path / bh.BUOY_LIST
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc), encoding="utf-8")
    return doc


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv(bh.ENV_ROOT, str(tmp_path))
    bh.reset_cache()
    yield tmp_path
    bh.reset_cache()


def test_cdip_buoys_are_locked_by_their_cdip_number_too(root):
    _root(root, locked=["51201"])
    assert bh.locked() == {"51201", "106"}
    assert bh.is_locked("106") and bh.is_locked("106p1") and bh.is_locked("51201")
    assert not bh.allow_url("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/106p1/106p1_historic.nc")
    assert not bh.allow_url("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/106p1_rt.nc.ascii?waveHs")
    assert bh.allow_url("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/1061p1_rt.nc")
    committed = json.loads((bh.REPO_ROOT / bh.BUOY_LIST).read_text(encoding="utf-8"))
    cdip = [s for s in committed["stations"] if s["source"] == "cdip"]
    assert cdip and all(len(bh._aliases(s)) == 2 and any(len(a) == 3 for a in bh._aliases(s)) for s in cdip), \
        "every committed CDIP buoy must carry its CDIP number as an alias"


def _freeze_mod():
    import importlib.util
    p = bh.REPO_ROOT / "backend/scripts/served_wave_verify_freeze_buoys.py"
    spec = importlib.util.spec_from_file_location("swv_freeze", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_committed_record_is_verified_not_quarantined():
    """#1199's freeze is recorded. A quarantine here would lock every buoy, so CI fails loudly on it."""
    bh.reset_cache()
    st = bh.state()
    assert st["status"] == "verified", st.get("reason")
    assert len(st["locked"]) == 15
    open_ids = [s["id"] for s in json.loads((bh.REPO_ROOT / bh.BUOY_LIST).read_text(encoding="utf-8"))["stations"]
                if not s["locked"]]
    rows = [{"station_id": i} for i in open_ids]
    assert bh.drop(rows) == rows                          # an unlocked buoy passes untouched


def test_committed_draw_reproduces_and_obeys_the_ruling():
    """#1199 amendment 1 (owner ruling 2026-11-23): eligible = not exam_only and not fit_used; k_r = floor(0.2 n_r + 0.5);
    one random.Random(1199) stream over regions in lexicographic order. Redrawing from the committed list reproduces the
    committed LOCKED file byte for byte, so the draw is checkable by anyone."""
    mod = _freeze_mod()
    doc = json.loads((bh.REPO_ROOT / bh.BUOY_LIST).read_text(encoding="utf-8"))
    unlocked = {**doc, "stations": [{**s, "locked": None} for s in doc["stations"]],
                "holdout": {**doc["holdout"], "locked_list": None}}
    raw = (bh.REPO_ROOT / mod.LOCKED_PATH).read_bytes()
    assert (json.dumps(mod.draw(unlocked), indent=1, sort_keys=True) + "\n").encode("utf-8") == raw
    got = json.loads(raw)
    by = {s["id"]: s for s in doc["stations"]}
    assert all(not by[i]["exam_only"] and not by[i]["fit_used"] for i in got["locked"])
    assert got["n_eligible"] == 71 and sum(got["k"].values()) == 15
    assert got["k"] == {r: (2 * len(v) + 5) // 10 for r, v in got["eligible"].items()}
    census = json.loads((bh.REPO_ROOT / "docs/weather-program/gates/served-wave-verify-v1-fit-used.json").read_text(
        encoding="utf-8"))
    every_fit = {str(i).upper() for c in census["consumers"].values() for i in c["ids"]}
    assert not set(got["locked"]) & every_fit           # no served or built fit has read a LOCKED buoy
    assert hashlib.sha256(raw).hexdigest() == doc["holdout"]["locked_list"]["sha256"]


def test_the_draw_never_redraws(tmp_path, monkeypatch):
    mod = _freeze_mod()
    out = tmp_path / "buoys.json"
    out.write_text((bh.REPO_ROOT / bh.BUOY_LIST).read_text(encoding="utf-8"), encoding="utf-8")
    with pytest.raises(SystemExit, match="already recorded"):
        mod.main(["--draw-locked", "--out", str(out)])


def test_quarantine_is_loud_in_actions(root, capsys, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    _root(root, locked=["SYN99"], sha="0" * 64)
    assert bh.state()["status"] == "quarantine"
    cap = capsys.readouterr()
    assert "::error title=LOCKED holdout quarantine::" in cap.out and "!" * 100 in cap.err
    assert "SYN99" not in cap.out + cap.err             # the alarm names no buoy (public logs)


def test_unrecorded_list_is_a_no_op(root):
    _root(root)
    assert bh.state()["status"] == "none"
    assert all(bh.keep(s["id"]) for s in STATIONS)


def test_verified_list_locks_ids_and_aliases(root):
    _root(root, locked=["SYN99", "100"])
    st = bh.state()
    assert st["status"] == "verified" and len(st["sha256"]) == 64
    assert st["locked"] == {"SYN99", "99001", "100", "46225"}
    assert bh.is_locked("syn99") and bh.is_locked("99001") and bh.is_locked("46225")
    assert bh.keep("46025") and bh.keep("41004")
    rows = [{"station_id": s["id"]} for s in STATIONS]
    assert [r["station_id"] for r in bh.drop(rows)] == ["46025", "41004", "51201"]
    assert [x for x in bh.drop(["46025", "100"], key=lambda r: r)] == ["46025"]
    assert bh.redact("ok 46025, bad SYN99 and 46225; 461001 stays") == "ok 46025, bad <locked> and <locked>; 461001 stays"


@pytest.mark.parametrize("url,ok", [
    ("https://www.ndbc.noaa.gov/data/realtime2/46225.txt", False),
    ("https://www.ndbc.noaa.gov/data/realtime2/46225.spec", False),
    ("https://www.ndbc.noaa.gov/view_text_file.php?filename=46225h2025.txt.gz&dir=data/historical/stdmet/", False),
    ("https://www.ndbc.noaa.gov/station_page.php?station=46225", False),
    ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/100p1_rt.nc.ascii?waveHs", False),
    ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/100p1/100p1_historic.nc", False),
    ("https://www.ndbc.noaa.gov/data/realtime2/46025.txt", True),
    ("https://www.ndbc.noaa.gov/data/realtime2/146225.txt", True),     # a longer id is not the locked one
    ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/1001p1_rt.nc", True),
    # ERDDAP quotes the id, and clients percent-encode the quotes (once, or twice through a proxy): decoded first
    ("https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station,time,wvht&station=%2246225%22", False),
    ("https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station%2Ctime&station%3D%252246225%2522", False),
    ('https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station,time&station="46225"', False),
    ("https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station,time&station=%2246025%22", True),
])
def test_allow_url_refuses_every_shape_naming_a_locked_station(root, url, ok):
    _root(root, locked=["100"])
    assert bh.allow_url(url) is ok


@pytest.mark.parametrize("case", ["hash", "missing", "tags_disagree", "unknown_id", "tags_without_list"])
def test_a_recorded_list_that_does_not_verify_quarantines_the_whole_pool(root, capsys, case):
    if case == "hash":
        _root(root, locked=["SYN99"], sha="0" * 64)
    elif case == "missing":
        _root(root, locked=["SYN99"], write_list=False)
    elif case == "tags_disagree":
        _root(root, locked=["SYN99"], tags={"46025": True})
    elif case == "unknown_id":
        _root(root, locked=["NOPE1"])
    else:
        _root(root, tags={"46025": True})
    st = bh.state()
    assert st["status"] == "quarantine", st
    for s in STATIONS:                                   # every listed buoy and alias is treated as locked: fail closed
        assert bh.is_locked(s["id"]) and bh.is_locked(s["wmo_id"])
    assert not bh.allow_url("https://www.ndbc.noaa.gov/data/realtime2/46025.txt")
    assert bh.drop([{"station_id": "41004"}]) == []
    assert "QUARANTINE" in capsys.readouterr().err


def test_unreadable_list_locks_everything(root):
    p = root / bh.BUOY_LIST
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{not json", encoding="utf-8")
    assert bh.state()["status"] == "quarantine"
    assert bh.is_locked("ANYTHING") and not bh.allow_url("https://www.ndbc.noaa.gov/data/realtime2/12345.txt")
    # no id is known to be safe, so every buoy-shaped token is redacted (LongCat review 2026-11-23)
    assert bh.redact("46025, KIKH1, 106p1 and 100 failed; ERROR at row") == \
        "<locked>, <locked>, <locked> and <locked> failed; ERROR at row"


@pytest.mark.parametrize("bad", ["../outside.json", "/etc/passwd", "C:/Windows/win.ini", "C:win.ini",
                                 "//host/share/x.json", r"\\host\share\x.json", r"docs\..\..\x.json",
                                 "docs/../../outside.json"])
def test_a_locked_list_path_outside_the_repo_quarantines(root, bad):
    _root(root, locked=["SYN99"])
    doc = json.loads((root / bh.BUOY_LIST).read_text(encoding="utf-8"))
    doc["holdout"]["locked_list"]["path"] = bad
    (root / bh.BUOY_LIST).write_text(json.dumps(doc), encoding="utf-8")
    st = bh.state()
    assert st["status"] == "quarantine" and "inside the repository" in st["reason"]


def test_path_confinement_is_the_same_on_every_platform():
    """Pure-string decision (PurePosixPath + PureWindowsPath), so Linux CI and Windows give the same answer; a drive-letter
    path is refused on Linux, not read as a relative path inside the repository (hosted CI, 2026-11-23)."""
    ok = ["docs/weather-program/gates/served-wave-skill-v1-locked.json", "a.json", "docs/./x.json"]
    bad = ["", "/x.json", "C:/x.json", "c:x.json", "//host/share/x", r"\\host\share\x", r"a\b.json", "../x.json",
           "docs/../../x.json", "docs/../x.json"]
    assert all(bh._inside_repo_relative(p) for p in ok)
    assert not any(bh._inside_repo_relative(p) for p in bad)


def test_an_absolute_path_outside_the_repo_quarantines(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "locked.json"      # a REAL file outside the repository root
    outside.write_text("{}", encoding="utf-8")
    _root(root, locked=["SYN99"])
    doc = json.loads((root / bh.BUOY_LIST).read_text(encoding="utf-8"))
    doc["holdout"]["locked_list"]["path"] = outside.as_posix()
    (root / bh.BUOY_LIST).write_text(json.dumps(doc), encoding="utf-8")
    st = bh.state()
    assert st["status"] == "quarantine" and "inside the repository" in st["reason"]


def test_strict_scorer_wrapper_uses_the_same_verification(root):
    doc = _root(root, locked=["SYN99"])
    status, info = strict.state(doc, root)
    assert status == strict.READY and info["locked"] == {"SYN99"}
    bad = _root(root, locked=["SYN99"], sha="f" * 64)
    status, info = strict.state(bad, root)
    assert status == strict.NOT_READ and info["error"] is True
    assert strict.HoldoutError is bh.HoldoutError


def test_collectors_are_declared_not_silent():
    assert bh.declare_collector("x.y", "archives raw truth") == "archives raw truth"


def _encode(text, times):
    from urllib.parse import quote
    for _ in range(times):
        text = quote(text, safe="")
    return text


@pytest.mark.parametrize("times", [1, 2, 3, 4, 5])
def test_allow_url_refuses_a_locked_id_under_any_encoding_depth(root, times):
    """Advisor, #1257: '%25252246225%252522' decoded a FIXED two times leaves '%2246225%22', whose digit-ending escape
    defeated the id boundary, so the URL was ALLOWED. Decoding now repeats until the text stops changing."""
    _root(root, locked=["100"])
    base = "https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station,time&station="
    assert not bh.allow_url(base + _encode('"46225"', times))
    assert bh.allow_url(base + _encode('"46025"', times))           # an open id at the same depth still passes


def test_allow_url_fails_closed_when_escapes_survive_the_bound(root):
    _root(root, locked=["100"])
    base = "https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station="
    assert not bh.allow_url(base + _encode('"46225"', bh._MAX_DECODE + 2))
    assert not bh.allow_url(base + _encode('"46025"', bh._MAX_DECODE + 2))   # undecodable: refused, never guessed open


@pytest.mark.parametrize("url", [
    "https://x/erddap/tabledap/cwwcNDBCMet.csv?station%3d%2246225%22",          # lower-case hex
    "https://x/erddap/tabledap/cwwcNDBCMet.csv?q=%2a46225%2A",                   # %2a / %2A mixed
    "https://www.ndbc.noaa.gov/data/realtime2/%34%36%32%32%35.txt",              # the id itself, digit by digit
    "https://www.ndbc.noaa.gov/data/realtime2/%2534%2536%2532%2532%2535.txt",    # ... and double-encoded
])
def test_allow_url_refuses_mixed_case_and_per_character_encodings(root, url):
    _root(root, locked=["100"])
    assert not bh.allow_url(url)
