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


# ---- REFERENCE_LANE=cell: the owner's band-vs-glyph question (queue E#1) --------------------

def test_the_cell_reference_lane_is_structural_and_injected():
    """The band's yardstick is a 2-degree lattice cell; the glyph's is the spot. Replaying with the
    cell reference measures how often that gap changes the COLOUR -- the user-visible quantity the
    46% reference gap does not by itself give you."""
    row = _row(offshore=1.2, tp=12.0, reference=1.484)      # Pipeline's measured spot_ref
    rep = replay_frames(_frames([row]), {"REFERENCE_LANE": "cell"},
                        cell_ref_fn=lambda lat, lng: 2.164)  # its measured cell_ref
    assert rep["rows_replayable"] == 1 and rep["disqualified"] == 0
    only = (rep["biggest_upgrades"] + rep["biggest_downgrades"])[0]
    assert only["ref_now"] == 1.484 and only["ref_cand"] == 2.164, (
        "both yardsticks must be reported on the mover row -- the E#1 question is exactly which "
        "reference and how far apart")
    assert only["delta"] < 0, (
        "a LARGER reference means the same wave is a smaller fraction of a good day, so the band "
        "must score this spot BELOW the glyph")


def test_the_cell_lane_without_an_injected_reference_does_not_silently_agree():
    """A missing climatology must not replay as 'no reference' -- that reads as band/glyph
    agreement that was never measured. The core returns None-reference rows; main() REFUSES
    before reaching here (pinned in test_the_cell_lane_refuses_without_a_climatology)."""
    row = _row(offshore=1.2, tp=12.0, reference=1.484)
    rep = replay_frames(_frames([row]), {"REFERENCE_LANE": "cell"}, cell_ref_fn=None)
    only = (rep["biggest_upgrades"] + rep["biggest_downgrades"])[0]
    assert only["ref_cand"] is None and only["delta"] != 0.0, (
        "dropping the reference entirely must not look like agreement")


def test_the_cell_lane_refuses_without_a_climatology(monkeypatch, tmp_path, capsys):
    """main()'s refusal is the load-bearing half: exit 3, with the reason on stdout."""
    import json as _json
    from scripts import science_shadow_ab as mod
    frames_file = tmp_path / "f.json"
    frames_file.write_text(_json.dumps({"frames": _frames([_row()])}), encoding="utf-8")
    monkeypatch.setattr(mod, "_cell_reference_fn", lambda: None)
    monkeypatch.setattr(sys, "argv", ["x", "--candidate", "REFERENCE_LANE=cell",
                                      "--frames-file", str(frames_file)])
    assert mod.main() == 3
    assert "REFUSED" in capsys.readouterr().out


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


def test_round_trip_the_real_producer_reproduces_and_the_candidate_moves(monkeypatch):
    import asyncio
    from services.weather_pipeline.spot_ratings import rate_one_spot
    # This test's subject is round-trip FIDELITY, so it forces every row into the inputs sample;
    # the sampling itself is pinned separately below. (Without this it passes or fails on whether
    # the synthetic spot ids happen to land in the 5% -- a test that depends on an id hash.)
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "100")
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


# ---- the instrument must not tax the product it measures ------------------------------------

def test_the_inputs_payload_is_sampled_not_universal(monkeypatch):
    """Measured 2026-08-09: inputs cost +137 B on a 320 B row (+42.8%) -- nearly DOUBLE the +23%
    that justified interning run_time out of the SAME blob, which every client downloads. 5% keeps
    the cost at ~2% and still yields ~530 replayable rows per blob."""
    import uuid
    from services.weather_pipeline.spot_ratings import _persist_inputs
    ids = [str(uuid.UUID(int=i)) for i in range(4000)]
    monkeypatch.delenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", raising=False)
    rate = 100.0 * sum(1 for i in ids if _persist_inputs(i)) / len(ids)
    assert 3.0 < rate < 8.0, (
        "default sample drifted to %.2f%% -- the blob cost scales with it linearly" % rate)


