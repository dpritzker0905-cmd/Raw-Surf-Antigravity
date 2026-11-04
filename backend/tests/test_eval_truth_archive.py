"""Historical truth: NDBC's QC'd archive and CDIP's archived deployments become the SAME observation rows the realtime
readers produce, so a 2024/2025 window grades like a recent one. Parity rows are real 46025 records (NOAA, public)."""
import gzip
from datetime import datetime, timezone

from services.weather_pipeline import eval_provenance as pv
from services.weather_pipeline import eval_reference as rf

HEAD = ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS  TIDE\n"
        "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec deg    hPa  degC  degC  degC  nmi    ft\n")
# 46025, 2026-09-25: the QC'd monthly archive (data/stdmet/Sep/46025.txt) and realtime2 for the same hour.
ARCHIVE = HEAD + (
    "2026 09 25 12 00 305  3.7  5.0 99.00 99.00 99.00 999 1013.0  19.8  22.1  18.7 99.0 99.00\n"
    "2026 09 25 12 10 279  3.7  4.9  0.94 12.90  7.84 200 1013.0  19.8  22.1  18.7 99.0 99.00\n"
    "2026 09 25 12 40 283  2.3  3.8  0.85 13.79  7.41 207 1012.9  19.6  22.2  18.6 99.0 99.00\n")
REALTIME = ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n"
            "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n"
            "2026 09 25 12 50 280  2.0  3.0   0.8    14   7.4 207 1012.8  19.6  22.2  18.6   MM   MM    MM\n"
            "2026 09 25 12 20 280  4.0  5.0   0.9    13   7.8 200 1012.9  19.8  22.2  18.8   MM   MM    MM\n")
T = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731


def test_archive_sentinels_are_missing_not_values():
    obs = rf.parse_ndbc_historical(ARCHIVE)
    first = obs[0]
    assert first["hs_m"] is None and first["tp_s"] is None and first["dp_deg"] is None and first["qc"] == "missing"
    assert obs[1]["hs_m"] == 0.94 and obs[1]["qc"] == rf.QC_GOOD


def test_archive_matches_realtime_on_the_same_records():
    arch = {o["time"]: o for o in rf.parse_ndbc_historical(ARCHIVE) if o["hs_m"] is not None}
    rt = {o["time"]: o for o in rf.parse_ndbc_stdmet(REALTIME)}
    common = sorted(set(arch) & set(rt))
    assert common == [T(2026, 9, 25, 12, 20), T(2026, 9, 25, 12, 50)]     # archive +10 min = realtime stamp
    for t in common:
        assert abs(arch[t]["hs_m"] - rt[t]["hs_m"]) <= 0.05 + 1e-9         # realtime publishes 0.1 m
        assert arch[t]["dp_deg"] == rt[t]["dp_deg"]


def test_catalog_lists_deployments():
    xml = '<dataset name="153p1_d05.nc"/><dataset name="153p1_d06.nc"/><dataset name="153p1_historic.nc"/>'
    assert rf.parse_cdip_catalog(xml, "153p1") == ["153p1_d05", "153p1_d06"]


def test_needs_archive_only_for_old_uncovered_windows():
    now = T(2026, 11, 4)
    rt = [{"time": T(2026, 9, 20)}]
    assert rf.needs_archive(rt, (T(2025, 10, 1), T(2025, 10, 28)), now) is True
    assert rf.needs_archive(rt, (T(2026, 10, 1), T(2026, 10, 28)), now) is False      # realtime reaches it
    assert rf.needs_archive([], (T(2026, 10, 20), T(2026, 10, 30)), now) is False      # too recent for an archive


def test_merge_keeps_realtime_and_fills_only_before_it():
    rt = [{"time": T(2025, 1, 2), "src": "rt"}]
    arch = [{"time": T(2025, 1, 1), "src": "a"}, {"time": T(2025, 1, 2), "src": "a"}]
    assert [o["src"] for o in rf.merge_archive(rt, arch)] == ["a", "rt"]


DAS = ('String cdip_deployment_id "153p1_d06";\nString id "CDIP_153p1_20240923-20250812";\n'
       'String time_coverage_start "2024-09-23T22:00:00Z";\nString time_coverage_end "2025-08-12T17:59:59Z";\n')
DAS_OLD = DAS.replace("2024-09-23", "2020-01-01").replace("2025-08-12", "2020-06-01").replace("d06", "d01")
ASCII = ("Dataset {\n} x;\n---------------------------------------------\n"
         "waveTime[2]\n1733011200, 1733013000\n\nwaveHs[2]\n1.2, 1.3\n\nwaveTp[2]\n14.3, 15.4\n\n"
         "waveDp[2]\n270.0, 271.0\n\nwaveFlagPrimary[2]\n1, 4\n")


def _get(url, rng=None, max_bytes=None):
    if url.endswith("catalog.xml"):
        return b'<dataset name="153p1_d01.nc"/><dataset name="153p1_d06.nc"/>', 200
    if url.endswith(".das"):
        return (DAS_OLD if "_d01" in url else DAS).encode(), 200
    if "_d01" in url:
        raise AssertionError("a deployment outside the window must not be downloaded")
    return ASCII.encode(), 200


def test_cdip_archive_reads_only_overlapping_deployments(tmp_path):
    cache = pv.Cache(str(tmp_path), get=_get, pause_s=0.0)
    obs, recs, versions = rf.fetch_cdip_archive(cache, "153p1", (T(2024, 12, 1), T(2024, 12, 28)))
    assert versions == ["cdip:153p1_d06:CDIP_153p1_20240923-20250812"]
    assert [o["qc"] for o in obs] == ["good", "bad"] and obs[0]["hs_m"] == 1.2
    assert all(r["cache_file"].replace("\\", "/").startswith("truth/cdip/153p1/") for r in recs)


def test_ndbc_archive_yearly_gz_and_unpublished_months_counted(tmp_path):
    def get(url, rng=None, max_bytes=None):
        if url.endswith("46025h2025.txt.gz"):
            return gzip.compress(ARCHIVE.replace("2026 09", "2025 10").encode()), 200
        raise OSError("404")
    cache = pv.Cache(str(tmp_path), get=get, pause_s=0.0)
    obs, _, files, missing = rf.fetch_ndbc_archive(cache, "46025", (T(2025, 10, 1), T(2026, 1, 31)), now=T(2026, 3, 1))
    assert files == ["truth/ndbc/46025/h2025.txt.gz"] and len(obs) == 3
    assert len(missing) == 1 and "/Jan/46025.txt" in missing[0]
