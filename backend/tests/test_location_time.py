"""location_time phase 1: the contract of `describe()` on a synthetic grid in the real file format.

Pins: civil / coast_snap / nautical provenance, integer UTC offsets computed for the REQUESTED INSTANT (DST gaps and
repeats, 30- and 45-minute zones, local date rollover across the dateline), tie fields, and the failure reasons -
invalid coordinate, grid missing, grid corrupt, unknown zone - none of which may fall back to a solar guess. Kill:
env LOCATION_TIME_FIELD=0 and the runtime manifest 'off' both make describe() return None (callers then behave as before).
"""
import json
import math
import os
from datetime import datetime, timezone

import pytest

from services import runtime_flags as rf
from services.weather_pipeline import location_time as lt
from tests.location_time_testgrid import write_grid


def U(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


@pytest.fixture()
def grid(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1")                     # ships dark: tests switch it on
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    d = write_grid(str(tmp_path / "g"))
    yield d
    lt.reset_for_tests()
    rf._reset_for_tests()


def test_civil_cell_answers_the_iana_zone_with_an_integer_offset_for_the_instant(grid):
    r = lt.describe(21.3, -157.8, U("2026-11-10T18:00:00Z"), data_dir=grid)
    assert r["iana"] == "Pacific/Honolulu" and r["source"] == "civil"
    assert r["utc_offset_min"] == -600 and isinstance(r["utc_offset_min"], int)
    assert r["local_date"] == "2026-11-10" and r["local_time"] == "2026-11-10T08:00:00-1000"
    assert r["at"] == "2026-11-10T18:00:00Z" and r["coast_km_band"] is None and r["near_border"] is False


@pytest.mark.parametrize("lat,lng,at,want", [
    (-31.5, 159.5, "2026-04-04T14:45:00Z", 660),   # Lord Howe, before the 30-minute fall-back
    (-31.5, 159.5, "2026-04-04T15:15:00Z", 630),   # ...the repeated half hour, after it
    (-31.5, 159.5, "2026-10-03T15:45:00Z", 660),   # ...after the 30-minute spring-forward gap
    (-43.5, -176.5, "2026-04-04T13:59:00Z", 825),  # Chatham +12:45 -> +13:45 boundary
    (-43.5, -176.5, "2026-04-04T14:00:00Z", 765),
    (27.5, 85.5, "2026-07-15T12:00:00Z", 345),     # Kathmandu +05:45
    (40.5, -73.5, "2026-11-01T05:30:00Z", -240),   # New York, first 01:30 (EDT) - the naive utcoffset() read gives -300
    (40.5, -73.5, "2026-11-01T06:30:00Z", -300),   # ...repeated 01:30 (EST)
    (38.5, -9.5, "2026-03-29T00:59:00Z", 0),       # Lisbon, just before the gap
    (38.5, -9.5, "2026-03-29T01:00:00Z", 60),      # ...01:00Z is 02:00 WEST
])
def test_offsets_are_computed_for_the_instant_across_dst_gaps_and_repeats(grid, lat, lng, at, want):
    assert lt.describe(lat, lng, U(at), data_dir=grid)["utc_offset_min"] == want


def test_local_date_rolls_over_across_the_dateline(grid):
    at = U("2026-11-10T10:30:00Z")
    apia = lt.describe(-13.5, -171.5, at, data_dir=grid)
    pago = lt.describe(-14.5, -170.5, at, data_dir=grid)
    assert apia["iana"] == "Pacific/Apia" and pago["iana"] == "Pacific/Pago_Pago"
    assert (apia["local_date"], pago["local_date"]) == ("2026-11-10", "2026-11-09")
    assert apia["utc_offset_min"] - pago["utc_offset_min"] == 24 * 60


def test_both_sides_of_the_antimeridian_and_the_poles_answer(grid):
    assert lt.describe(-16.5, 179.99, data_dir=grid)["iana"] == "Pacific/Fiji"
    assert lt.describe(-16.5, -179.99, data_dir=grid)["iana"] == "Pacific/Fiji"
    for lat, lng in ((90.0, 0.0), (-90.0, 0.0), (0.0, 180.0), (0.0, -180.0)):
        assert lt.describe(lat, lng, data_dir=grid)["iana"]


def test_coast_snap_carries_its_band_and_a_tie_carries_the_other_zone(grid):
    snap = lt.describe(20.5, -157.5, U("2026-11-10T18:00:00Z"), data_dir=grid)
    assert snap["source"] == "coast_snap" and snap["coast_km_band"] == [20, 30] and snap["near_border"] is False
    tie = lt.describe(-28.5, 153.5, U("2026-01-15T00:00:00Z"), data_dir=grid)
    assert tie["iana"] == "Australia/Brisbane" and tie["near_border"] is True and tie["alt_iana"] == "Australia/Sydney"
    assert (tie["utc_offset_min"], tie["alt_utc_offset_min"]) == (600, 660)   # QLD has no DST; NSW does in January


def test_open_ocean_is_nautical_and_says_so(grid):
    r = lt.describe(0.5, -150.5, U("2026-11-10T00:00:00Z"), data_dir=grid)
    assert r["source"] == "nautical" and r["iana"] == "Etc/GMT+10" and r["utc_offset_min"] == -600


@pytest.mark.parametrize("lat,lng", [(91, 0), (-90.01, 0), (0, 180.5), (math.nan, 0), (0, math.inf), ("x", 0), (None, 1)])
def test_an_invalid_coordinate_is_a_reason_not_a_guess(grid, lat, lng):
    r = lt.describe(lat, lng, data_dir=grid)
    assert r["iana"] is None and r["reason"] == "invalid_coordinate" and "utc_offset_min" not in r


def test_a_missing_grid_is_a_reason(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1")
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    r = lt.describe(21.3, -157.8, data_dir=str(tmp_path / "nowhere"))
    assert r["iana"] is None and r["reason"] == "grid_unavailable"
    lt.reset_for_tests()


def test_a_corrupt_grid_fails_its_checksum_and_is_never_read(grid):
    with open(os.path.join(grid, "ids.npy"), "ab") as fh:
        fh.write(b"tampered")
    lt.reset_for_tests()
    r = lt.describe(21.3, -157.8, data_dir=grid)
    assert r["iana"] is None and r["reason"] == "grid_corrupt"


def test_a_manifest_that_is_not_json_is_corrupt(grid):
    with open(os.path.join(grid, "manifest.json"), "w") as fh:
        fh.write("{nope")
    lt.reset_for_tests()
    assert lt.describe(21.3, -157.8, data_dir=grid)["reason"] == "grid_corrupt"


def test_an_unknown_zone_is_a_reason(grid):
    r = lt.describe(10.5, 10.5, data_dir=grid)
    assert r["iana"] is None and r["reason"] == "unknown_zone" and r["zone"] == "Not/AZone"


def test_env_kill_switch_returns_none(grid, monkeypatch):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "0")
    assert lt.describe(21.3, -157.8, data_dir=grid) is None


def test_it_ships_dark_and_the_runtime_manifest_switches_it_both_ways_without_a_deploy(grid, monkeypatch):
    monkeypatch.delenv("LOCATION_TIME_FIELD", raising=False)              # env unset: as on Render
    rf._reset_for_tests(lambda: None)
    assert lt.CODE_DEFAULT == "0" and lt.describe(21.3, -157.8, data_dir=grid) is None

    def doc(state):
        e = {"state": state, "reason": "t", "set_by": "owner", "set_at": "2026-11-10T00:00:00Z", "evidence": "x"}
        return {"schema": rf.SCHEMA, "flags": {"LOCATION_TIME_FIELD": e}}
    rf._reset_for_tests(lambda: doc("on"))
    assert lt.describe(21.3, -157.8, data_dir=grid)["iana"] == "Pacific/Honolulu"
    rf._reset_for_tests(lambda: doc("off"))
    assert lt.describe(21.3, -157.8, data_dir=grid) is None


def test_civil_day_bounds_cover_23_and_25_hour_days():
    from datetime import date
    s, e = lt.civil_day_bounds(date(2026, 3, 8), "America/New_York")
    assert (e - s).total_seconds() == 23 * 3600
    s, e = lt.civil_day_bounds(date(2026, 11, 1), "America/New_York")
    assert (e - s).total_seconds() == 25 * 3600


def test_the_shipped_grid_verifies_and_answers_known_places():
    """The committed data file itself: checksum, and a handful of places whose zone is not in doubt."""
    lt.reset_for_tests()
    manifest = json.load(open(os.path.join(lt.DATA_DIR, "manifest.json"), encoding="utf-8"))
    assert manifest["res_deg"] == 0.01 and manifest["inputs"]["timezone_boundaries"]["data_version"]
    assert manifest["schema"] == lt.FORMAT and set(manifest["files"]) == set(lt.FILES)
    for (lat, lng), want in {(21.30, -157.85): "Pacific/Honolulu", (36.14, -5.35): "Europe/Gibraltar",
                             (35.78, -5.81): "Africa/Casablanca", (-31.55, 159.08): "Australia/Lord_Howe",
                             (27.70, 85.32): "Asia/Kathmandu", (-13.83, -171.76): "Pacific/Apia",
                             (-14.28, -170.70): "Pacific/Pago_Pago", (40.71, -74.0): "America/New_York"}.items():
        cell = lt.lookup(lat, lng)
        assert cell is not None and cell["iana"] == want, (lat, lng, cell)
    lt.reset_for_tests()


# -- reviewer fixes (2026-11-10) ------------------------------------------------------------------------------
def _rewrite(d, **change):
    """Rewrite a grid with some arrays changed, through the real writer: hashes valid, structure not."""
    import numpy as np
    arr = {k: np.load(os.path.join(d, k + ".npy")) for k in lt.ARRAYS}
    classes = json.load(open(os.path.join(d, "classes.json"), encoding="utf-8"))
    arr.update(change)
    lt.reset_for_tests()
    lt.write_grid_dir(d, arr["row_ptr"], arr["starts"], arr["ids"], classes, 1.0)


def test_a_grid_that_matches_its_checksum_but_is_malformed_is_corrupt(tmp_path, monkeypatch):
    """A grid can hash correctly and still be broken (truncated `ids`, a row that does not start at column 0): the
    structure check and the per-lookup bounds make that a reason, not an IndexError and not a neighbour's zone."""
    import numpy as np
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1")
    rf._reset_for_tests(lambda: None)
    d = write_grid(str(tmp_path / "g"))
    ids = np.load(os.path.join(d, "ids.npy"))
    _rewrite(d, ids=ids[:-3])
    assert lt.describe(21.3, -157.8, data_dir=d)["reason"] == "grid_corrupt"
    d2 = write_grid(str(tmp_path / "g2"))
    starts = np.load(os.path.join(d2, "starts.npy")).copy()
    row_ptr = np.load(os.path.join(d2, "row_ptr.npy"))
    starts[row_ptr[111]] = 5                                             # row 111 (lat 21) no longer starts at 0
    _rewrite(d2, starts=starts)
    assert lt.describe(21.3, -179.9, data_dir=d2)["reason"] == "grid_corrupt"
    lt.reset_for_tests()
    rf._reset_for_tests()


def test_a_failed_load_is_retried_after_the_backoff(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1")
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    d = str(tmp_path / "late")
    assert lt.describe(21.3, -157.8, data_dir=d)["reason"] == "grid_unavailable"
    write_grid(d)                                                        # the file appears (e.g. a slow volume)
    assert lt.describe(21.3, -157.8, data_dir=d)["reason"] == "grid_unavailable"      # inside the backoff: cached
    monkeypatch.setattr(lt, "RETRY_S", 0.0)
    assert lt.describe(21.3, -157.8, data_dir=d)["iana"] == "Pacific/Honolulu"
    lt.reset_for_tests()
    rf._reset_for_tests()


def test_concurrent_first_lookups_all_see_the_grid(grid):
    """The first load publishes state only when complete; a caller arriving mid-load waits on the lock instead of
    reading a half-set state as 'grid_unavailable' (reviewer probe, 2026-11-10)."""
    from concurrent.futures import ThreadPoolExecutor
    lt.reset_for_tests()
    with ThreadPoolExecutor(16) as ex:
        got = list(ex.map(lambda _: lt.describe(21.3, -157.8, data_dir=grid)["iana"], range(64)))
    assert set(got) == {"Pacific/Honolulu"}


def test_the_shipped_grid_stays_under_the_memory_cap():
    """Owner/Codex gate: <= 8 MB in-process. The arrays are memory-mapped read-only, so loading adds almost nothing to
    RSS; measured 2026-11-10 inside the real app: +0.04 MB at load, +3.2 MB of clean file pages after 20,000 scattered
    lookups (the compressed npz this replaced cost +8.1 MB RSS). Pinned here: mapped, not copied, and the bytes the
    load itself allocates stay far under the cap."""
    import gc
    import tracemalloc
    import numpy as np
    lt.reset_for_tests()
    gc.collect()
    tracemalloc.start()
    g = lt._load()
    gc.collect()
    retained, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert g is not None and isinstance(g["starts"], np.memmap) and isinstance(g["ids"], np.memmap)
    assert g["ids"].dtype.itemsize == 2
    assert retained < 2 * 2**20 and peak < lt.MEM_CAP_BYTES, (retained, peak)
    lt.reset_for_tests()


def test_a_class_id_beyond_the_table_is_a_reason_not_a_zone(tmp_path, monkeypatch):
    """An id past the class table (e.g. a wrapped uint16) must never read as some other real zone."""
    import numpy as np
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1")
    rf._reset_for_tests(lambda: None)
    d = write_grid(str(tmp_path / "g"))
    ids = np.load(os.path.join(d, "ids.npy")).copy()
    row_ptr = np.load(os.path.join(d, "row_ptr.npy"))
    ids[row_ptr[111]:row_ptr[112]] = 60000                              # every run of row 111 (lat 21)
    _rewrite(d, ids=ids)
    assert lt.describe(21.3, -157.8, data_dir=d)["reason"] == "grid_corrupt"
    lt.reset_for_tests()
    rf._reset_for_tests()


def test_warm_loads_the_grid_off_the_event_loop(grid):
    import asyncio
    import threading
    lt.reset_for_tests()
    seen = {}
    real = lt._load

    def spy(data_dir=None):
        seen["thread"] = threading.current_thread() is threading.main_thread()
        return real(data_dir)
    lt._load = spy
    try:
        asyncio.run(lt.warm(grid))
    finally:
        lt._load = real
    assert seen["thread"] is False and lt.is_loaded(grid)
    lt.reset_for_tests()
