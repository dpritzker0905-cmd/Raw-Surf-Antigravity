"""The startup-hygiene purge for ICON wind AUTH products (2026-07-30, the "blank day" family).

The old rule deleted every non-estimated ICON wind product with valid_time > NOW+120h. Both halves
were wrong: the DWD-direct path delivers real natives to run+180h (120h was the open-meteo path's
figure), so the FIRST restore after every ingest destroyed the last ~60h of real data; and the
wall-clock cutoff made survival depend on when a box restarted, not on what the model produced.
Net live state: natives ended near now+120h while the estimated tail stayed anchored at the old
run+181h — a 46h mid-timeline dead hole, 13 lattice slots with nothing within 3h (the user-visible
blank day).

The rule is now RUN-relative: purge only products claiming more forecast than the model natively
produces from their own run (+6h slack)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from services.weather_pipeline.store_helpers import icon_wind_overclaims_native_horizon

RUN = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)
HORIZON_H = 180.0


def _p(model="ICON", domain="wind", layer="wind", is_estimated=False,
       run_time=RUN, valid_hours_after_run=0.0):
    return SimpleNamespace(
        model=model, domain=domain, layer=layer, is_estimated=is_estimated,
        run_time=run_time,
        valid_time_start=(run_time or RUN) + timedelta(hours=valid_hours_after_run),
    )


def test_real_dwd_native_at_run_plus_150h_survives():
    """Re-enacts the defect: a fresh DWD native at run+150h was purged the moment it was restored
    (old rule: valid > now+120h with now ≈ run). It is real model output and must survive."""
    now = RUN  # fresh ingest — the exact condition under which the old rule destroyed real data
    assert icon_wind_overclaims_native_horizon(_p(valid_hours_after_run=150), now, HORIZON_H) is False


def test_native_at_run_plus_180h_survives_regardless_of_wall_clock():
    """The wall-clock defect: under the old rule the same product flipped from kept to purged as
    `now` advanced. Run-relative must be time-invariant."""
    p = _p(valid_hours_after_run=180)
    for hours_later in (0, 24, 48, 96):
        now = RUN + timedelta(hours=hours_later)
        assert icon_wind_overclaims_native_horizon(p, now, HORIZON_H) is False


def test_cyclic_fill_leftover_at_run_plus_300h_is_purged():
    """The original defect class the hygiene exists for: fabricated data mislabeled AUTH out to
    +336h. Still caught."""
    assert icon_wind_overclaims_native_horizon(_p(valid_hours_after_run=300), RUN, HORIZON_H) is True


def test_estimated_tail_is_never_purged():
    assert icon_wind_overclaims_native_horizon(
        _p(is_estimated=True, valid_hours_after_run=300), RUN, HORIZON_H) is False


def test_missing_run_time_falls_back_to_wall_clock_leniently():
    now = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
    near = SimpleNamespace(model="ICON", domain="wind", layer="wind", is_estimated=False,
                           run_time=None, valid_time_start=now + timedelta(hours=100))
    far = SimpleNamespace(model="ICON", domain="wind", layer="wind", is_estimated=False,
                          run_time=None, valid_time_start=now + timedelta(hours=300))
    assert icon_wind_overclaims_native_horizon(near, now, HORIZON_H) is False
    assert icon_wind_overclaims_native_horizon(far, now, HORIZON_H) is True


def test_other_lanes_are_untouched():
    for model, domain, layer in (("EURO", "wind", "wind"), ("ICON", "marine", "waves"),
                                 ("GFS", "wind", "wind")):
        p = _p(model=model, domain=domain, layer=layer, valid_hours_after_run=999)
        assert icon_wind_overclaims_native_horizon(p, RUN, HORIZON_H) is False


def test_naive_datetimes_are_coerced_not_crashed():
    p = SimpleNamespace(model="ICON", domain="wind", layer="wind", is_estimated=False,
                        run_time=RUN.replace(tzinfo=None),
                        valid_time_start=(RUN + timedelta(hours=150)).replace(tzinfo=None))
    assert icon_wind_overclaims_native_horizon(p, RUN, HORIZON_H) is False