def test_the_sample_is_stable_across_processes_not_hash_seeded(monkeypatch):
    """PYTHONHASHSEED randomises str hash() per process, and TWO workers write this blob. A
    seed-dependent sample would give them different sets, so a row's inputs would blink in and out
    between cycles and a cross-run comparison would grade a different population each time."""
    import hashlib
    import uuid
    from services.weather_pipeline.spot_ratings import _persist_inputs
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "5")
    for i in range(200):                      # recompute the contract independently of the impl
        sid = str(uuid.UUID(int=i))
        expected = (int(hashlib.md5(sid.encode("utf-8")).hexdigest()[:8], 16) % 100) < 5
        assert _persist_inputs(sid) is expected


def test_the_sample_can_be_disabled_and_maximised(monkeypatch):
    import uuid
    from services.weather_pipeline.spot_ratings import _persist_inputs
    ids = [str(uuid.UUID(int=i)) for i in range(200)]
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "0")
    assert not any(_persist_inputs(i) for i in ids), "0 must disable the payload entirely"
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "100")
    assert all(_persist_inputs(i) for i in ids), "100 must carry every row for a deep one-off run"


def test_a_sampled_blob_still_replays_and_reports_the_sample_honestly():
    """rows_seen counts the population; rows_replayable counts the sample. A report that showed
    only the sample would read as full coverage -- the census lesson, applied to my own tool."""
    carried, bare = _row(offshore=0.5), _row(offshore=2.0)
    del bare["inputs"]                        # a row outside the sample
    rep = replay_frames(_frames([carried, bare]), {"SURF_REFRACTION_KR": "1.0"})
    assert rep["rows_seen"] == 2 and rep["rows_replayable"] == 1 and rep["disqualified"] == 0


# ---- NOT-SAMPLED is not BROKEN, and the exit codes must say so ------------------------------

def _run_main(monkeypatch, tmp_path, rows, capsys, candidate="SURF_REFRACTION_KR=1.0"):
    import json as _json
    from scripts import science_shadow_ab as mod
    f = tmp_path / "frames.json"
    f.write_text(_json.dumps({"frames": _frames(rows)}), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["x", "--candidate", candidate, "--frames-file", str(f)])
    code = mod.main()
    return code, capsys.readouterr().out


def test_no_inputs_anywhere_is_NOT_READY_and_exits_zero(monkeypatch, tmp_path, capsys):
    """Frames that predate the inputs persistence, or a blob where no row fell in the 5% sample,
    are ABSENCE. Nothing is wrong, nothing was measured, and it self-resolves on the next
    precompute -- so it must not burn a red. (It cost two false CI alarms before this split.)"""
    bare = _row()
    del bare["inputs"]
    code, out = _run_main(monkeypatch, tmp_path, [bare], capsys)
    assert code == 0, "an unmeasurable-yet blob must not read as a failure"
    assert "NOT READY" in out and "NOTHING WAS MEASURED" in out, (
        "green must be unmistakably labelled as 'nothing to compare', never as approval")
    assert "REFUSED" not in out


def test_rows_that_carry_inputs_and_do_not_reproduce_still_REFUSE(monkeypatch, tmp_path, capsys):
    """The other half of the split: a row that HAD inputs and failed the baseline self-check means
    the replay is no longer the production chain. That stays exit 3 -- blind is never green."""
    tampered = _row()
    tampered["score"] = round(tampered["score"] + 9.9, 1)
    code, out = _run_main(monkeypatch, tmp_path, [tampered], capsys)
    assert code == 3 and "REFUSED" in out
    assert "NOT READY" not in out


def test_a_measurable_blob_still_reports_and_exits_zero(monkeypatch, tmp_path, capsys):
    code, out = _run_main(monkeypatch, tmp_path, [_row(offshore=0.5)], capsys)
    assert code == 0 and "SHADOW A/B" in out and "NOT READY" not in out


# ---- the verdict must carry its own SCOPE ----------------------------------------------------

def _frame(model, hour, vt, rows):
    return {"model": model, "hour_offset": hour, "valid_time": vt, "spots": rows}


