"""NOAA GFS-Wave station bulletins (skill_noaa_bulletin): the independent same-model reference lane for D-072 v2.

The fixture is a real NOAA file (public data): station 41117, cycle 2026-11-15 00Z, from
noaa-gfs-bdp-pds/gfs.20261115/00/wave/station/bulls.t00z/gfswave.41117.bull.
"""
import ast
from datetime import datetime, timezone
from pathlib import Path

from services.weather_pipeline import skill_noaa_bulletin as B

FIXTURE = Path(__file__).parent / "fixtures" / "noaa_bull" / "gfswave.41117.20261115t00z.bull"
TEXT = FIXTURE.read_text(encoding="utf-8")
CYCLE = datetime(2026, 11, 15, 0, tzinfo=timezone.utc)

HEADER = """  Location : TEST1      (30.00N  81.08W)
  Model    : spectral resolution for points
  Cycle    : {cycle} UTC
 +-------+-----------+-----------------+
 | day & |  Hst  n x |    Hs   Tp  dir |
 |  hour |  (m)  - - |    (m)  (s) (d) |
 +-------+-----------+-----------------+
"""


def test_the_real_41117_file_parses():
    p = B.parse_bulletin(TEXT)
    assert p["station"] == "41117" and p["cycle"] == CYCLE
    assert len(p["rows"]) == 385                                  # hourly, +0 .. +384 h
    first = p["rows"][0]
    assert first["valid"] == CYCLE and first["lead_h"] == 0.0 and first["hst"] == 0.78 and first["n"] == 1
    assert first["parts"] == [{"hs": 0.76, "tp": 4.8, "dir": 193, "wind_sea": True}]
    two = p["rows"][8]                                            # | 15  8 | 0.66  2   |   0.60  4.9 207 |   0.25  6.5 224 |
    assert two["n"] == 2 and [q["hs"] for q in two["parts"]] == [0.60, 0.25] and not two["parts"][0]["wind_sea"]
    assert all(r["n"] == len(r["parts"]) for r in p["rows"])      # every partition the row counts was read


def test_month_rollover_in_the_real_file():
    last = B.parse_bulletin(TEXT)["rows"][-1]                     # | 1  0 |: Nov 30 -> Dec 1
    assert last["valid"] == datetime(2026, 12, 1, 0, tzinfo=timezone.utc) and last["lead_h"] == 384.0


def test_year_rollover():
    text = HEADER.format(cycle="20261231 18") + (" | 31 18 | 1.00  1   |   1.00  9.0 270 |\n"
                                                 " | 31 23 | 1.10  1   |   1.10  9.0 270 |\n"
                                                 " |  1  0 | 1.20  1   |   1.20  9.0 270 |\n")
    rows = B.parse_bulletin(text)["rows"]
    assert [r["valid"] for r in rows] == [datetime(2026, 12, 31, 18, tzinfo=timezone.utc),
                                         datetime(2026, 12, 31, 23, tzinfo=timezone.utc),
                                         datetime(2027, 1, 1, 0, tzinfo=timezone.utc)]
    assert [r["lead_h"] for r in rows] == [0.0, 5.0, 6.0]


def test_a_row_with_zero_partitions():
    text = HEADER.format(cycle="20261115  0") + " | 15  0 | 0.12  0 1 |                 |\n"
    r = B.parse_bulletin(text)["rows"][0]
    assert r["hst"] == 0.12 and r["n"] == 0 and r["x"] == 1 and r["parts"] == []
    out = B.fetch_bulletin_rows(["TEST1"], datetime(2026, 11, 15, 5, tzinfo=timezone.utc), leads_h=(-5,),
                                get=lambda url: text)
    assert out and out[0]["hs_m"] == 0.12 and out[0]["tp_s"] is None and out[0]["parts"] == []


def test_the_star_marks_a_wind_sea_partition():
    """The file's own legend: '*' = wave generation due to local wind probable. Kept as wind_sea, never dropped."""
    rows = B.parse_bulletin(TEXT)["rows"]
    flagged = [q for r in rows for q in r["parts"] if q["wind_sea"]]
    plain = [q for r in rows for q in r["parts"] if not q["wind_sea"]]
    assert flagged and plain
    assert "Wave generation due to local wind probable" in TEXT


def test_a_missing_file_gives_no_row_and_is_counted():
    stats = {}
    out = B.fetch_bulletin_rows(["46267"], datetime(2026, 11, 15, 6, tzinfo=timezone.utc), get=lambda url: None,
                                stats=stats)
    assert out == [] and stats["missing"] == 1 and stats["stations"] == 1


def test_an_s3_error_body_is_not_a_bulletin():
    assert B.parse_bulletin("<?xml version='1.0'?><Error><Code>NoSuchKey</Code></Error>") is None
    assert B.parse_bulletin("") is None


