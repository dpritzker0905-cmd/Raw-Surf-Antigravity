"""Blind surf quality on an observation: the prerequisite of gates/surf-tide-v1.md section 0.

Proved over real HTTP + JWT against a real SQLite database (the observation route's own test world):
- the seven levels are surf_rating.LEVELS, in order, and the request model accepts exactly those;
- the flag SURF_TRUTH_BLIND_QUALITY ships DARK: with it off a submitted level is dropped (flag 'quality_off'), the
  height is still stored, and /features tells the app not to ask;
- with it on, a level is stored only on a blind screen (forecast_shown_before = false) AND with the app's explicit
  word that no forecast was shown this session; the spot page's report (a forecast is on screen) never stores one,
  nor does a client that says a forecast was shown or says nothing;
- no reward reads the level: the XP outcome is identical with and without it.
"""
import pytest

from routes.surf_data import observations
from services import blind_quality
from services.weather_pipeline import surf_rating
from tests.test_surf_observations import URL, _checkin, _token, world  # noqa: F401 - the observation route's world


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(blind_quality.FLAG, "1")


def test_the_levels_are_the_ratings_own_seven_in_order():
    assert list(blind_quality.LEVELS) == list(surf_rating.LEVELS)
    accepted = observations.ObservationIn.model_fields["quality_level"].annotation
    assert set(accepted.__args__[0].__args__) == set(surf_rating.LEVELS)   # Optional[Literal[...]]
    assert all(word and not any(ch.isdigit() for ch in word) for word in blind_quality.LEVEL_WORDS.values())


def test_the_flag_ships_dark(monkeypatch):
    monkeypatch.delenv(blind_quality.FLAG, raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    assert blind_quality.enabled() is False


async def test_features_say_off_by_default_and_list_the_words_when_on(world, monkeypatch):
    monkeypatch.delenv(blind_quality.FLAG, raising=False)
    off = (await world.client.get(URL + "/features")).json()
    assert off == {"blind_quality": False, "quality_version": None, "quality_levels": []}
    monkeypatch.setenv(blind_quality.FLAG, "1")
    on = (await world.client.get(URL + "/features")).json()
    assert on["blind_quality"] is True and on["quality_version"] == "blind_q1"
    assert [lv["value"] for lv in on["quality_levels"]] == list(surf_rating.LEVELS)


async def test_flag_off_drops_the_level_but_keeps_the_height(world, monkeypatch):
    monkeypatch.delenv(blind_quality.FLAG, raising=False)
    r = await world.client.post(URL, json=_checkin(quality_level="good", forecast_seen_for_spot=False),
                                headers=_token("surfer"))
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"id", "height_scale", "scale_default"}   # the reply does not say the level was dropped
    (row,) = await world.rows()
    assert row.quality_level is None and row.quality_version is None and row.face_m > 0
    assert "quality_off" in row.flags.split(",")


async def test_blind_screen_with_the_apps_word_stores_the_level(world, flag_on):
    r = await world.client.post(URL, json=_checkin(quality_level="fair_good", forecast_seen_for_spot=False),
                                headers=_token("surfer"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert (row.quality_level, row.quality_version, row.forecast_shown_before, row.forecast_seen_claim) == (
        "fair_good", "blind_q1", False, False)
    assert not any(f.startswith("quality_") for f in row.flags.split(","))


async def test_the_go_live_screen_is_blind_too(world, flag_on):
    r = await world.client.post(URL, json=dict(entry_screen="golive_conditions_modal", ref_id="cr-1", height_value=6,
                                                height_unit="ft", height_scale="hawaiian", set_or_avg="sets",
                                                quality_level="epic", forecast_seen_for_spot=False),
                                headers=_token("photog"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert row.quality_level == "epic"


@pytest.mark.parametrize("seen, flag", [(True, "quality_after_forecast"), (None, "quality_exposure_unknown")])
async def test_a_forecast_shown_or_not_vouched_for_drops_the_level(world, flag_on, seen, flag):
    body = _checkin(quality_level="good")
    if seen is not None:
        body["forecast_seen_for_spot"] = seen
    r = await world.client.post(URL, json=body, headers=_token("surfer"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert row.quality_level is None and flag in row.flags.split(",")
    assert row.forecast_seen_claim is seen


async def test_the_spot_page_report_never_stores_a_level(world, flag_on):
    r = await world.client.post(URL, json=dict(entry_screen="spot_report_modal", ref_id="sr-1", height_bucket="2-3ft",
                                                height_scale="face", set_or_avg="typical", quality_level="good",
                                                forecast_seen_for_spot=False), headers=_token("surfer"))
    assert r.status_code == 200, r.text
    (row,) = await world.rows()
    assert row.forecast_shown_before is True and row.quality_level is None
    assert "quality_not_blind" in row.flags.split(",")


async def test_an_unknown_level_is_refused(world, flag_on):
    r = await world.client.post(URL, json=_checkin(quality_level="pumping", forecast_seen_for_spot=False),
                                headers=_token("surfer"))
    assert r.status_code == 422
    assert await world.rows() == []


async def test_no_reward_reads_the_level(world, flag_on):
    """Same report with and without a level, from two accounts: the XP outcome must not differ."""
    a = await world.client.post(URL, json=_checkin(quality_level="epic", forecast_seen_for_spot=False),
                                headers=_token("surfer"))
    b = await world.client.post(URL, json=_checkin(ref_id=None, spot_id="nsb"), headers=_token("other"))
    assert a.status_code == b.status_code == 200
    with_level, without = sorted(await world.rows(), key=lambda r: r.quality_level is None)
    assert with_level.quality_level == "epic" and without.quality_level is None
    assert (with_level.xp_status, with_level.bonus_eligible) == (without.xp_status, without.bonus_eligible)
