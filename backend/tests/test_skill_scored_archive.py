"""Where the skill ledger's scored rows live: one object per UTC day from 2026-10, the monthly object before.

★ WHY THIS EXISTS (2026-10-16). `calibration/skill/scored-2026-10.json` was ONE object re-uploaded whole by every
pass. It reached 52,404,041 B against Supabase Storage's 50 MiB (52,428,800 B) object limit, and from 2026-10-13
16:47Z 49 of 57 passes failed `HTTP 400 {"statusCode":"413","code":"EntityTooLarge"}`. Each failure skipped the
whole ledger, so the new forecasts of that pass were never recorded. The monitor was right to page; nothing
bounded the object. These tests pin the shape that does: a day's object is ~4 MB, so no month can reach the limit.

Pure unit tests: no network, no storage fake. The ledger and the monitor are exercised against this module in
`test_forecast_skill_retention.py` and `test_forecast_accuracy_monitor.py`.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

PREFIX = "calibration/skill/scored-"


def _sa():
    # Imported inside each test so a missing module FAILS the test (not the collection of the file).
    from services.weather_pipeline import skill_scored_archive
    return skill_scored_archive


def _utc(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


# ---- where a scored row is written --------------------------------------------------------------

def test_rows_before_october_keep_the_monthly_key():
    # August and September are frozen monthly objects that other readers (MOS history, the monitor's month
    # seam) still open by that name; moving them would orphan 47 MB + 34 MB of verification history.
    assert _sa().key_for_target(_utc(2026, 9, 30, 23)) == PREFIX + "2026-09.json"


def test_rows_from_october_go_to_one_object_per_utc_day():
    assert _sa().key_for_target(_utc(2026, 10, 16, 13)) == PREFIX + "2026-10-16.json"


def test_the_day_is_the_utc_day_not_the_senders_local_day():
    local = datetime(2026, 10, 16, 23, 30, tzinfo=timezone(timedelta(hours=-5)))   # 2026-10-17 04:30Z
    assert _sa().key_for_target(local) == PREFIX + "2026-10-17.json"


def test_the_switch_is_a_month_not_a_day():
    # 2026-10-01 00:00Z is the first segmented instant; the second before it is still September's object.
    sa = _sa()
    assert sa.key_for_target(_utc(2026, 10, 1, 0, 0)) == PREFIX + "2026-10-01.json"
    assert sa.key_for_target(_utc(2026, 9, 30, 23, 59)) == PREFIX + "2026-09.json"


def test_a_day_key_names_the_frozen_monthly_object_that_sits_beside_it():
    # The ledger dedupes a day's rows against the month's frozen object as well as against the day's own.
    sa = _sa()
    assert sa.month_object_of(PREFIX + "2026-10-16.json") == PREFIX + "2026-10.json"
    assert sa.month_object_of(PREFIX + "2026-10.json") is None             # a monthly key has no other object


# ---- which objects can hold a month's rows ------------------------------------------------------

def test_a_month_before_the_switch_reads_only_its_monthly_object():
    # A pre-switch month must NOT probe 30 day keys that cannot exist: every probe is a round trip.
    assert _sa().keys_for_month("2026-09", date(2026, 10, 16)) == [PREFIX + "2026-09.json"]


def test_a_segmented_month_reads_its_monthly_object_then_each_day_through_the_given_date():
    keys = _sa().keys_for_month("2026-10", date(2026, 10, 3))
    assert keys == [PREFIX + "2026-10.json", PREFIX + "2026-10-01.json",
                    PREFIX + "2026-10-02.json", PREFIX + "2026-10-03.json"]


def test_a_finished_month_reads_every_day_of_it_and_no_more():
    keys = _sa().keys_for_month("2027-02", date(2027, 6, 1))
    assert len(keys) == 1 + 28                                     # monthly object + the 28 days of Feb 2027
    assert keys[-1] == PREFIX + "2027-02-28.json"


def test_a_month_that_has_not_started_reads_nothing_but_its_monthly_object():
    assert _sa().keys_for_month("2026-11", date(2026, 10, 31)) == [PREFIX + "2026-11.json"]


# ---- reading a month back -----------------------------------------------------------------------

def _loader(store, calls=None):
    def load(key):
        if calls is not None:
            calls.append(key)
        return (list(store[key]), True) if key in store else ([], False)
    return load


def test_read_month_returns_the_monthly_object_then_each_day_in_date_order():
    store = {PREFIX + "2026-10.json": [{"id": "legacy"}],
             PREFIX + "2026-10-02.json": [{"id": "d2"}],
             PREFIX + "2026-10-01.json": [{"id": "d1"}]}
    rows, exists = _sa().read_month("2026-10", date(2026, 10, 3), _loader(store))
    assert [r["id"] for r in rows] == ["legacy", "d1", "d2"]
    assert exists is True


def test_read_month_says_nothing_was_stored_when_every_object_is_absent():
    rows, exists = _sa().read_month("2026-11", date(2026, 11, 3), _loader({}))
    assert rows == [] and exists is False


def test_read_month_uses_the_rows_a_pass_just_wrote_instead_of_reading_them_back():
    key = PREFIX + "2026-10-02.json"
    calls = []
    rows, _ = _sa().read_month("2026-10", date(2026, 10, 2), _loader({PREFIX + "2026-10.json": []}, calls),
                               override={key: [{"id": "fresh"}]})
    assert [r["id"] for r in rows] == ["fresh"]
    assert key not in calls


def test_an_unreadable_part_is_never_read_as_an_empty_one():
    # The ledger's strict reader raises for anything that is not "absent". read_month must let that through:
    # a swallowed error here would score against a partial history and write it back as the whole.
    def load(key):
        if key.endswith("2026-10-02.json"):
            raise RuntimeError("synthetic unreadable segment")
        return [], False
    with pytest.raises(RuntimeError, match="unreadable segment"):
        _sa().read_month("2026-10", date(2026, 10, 3), load)
