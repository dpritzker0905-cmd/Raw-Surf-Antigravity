"""Bug hunt 2026-11-22, latent time items: every timestamp parser reads a naive time as UTC and converts an offset.

- `route_helpers.parse_valid_time` kept a non-UTC offset (so `10:00-08:00` was later stamped as 10:00Z) and returned
  a NAIVE datetime for a date-only input (the '-' in the date read as an offset sign).
- `frame_binary._epoch` and `frame_set.iso` read a naive timestamp as the HOST's local time (5 h off on an Eastern
  host; CI runs in UTC, so the tests below force a non-UTC zone where the platform allows it)."""
import calendar
import os
import sys
import time
from datetime import datetime, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from fastapi import HTTPException  # noqa: E402
from services import frame_binary as FB  # noqa: E402
from services import frame_set as FS  # noqa: E402
from services.weather_pipeline.route_helpers import parse_valid_time  # noqa: E402

UTC = timezone.utc


@pytest.fixture
def eastern_host(monkeypatch):
    """Make the process's local zone non-UTC where tzset exists (Linux CI); elsewhere the host zone is used as is."""
    if hasattr(time, "tzset"):
        monkeypatch.setenv("TZ", "America/New_York")
        time.tzset()
        yield
        monkeypatch.undo()
        time.tzset()
    else:
        yield


@pytest.mark.parametrize("raw, want", [
    ("2026-11-22T10:00:00Z", datetime(2026, 11, 22, 10, tzinfo=UTC)),
    ("2026-11-22T10:00:00", datetime(2026, 11, 22, 10, tzinfo=UTC)),
    ("2026-11-22T10:00:00+00:00", datetime(2026, 11, 22, 10, tzinfo=UTC)),
    ("2026-11-22T10:00:00-08:00", datetime(2026, 11, 22, 18, tzinfo=UTC)),
    ("2026-11-22T10:00:00+05:30", datetime(2026, 11, 22, 4, 30, tzinfo=UTC)),
    ("2026-11-22", datetime(2026, 11, 22, 0, tzinfo=UTC)),
])
def test_parse_valid_time_returns_aware_utc(raw, want):
    got = parse_valid_time(raw)
    assert got.tzinfo is not None and got.utcoffset().total_seconds() == 0, f"{raw!r} -> {got!r} is not UTC"
    assert got == want


def test_parse_valid_time_offset_is_stamped_as_its_utc_hour():
    """The bug's visible form: the parsed time formatted the way routes format it."""
    assert parse_valid_time("2026-11-22T10:00:00-08:00").strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-11-22T18:00:00Z"


def test_parse_valid_time_still_rejects_garbage():
    with pytest.raises(HTTPException):
        parse_valid_time("not-a-time")


def test_frame_binary_epoch_reads_naive_as_utc(eastern_host):
    want = calendar.timegm((2026, 11, 22, 10, 0, 0))
    assert FB._epoch("2026-11-22T10:00:00") == want
    assert FB._epoch("2026-11-22T10:00:00Z") == want
    assert FB._epoch("2026-11-22T05:00:00-05:00") == want


def test_frame_set_iso_reads_naive_as_utc(eastern_host):
    assert FS.iso("2026-11-22T10:00:00") == "2026-11-22T10:00:00Z"
    assert FS.iso("2026-11-22T10:00:00Z") == "2026-11-22T10:00:00Z"
    assert FS.iso("2026-11-22T05:00:00-05:00") == "2026-11-22T10:00:00Z"