def test_the_report_discloses_what_population_it_covered():
    """"0.2% of rows changed" is unreadable without knowing whether that is one hour or a
    fortnight. The first real run (SURF_TIDE_DEPTH) spanned 3 models x 2 hour-offsets and the
    report said none of it -- the same overstatement-by-omission the REFERENCE_LANE scope note
    exists to prevent."""
    rows = [_row(offshore=0.5)]
    frames = [_frame(m, h, vt, rows)
              for m in ("GFS", "EURO", "ICON")
              for h, vt in ((0, "2026-08-09T20:00:00Z"), (3, "2026-08-09T23:00:00Z"))]
    rep = replay_frames(frames, {"SURF_REFRACTION_KR": "1.0"})
    c = rep["coverage"]
    assert c["frames"] == 6
    assert c["models"] == ["EURO", "GFS", "ICON"]
    assert c["hour_offsets"] == [0, 3]
    assert c["hour_span"] == 3, "the span is what tells a reader the window is narrow"
    assert c["valid_time_min"] == "2026-08-09T20:00:00Z"
    assert c["valid_time_max"] == "2026-08-09T23:00:00Z"


def test_coverage_is_absent_not_wrong_when_the_frames_do_not_carry_it():
    """Older blobs may omit model/hour_offset. Absent must read as unknown ('?'), never as a
    confident zero-hour span -- an invented scope is worse than a missing one."""
    rep = replay_frames(_frames([_row()]), {"SURF_REFRACTION_KR": "1.0"})
    c = rep["coverage"]
    assert c["frames"] == 1
    assert c["models"] == [] and c["hour_offsets"] == []
    assert c["hour_span"] is None and c["valid_time_min"] is None


# ---- a null verdict is only meaningful if the harness COULD have produced a non-null one -----

def test_an_inert_candidate_is_refused_not_reported_as_quiet(monkeypatch, tmp_path, capsys):
    """THE FALSE RESULT THIS PREVENTS. The first real run reported SURF_TIDE_DEPTH=1 as
    "0.2% level change, median 0.0" -- which reads as SAFE TO FLIP -- while measuring nothing,
    because the replay supplied no water_level_m and the tide term is guarded on it.

    ⚠️ THE PROBE HAS MOVED ON PURPOSE: SURF_TIDE_DEPTH is no longer inert (the water level is
    persisted and replayed now, see the round-trip test below), so this uses a flag the rating
    genuinely never reads. Using the fixed flag here would have quietly turned this into a test of
    nothing -- the same failure it exists to catch."""
    code, out = _run_main(monkeypatch, tmp_path, [_row(offshore=0.5)], capsys,
                          candidate="REQUEST_TELEMETRY=1")
    assert code == 3, "an inert lever must REFUSE, never report a reassuring null"
    assert "cannot exercise" in out and "INERT" in out


def test_the_tide_lever_is_now_EXERCISABLE_and_potent(monkeypatch, tmp_path, capsys):
    """THE FIX, PINNED. Persisting water_level_m turned SURF_TIDE_DEPTH from unmeasurable into
    measurable: the control's max |delta| went 0.00 -> 38.10 points. If someone drops the field
    from `inputs`, or stops threading it into estimate_surf_at, the flag silently becomes inert
    again and the harness goes back to reporting reassuring nulls for it."""
    from scripts.science_shadow_ab import candidate_can_move
    ctl = candidate_can_move({"SURF_TIDE_DEPTH": "1"})
    assert ctl["can_move"] is True, (
        "the tide lever is inert again -- water_level_m is no longer reaching estimate_surf_at")
    assert ctl["max_abs_delta"] > 10.0, (
        "tide moves the DEPTH-LIMITED CAP: measured 38.1 points at the cap-limited probe. A small "
        "delta means the probes stopped reaching the saturated regime where it binds.")


def test_a_live_candidate_still_reports_normally(monkeypatch, tmp_path, capsys):
    """CONTROL OF THE CONTROL: the gate must not block candidates the harness CAN exercise, or it
    would convert every result into a refusal and look rigorous while measuring nothing."""
    code, out = _run_main(monkeypatch, tmp_path, [_row(offshore=0.5)], capsys,
                          candidate="SURF_REFRACTION_KR=1.0")
    assert code == 0 and "SHADOW A/B" in out and "cannot exercise" not in out