def test_the_previous_cycle_is_the_fallback():
    now = datetime(2026, 11, 15, 11, tzinfo=timezone.utc)          # newest published: 06Z; fallback: 00Z
    assert B.candidate_cycles(now) == [datetime(2026, 11, 15, 6, tzinfo=timezone.utc), CYCLE]
    stats = {}
    out = B.fetch_bulletin_rows(["41117"], now, get=lambda url: TEXT if "/00/" in url else None, stats=stats)
    assert stats["fallback_cycle"] == 1 and len(out) == 3 and all(r["cycle"] == "2026-11-15T00:00Z" for r in out)
    assert [r["cycle_lead_h"] for r in out] == [35.0, 59.0, 83.0]


def test_one_station_failing_never_costs_another_its_row():
    def get(url):
        if "gfswave.BAD." in url:
            raise OSError("connection reset")
        return TEXT
    stats = {}
    out = B.fetch_bulletin_rows(["BAD", "41117"], datetime(2026, 11, 15, 5, tzinfo=timezone.utc), get=get,
                                stats=stats)
    assert stats["errors"] == 1 and {r["buoy_id"] for r in out} == {"41117"} and len(out) == 3


def test_rows_carry_the_ledger_keys_and_provenance():
    now = datetime(2026, 11, 15, 5, 17, tzinfo=timezone.utc)
    out = B.fetch_bulletin_rows(["41117"], now, get=lambda url: TEXT)
    r = out[0]
    assert r["source"] == "noaa:gfswave_station" and r["buoy_id"] == "41117"
    assert r["target_time"] == "2026-11-16T05:00:00Z" and r["lead_h"] == 24.0 and r["cycle_lead_h"] == 29.0
    assert r["source_url"] == ("https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261115/00/wave/station/"
                               "bulls.t00z/gfswave.41117.bull")
    assert r["fetched_at"].endswith("Z") and r["tp_s"] == max(r["parts"], key=lambda q: q[0])[1]
    from services.weather_pipeline.forecast_skill import dedupe_key
    assert dedupe_key(r) == ("noaa:gfswave_station", "41117", "2026-11-16T05:00:00Z", 1)


def test_ten_keys_against_the_raw_file():
    """Row-level control: ten rows read back by fixed columns of the raw text, not by the parser's regexes."""
    raw = {}
    for line in TEXT.splitlines():
        if line.startswith(" | ") and line[3:5].strip().isdigit() and line[6:8].strip().isdigit():
            raw[(int(line[3:5]), int(line[6:8]))] = float(line[11:16])
    rows = {(r["valid"].day, r["valid"].hour): r["hst"] for r in B.parse_bulletin(TEXT)["rows"]}
    keys = [(15, 0), (15, 8), (15, 21), (16, 12), (17, 14), (19, 3), (20, 0), (23, 7), (30, 23), (1, 0)]
    for k in keys:
        assert rows[k] == raw[k], k


def test_the_lane_is_never_fed_by_our_own_chain():
    """A reference built from our sampler would agree with us by construction. The module may import only the
    standard library: no services.*, no sampler, resolver, grid, frame or store code."""
    tree = ast.parse(Path(B.__file__).read_text(encoding="utf-8"))
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            mods.add((node.module or "").split(".")[0])
    assert mods <= {"logging", "os", "re", "urllib", "datetime", "typing"}, mods
    assert B.BUCKET == "https://noaa-gfs-bdp-pds.s3.amazonaws.com"


def test_tests_never_fetch_live_bulletins():
    """conftest refuses the live fetch: a ledger test that forgets get= counts an error instead of hitting S3."""
    stats = {}
    assert B.fetch_bulletin_rows(["41117"], datetime(2026, 11, 15, 6, tzinfo=timezone.utc), stats=stats) == []
    assert stats["errors"] == 1


def test_ledger_rows_key_on_the_report_buoys_and_have_a_kill_switch(monkeypatch):
    report = {"spots": [{"buoy_id": "41117"}, {"buoy_id": "41117"}, {"buoy_id": None}]}
    seen = []
    monkeypatch.setattr(B, "_http_get", lambda url, timeout=20: seen.append(url) or TEXT)
    rows = B.ledger_rows(report, datetime(2026, 11, 15, 5, tzinfo=timezone.utc), (24, 48, 72))
    assert len(rows) == 3 and len(seen) == 1                     # one fetch per distinct buoy
    monkeypatch.setenv("FORECAST_SKILL_NOAA_BULL", "0")
    assert B.ledger_rows(report, datetime(2026, 11, 15, 5, tzinfo=timezone.utc), (24,)) == []
