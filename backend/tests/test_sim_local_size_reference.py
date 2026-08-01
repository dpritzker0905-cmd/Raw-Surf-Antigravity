"""The sim's local size reference — and the I/O permission that guards it (2026-08-01).

`3263031c` flipped RATING_LOCAL_SIZE in all three serving lanes. The sim kept grading on the global
1.2 m curve because `reference_size_for` read only `spot["reference_size_m"]`, and `sim_spots`
carries that key for THREE hand-tuned mock spots out of ~1,776. The parity monitor caught it within
minutes of the flip (run 30683570880): sim HIGH by a median +22.2 points, 5 of 6 spots differing in
LEVEL. After the fix, 18 spots on 6 continents read 0 LEVEL differences, |dScore| max 0.6.

★★ The flag was never the missing thing — the DATA was. A flag and its data are two separate lanes,
   and mirroring the flag into the monitor (4d052f69) was necessary but not sufficient.

⚠️⚠️ `allow_reference_lookup` IS ITS OWN PARAMETER, and the first version wrongly reused `valid_time`
   for it. The lookup dials on a cold cache, so it must respect the ZERO-NETWORK INVARIANT — but
   `valid_time` is the OBSERVATION GATE's join key, and one parameter serving two concepts coupled
   them wherever only one was wanted:
     * `get_weather_forecast` has an hour and never passed it ⇒ the sim's primary user-facing tool
       would have stayed on the global curve while this probe read GREEN. A false green.
     * `sim_window` passing `valid_time` to obtain a reference ALSO switched on the gate, which
       caps at 69.9 and flattened the ranking it exists to produce — the winning hour moved
       09:00 -> 06:00, caught by test_sim_daylight.
   These tests pin BOTH halves: the lookup happens when permitted, and cannot when it is not.
"""
import os

import pytest

from services.weather_pipeline import sim_rating


@pytest.fixture
def local_size_on(monkeypatch):
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")


SPOT = {"id": "abc-123", "name": "Somewhere", "latitude": 1.0, "longitude": 2.0}


def test_the_flag_off_means_the_global_curve(monkeypatch):
    monkeypatch.setenv("RATING_LOCAL_SIZE", "0")
    assert sim_rating.reference_size_for({**SPOT, "reference_size_m": 2.5}, True) is None


def _patch_map(monkeypatch, fn):
    """Patch the TWO symbols reference_size_for composes.

    A fresh dict each call also exercises the object-identity memo: a new climatology object must
    rebuild the map rather than serve a stale one."""
    monkeypatch.setattr(
        "services.weather_pipeline.spot_size_climatology.load_size_climatology_l2_cached",
        lambda *a, **k: {"spots": {}})
    monkeypatch.setattr(
        "services.weather_pipeline.spot_size_climatology.reference_map",
        lambda clim, **k: _Mapping(fn))


class _Mapping(dict):
    """A lookup double. ★ MUST be truthy: `reference_size_for` does
    `reference_map(clim) or {}`, so an EMPTY dict subclass is falsy and gets replaced by a
    plain `{}` — which made three of these tests fail against correct code. A test double
    has to satisfy the same truthiness contract as the thing it stands in for."""
    def __init__(self, fn):
        super().__init__()
        self._fn = fn

    def __bool__(self):
        return True
    def get(self, key, default=None):
        v = self._fn(key)
        return default if v is None else v


def _recorder(monkeypatch, returns=None):
    """Records whether the lookup was reached, WITHOUT raising.

    ⚠️⚠️ A RAISING SPY CANNOT FAIL THIS CODE. `reference_size_for` wraps the lookup in a fail-open
    `except Exception`, and AssertionError IS an Exception — so a spy that raises is swallowed, the
    function returns None, and the assertion passes whether or not the lookup happened. Caught by
    mutation 2026-08-01: deleting the zero-network guard left both "did not dial" tests GREEN.
    ★ A negative control has to be observable through the code under test, not merely thrown at it.
    """
    calls = []
    _patch_map(monkeypatch, lambda sid: (calls.append(sid), returns)[1])
    return calls


def test_a_hand_tuned_default_still_wins_without_any_lookup(local_size_on, monkeypatch):
    """The three catalogue defaults must keep working, and must not trigger I/O to do it."""
    calls = _recorder(monkeypatch, returns=9.9)
    got = sim_rating.reference_size_for({**SPOT, "reference_size_m": 4.0}, True)
    assert got == 4.0
    assert calls == [], "looked up the blob when the spot already carried a reference"


def test_NO_permission_NO_lookup_because_that_is_the_zero_network_path(local_size_on, monkeypatch):
    """⛔ THE INVARIANT. `simulate_weather_change` with all five inputs and no hour does zero HTTP —
    the `576dcbdd` regression was 42.2 s of blocking, past where an MCP client reports a TIMEOUT
    instead of an answer. A reference lookup there would re-open it, so the absence of an hour must
    hard-stop the lookup rather than merely making it unlikely.

    The spy RETURNS a value rather than raising: if the guard is removed the lookup succeeds, the
    function returns 2.5 instead of None, and this fails on the value — a route the fail-open
    `except` cannot swallow."""
    calls = _recorder(monkeypatch, returns=2.5)
    assert sim_rating.reference_size_for(SPOT, False) is None
    assert calls == [], "dialled the climatology on the ZERO-NETWORK what-if path"


def test_an_hour_permits_the_lookup_and_the_reference_is_used(local_size_on, monkeypatch):
    _patch_map(monkeypatch, lambda sid: 2.33 if sid == "abc-123" else None)
    assert sim_rating.reference_size_for(SPOT, True) == pytest.approx(2.33)


def test_the_lookup_is_keyed_on_the_spot_id_the_glyph_uses(local_size_on, monkeypatch):
    """`reference_for_spot` IS `reference_map(load_size_climatology_l2_cached())` — the same two
    symbols spot_ratings composes for the glyph. Keying on anything else would be a second
    derivation and could disagree with the surface this is supposed to match."""
    seen = {}
    _patch_map(monkeypatch, lambda sid: seen.setdefault("id", sid) and None)
    sim_rating.reference_size_for(SPOT, True)
    assert seen["id"] == "abc-123"


def test_a_lookup_failure_falls_open_to_the_global_curve(local_size_on, monkeypatch):
    """A miss must never break the rating it decorates — falling open reproduces the pre-flip
    behaviour, which is a less local number, never a wrong one."""
    monkeypatch.setattr(
        "services.weather_pipeline.spot_size_climatology.load_size_climatology_l2_cached",
        lambda *a, **k: None)   # no blob -> global curve
    assert sim_rating.reference_size_for(SPOT, True) is None


def test_the_reference_actually_reaches_the_score(local_size_on, monkeypatch):
    """★ ATTACHMENT IS NOT CONSUMPTION. Resolving a reference proves nothing unless it changes the
    number — the recorded trap where a field was plumbed and never read. A 1.5 m day must score
    LOWER against a big-wave reference than against the global default."""
    _patch_map(monkeypatch, lambda _sid: 2.5)
    spot = {**SPOT, "orientation": 270.0}
    with_ref = sim_rating.calculate_surf_rating(spot, 1.5, 12.0, 270.0, 4.0, 270.0,
                                                allow_reference_lookup=True)
    without = sim_rating.calculate_surf_rating(spot, 1.5, 12.0, 270.0, 4.0, 270.0)
    assert with_ref["quality_rating"] < without["quality_rating"], (
        "the big-wave reference must penalise a small day; if these are equal the reference is "
        "being resolved and then ignored"
    )