def test_the_control_probes_reach_the_cap_limited_regime():
    """The tide cap binds ONLY in the saturated regime -- measured at Pipeline, water level moves
    the breaking height 8.99 -> 12.92 m at 12 m offshore and NOTHING at 8 m or below. A control
    built only from ordinary seas would report 'inert' for a flag that is merely rare, so the
    probe set must span up to the cap."""
    from scripts.science_shadow_ab import candidate_can_move
    # A height flag moves the ordinary rows, proving the probes are live and replayable.
    ctl = candidate_can_move({"SURF_REFRACTION_KR": "1.0"})
    assert ctl["can_move"] is True
    assert ctl["probes"] >= 5 and ctl["replayable"] >= 5
    assert ctl["max_abs_delta"] > 0.25


def test_the_producer_persists_the_water_level_when_tide_is_resolved(monkeypatch):
    """MUTATION-DRIVEN (2026-08-09): dropping `water_level_m` from the producer survived every
    other test, because they run with RATING_TIDE off -- so the tide is absent either way and the
    round-trip cannot tell a deliberate omission from a legitimately-missing input. This drives the
    producer with tide resolution ON and a stubbed tide, which is the only way the field's absence
    becomes observable."""
    import asyncio
    from services.weather_pipeline import spot_ratings as sr

    async def _fake_tide(lat, lng, valid_time, client=None):
        return {"height_m": 1.42, "norm": 0.8, "trend": "rising"}

    monkeypatch.setenv("RATING_TIDE", "1")
    monkeypatch.setenv("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "100")
    import services.weather_pipeline.tide as tide_mod
    monkeypatch.setattr(tide_mod, "tide_norm_at", _fake_tide)

    row = asyncio.run(sr.rate_one_spot(
        _StubResolver(1.5, 14.0, 315.0, 4.0, 140.0),
        {"id": "tide-1", "name": "Pipeline-tide", "latitude": PIPELINE[0],
         "longitude": PIPELINE[1]},
        "GFS", "2026-08-09T12:00"))
    assert row.get("inputs"), "the producer stopped persisting inputs entirely"
    assert row["inputs"].get("water_level_m") == pytest.approx(1.42, abs=0.001), (
        "water_level_m is not being persisted -- SURF_TIDE_DEPTH becomes unmeasurable and the "
        "shadow A/B goes back to reporting a reassuring null for it")


def test_input_presence_and_the_dependency_subset_are_reported():
    """A tide verdict averaged over rows with NO tide reads as 'quiet' -- the denominator lesson.
    The report must say how many replayable rows carried the guarded input, and give the rate over
    that subset."""
    base = _row(offshore=12.0, tp=14.0)          # cap-limited: where the tide term actually binds
    withtide = _row(offshore=12.0, tp=14.0)
    withtide["inputs"]["water_level_m"] = 1.5
    rep = replay_frames(_frames([base, withtide]), {"SURF_TIDE_DEPTH": "1"})
    assert rep["inputs_present"]["offshore_hs_m"] == 2
    assert rep["inputs_present"].get("water_level_m") == 1, "only one row carries the tide"
    ds = rep["dep_subset"]
    assert ds["input"] == "water_level_m"
    assert ds["rows"] == 1, "the subset must exclude rows the flag cannot touch"
    assert ds["max_abs_delta"] > 0.25, "the carrying row must actually move"


def test_a_candidate_with_no_carrying_rows_is_flagged_blind():
    rep = replay_frames(_frames([_row(offshore=12.0, tp=14.0)]), {"SURF_TIDE_DEPTH": "1"})
    assert rep["dep_subset"]["rows"] == 0, "no row carries a water level here"


def test_a_candidate_without_a_declared_dependency_reports_no_subset():
    rep = replay_frames(_frames([_row(offshore=0.5)]), {"SURF_REFRACTION_KR": "1.0"})
    assert rep["dep_subset"] is None
