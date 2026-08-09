"""The shadow A/B must reproduce production before it may judge a candidate.

The instrument's spine is the per-row baseline self-check: replaying the persisted inputs through
the SAME production functions must reproduce the persisted score, or the row is DISQUALIFIED --
a non-reproducing baseline means the replay drifted into a second forecast path (the repo's #1
recurring defect class) and its candidate arm would be judging against fiction. Controls in both
directions, as always: the null candidate changes nothing, a known flag moves a known row in the
known direction, and a tampered row is excluded loudly rather than included quietly."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.science_shadow_ab import replay_frames                     # noqa: E402
from services.weather_pipeline.surf_point import (                       # noqa: E402
    estimate_surf_at, resolve_surf_geometry)
from services.weather_pipeline.surf_rating import compute_surf_rating   # noqa: E402

PIPELINE = (21.665, -158.051)


def _row(lat=PIPELINE[0], lng=PIPELINE[1], offshore=2.0, tp=14.0, swell_from=315.0,
         wind_ms=2.0, wind_from=140.0, reference=None):
    """A frame row built THROUGH the production functions, so the baseline reproduces exactly."""
    g = resolve_surf_geometry(lat, lng)
    h, _ = estimate_surf_at(lat, lng, offshore, tp, swell_from, geometry=g)
    score, level = compute_surf_rating(
        h, tp, wind_ms, wind_from_deg=wind_from, shore_normal_deg=g.shore_normal_deg,
        swell_from_deg=swell_from, reference_size_m=reference,
        break_depth_m=g.break_depth_m)
    row = {"spot_id": "s1", "name": "PipelineTest", "latitude": lat, "longitude": lng,
           "score": score, "level": level, "surf_height_m": round(h, 3), "period_s": tp,
           "inputs": {"offshore_hs_m": offshore, "swell_from_deg": swell_from,
                      "wind_ms": wind_ms, "wind_from_deg": wind_from,
                      **({"shore_normal_deg": g.shore_normal_deg}
                         if g.shore_normal_deg is not None else {}),
                      **({"break_depth_m": g.break_depth_m}
                         if g.break_depth_m is not None else {})}}
    if reference is not None:
        row["reference_size_m"] = reference
    return row


def _frames(rows):
    return [{"spots": rows}]


@pytest.fixture(autouse=True)
def clean_flags(monkeypatch):
    for k in ("SURF_REFRACTION_KR", "SURF_HEIGHT_H110", "RATING_LOCAL_SIZE"):
        monkeypatch.delenv(k, raising=False)


def test_the_null_candidate_is_the_null_result():
    """A candidate identical to the baseline must change NOTHING -- the null control that proves
    the harness cannot manufacture deltas."""
    rep = replay_frames(_frames([_row(), _row(offshore=1.0, tp=11.0)]),
                        {"REQUEST_TELEMETRY": "1"})     # an env key the rating never reads
    assert rep["rows_replayable"] == 2 and rep["disqualified"] == 0
    assert rep["level_up"] == 0 and rep["level_down"] == 0
    assert rep["delta_min"] == 0.0 and rep["delta_max"] == 0.0


def test_a_height_flag_candidate_moves_the_height_and_the_score():
    """SURF_REFRACTION_KR=1.0 is the documented one-env-var revert (+25.5% height). Two anchors,
    both measured 08-09 at Pipeline 14s/315deg: 0.5 m offshore sits on the quality RISING LIMB
    (77.4 -> 96.0, good -> epic), while 2.0 m sits on the known PLATEAU (96.0 either way -- the
    same flat band as the sim's 1 m/4 m = 86.5/86.5). The candidate arm must re-run the height
    half on BOTH; only the rising-limb row may move the score."""
    rep = replay_frames(_frames([_row(offshore=0.5), _row(offshore=2.0)]),
                        {"SURF_REFRACTION_KR": "1.0"})
    assert rep["rows_replayable"] == 2 and rep["disqualified"] == 0
    by_h = sorted(rep["biggest_upgrades"] + rep["biggest_downgrades"],
                  key=lambda m: m["surf_height_m"])
    limb, plateau = by_h[0], by_h[-1]
    for m in (limb, plateau):
        assert m["cand_height_m"] == pytest.approx(m["surf_height_m"] / 0.797, rel=0.01), (
            "the candidate height must be the un-refracted height (1/Kr), recomputed from the "
            "offshore inputs -- not the persisted breaking height reused")
    assert limb["delta"] > 0 and limb["level_cand"] != limb["level_now"], (
        "on the rising limb a +25% height must raise the score and the level")
    assert plateau["delta"] == 0.0, (
        "the 2 m anchor is on the documented quality plateau -- a nonzero delta here means the "
        "replay moved something besides the height")


def test_rating_local_size_off_is_structural_not_env():
    """RATING_LOCAL_SIZE gates whether the CALLER passes the reference -- the candidate arm must
    replay with reference_size_m=None, not just patch an env var nothing reads."""
    row = _row(offshore=1.2, tp=12.0, reference=2.2)     # a reference well above the height
    rep = replay_frames(_frames([row]), {"RATING_LOCAL_SIZE": "0"})
    assert rep["rows_replayable"] == 1
    only = (rep["biggest_upgrades"] + rep["biggest_downgrades"])[0]
    assert only["delta"] != 0.0, (
        "dropping a 2.2 m reference on a ~1 m day must change the size gate -- the structural "
        "toggle did not reach the replay")


def test_a_tampered_row_is_disqualified_never_included():
    row = _row()
    row["score"] = round(row["score"] + 7.7, 1)          # persisted score no longer reproduces
    rep = replay_frames(_frames([row, _row(offshore=1.5)]), {"SURF_REFRACTION_KR": "1.0"})
    assert rep["disqualified"] == 1 and rep["rows_replayable"] == 1, (
        "a non-reproducing baseline row must be excluded and counted -- including it would judge "
        "the candidate against a second forecast path")


def test_rows_without_inputs_refuse_to_replay():
    """A row with no persisted inputs is ABSENT, not broken: it must be skipped before the
    self-check, not fed through it and disqualified by coincidence (the not-sampled vs broken
    distinction -- standing rule: a check that can't tell them apart must refuse)."""
    row = _row()
    del row["inputs"]
    rep = replay_frames(_frames([row]), {"SURF_REFRACTION_KR": "1.0"})
    assert rep["rows_replayable"] == 0 and rep["rows_seen"] == 1
    assert rep["disqualified"] == 0, (
        "a no-inputs row reached the baseline self-check -- absence was counted as breakage")


def test_the_environment_is_restored_even_when_the_candidate_arm_runs():
    assert os.environ.get("SURF_REFRACTION_KR") is None
    replay_frames(_frames([_row()]), {"SURF_REFRACTION_KR": "1.0"})
    assert os.environ.get("SURF_REFRACTION_KR") is None, (
        "the candidate env leaked out of the replay -- every later baseline in this process is "
        "now silently the candidate")


# ---- the producer -> replay ROUND TRIP -----------------------------------------------------
# Everything above replays rows built by hand; this drives the REAL rate_one_spot (the reference
# implementation the precompute persists) and proves the `inputs` it emits are sufficient AND
# correctly encoded to reproduce its own score. If someone renames a key, drops a rounding, or
# adds a rating input without persisting it, THIS is the test that goes red.

class _StubResolver:
    """The point lane, minimally: breaking height via the production geometry chain (what
    point_surf_augment does), wind as a plain point. Same shape as the three-surfaces suite."""

    def __init__(self, hs, tp, sdir, wkt, wdir):
        self.hs, self.tp, self.sdir, self.wkt, self.wdir = hs, tp, sdir, wkt, wdir

    async def resolve_point(self, **kw):
        from datetime import datetime, timezone
        from services.weather_pipeline.schemas import (NormalizedPointDetail,
                                                       NormalizedPointResponse)
        lat, lng = kw["lat"], kw["lng"]
        wind = kw["domain"] == "wind"
        r = NormalizedPointResponse.model_construct(
            model="GFS", provider="open-meteo", domain=kw["domain"],
            layer="wind" if wind else "waves",
            run_time=datetime(2026, 8, 9, 6, tzinfo=timezone.utc),
            valid_time=datetime(2026, 8, 9, 12, tzinfo=timezone.utc),
            point=NormalizedPointDetail.model_construct(
                requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
                speed=self.wkt if wind else self.hs,
                period=None if wind else self.tp,
                direction=self.wdir if wind else self.sdir,
                interpolation_method="t"))
        if not wind:
            g = resolve_surf_geometry(lat, lng)
            h, _regime = estimate_surf_at(lat, lng, self.hs, self.tp,
                                          swell_from_deg=self.sdir, geometry=g)
            r.surf_height_m = h
            r.shore_normal_deg = g.shore_normal_deg
        return r


def test_round_trip_the_real_producer_reproduces_and_the_candidate_moves():
    import asyncio
    from services.weather_pipeline.spot_ratings import rate_one_spot
    rows = []
    for hs in (0.5, 2.0):
        row = asyncio.run(rate_one_spot(
            _StubResolver(hs, 14.0, 315.0, 4.0, 140.0),
            {"id": "rt-%s" % hs, "name": "Pipeline-rt", "latitude": PIPELINE[0],
             "longitude": PIPELINE[1]},
            "GFS", "2026-08-09T12:00"))
        assert row.get("score") is not None, "the stub resolver did not produce a rating"
        assert row.get("inputs"), "rate_one_spot no longer persists its inputs"
        assert row["inputs"].get("offshore_hs_m") == pytest.approx(hs, abs=0.001)
        rows.append(row)

    null = replay_frames(_frames(rows), {"REQUEST_TELEMETRY": "1"})
    assert null["rows_replayable"] == 2 and null["disqualified"] == 0, (
        "the replay cannot reproduce what the real producer persisted -- key drift, a dropped "
        "rounding, or an unpersisted rating input")
    assert null["delta_min"] == 0.0 and null["delta_max"] == 0.0

    kr = replay_frames(_frames(rows), {"SURF_REFRACTION_KR": "1.0"})
    assert kr["rows_replayable"] == 2 and kr["disqualified"] == 0
    assert kr["delta_max"] > 0, "the candidate arm cannot move a real producer row"
