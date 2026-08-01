"""The sim learns WHICH SIZE CURVE the app is on by READING IT, not by asking its own env (2026-08-01).

★★★ THE FAILING INSTANCE THIS WAS BUILT AGAINST — measured live, not inferred. On the owner's own
machine `get_weather_forecast("Mavericks")` returned `reference_size_m: null`, sim **54.6 `fair`**
against the app's served **31.9 `poor_fair`** — **delta +22.7 with a LEVEL difference** — while
every line of the composition was correct. The cause was CONFIG: the `WeatherSimulation` entry in
`.claude.json` carries `env: undefined` and in `claude_desktop_config.json` `env: {}`, so
`RATING_LOCAL_SIZE` was unset and `reference_size_for` returned None on its first line.

⇒ The recorded trap, verbatim: **a flag has a value PER LANE — read the SERVED PAYLOAD, not this
process's env.** `RATING_LOCAL_SIZE` is production's rollout lever; its authority lives in three
production lanes. A sim process asking its OWN env is not consulting that lever, it is guessing at
it, and the guess is wrong by default on every machine that has not been hand-configured — with no
instrument able to tell, because a lookup miss lands on the global curve, **which IS the bug**.

The fix reads the reference off the `/api/weather/point` response the sim ALREADY fetches for the
sea. Same response, same run, same coordinate ⇒ the sim MIRRORS the composition instead of
re-deriving it (CLAUDE.md), and needs no env var, no Supabase credentials, and no config anywhere.

THE TWO-SIDED RECONSTRUCTION THAT PINNED IT (Mavericks, 2026-08-01T15:00:00Z, the exact live sea
the deployed sim reported: h 1.6414 / T 7.78 / dir 271.11 / wind 4.2602 kt @ 295.22):

    reference = None   -> 54.6 fair       == the deployed sim's own answer   <- CONTROL
    reference = 1.86   -> 31.8 poor_fair  == the SERVED glyph's 31.9, |d| 0.1
    reference = 1.931  -> 30.5 poor_fair  == what /api/weather/point serves at this coordinate

★ Reproducing BOTH endpoints is what makes this an attribution rather than a count. The numbers
below are those measurements, so these tests fail if the composition drifts from what the app does
— not merely if the plumbing changes shape.
"""
import math

import pytest

from services.weather_pipeline import sim_forecast, sim_rating

# The exact live sea the deployed sim reported for Mavericks at 2026-08-01T15:00:00Z.
MAVERICKS = {"id": "mavericks-fixture", "name": "Mavericks",
             "latitude": 37.4915, "longitude": -122.5083}
SEA = dict(swell_h=1.6414, swell_p=7.78, swell_dir=271.11,
           wind_spd=4.2602, wind_dir=295.22)

GLOBAL_CURVE_SCORE = 54.6      # reference None — what the misconfigured sim answered
SPOT_REFERENCE_M = 1.86        # the per-SPOT climatology the glyph graded with
SPOT_REFERENCE_SCORE = 31.8    # what that reference reproduces (served glyph: 31.9)


def _score(**kw):
    return sim_rating.calculate_surf_rating(dict(MAVERICKS), **SEA, **kw)["quality_rating"]


# ── 1. THE ARITHMETIC GUARD — the one that cannot pass by accident ────────────────────────────
# ★ Recorded lesson: "the best guard was ARITHMETIC, not structural". A both-None pair satisfies a
# bare equality check while pinning nothing; these assert the MEASURED live values.

def test_the_served_reference_reaches_the_score_WITH_THE_FLAG_OFF(monkeypatch):
    """THE WHOLE POINT. With RATING_LOCAL_SIZE unset — the state of every unconfigured machine —
    the served reference must still change the score, by the measured amount."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    assert _score() == pytest.approx(GLOBAL_CURVE_SCORE, abs=0.15)          # control: the defect
    served = _score(served_reference_size_m=SPOT_REFERENCE_M)
    assert served == pytest.approx(SPOT_REFERENCE_SCORE, abs=0.15)          # the fix
    # ⚠️ Assert the GAP, not just the two values: this is the +22.7 the owner's machine reported.
    assert GLOBAL_CURVE_SCORE - served > 20.0


def test_the_flag_off_still_means_the_global_curve_when_nothing_was_served(monkeypatch):
    """NEGATIVE CONTROL. The fix must be invisible unless the app actually sent a reference —
    otherwise it is not a mirror, it is a second forecast path."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    assert sim_rating.reference_size_for(MAVERICKS, allow_lookup=True, served=None) is None
    assert _score(served_reference_size_m=None) == pytest.approx(GLOBAL_CURVE_SCORE, abs=0.15)


# ── 2. THE TRUST BOUNDARY — this is json.loads of a REMOTE deploy ─────────────────────────────

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"),
                                 None, 0.0, -1.0, "", "abc", {}, [], 25.0])
def test_a_malformed_served_reference_is_refused_at_the_boundary(bad):
    """⚠️ NaN IS THE DANGEROUS ONE, and it is why this parametrisation exists rather than a
    truthiness check. `surf_rating.size_score` guards with `ref is None or ref <= 0.2`, and NaN
    passes BOTH (it is not None, and every comparison against it is False), so it would flow
    through and make the whole score NaN — which `score_to_level` reads as the TOP bucket, 'epic'.
    A blown-out day would render as the best surf of the year. Same landmine as the partitions
    normalizer."""
    assert sim_forecast._sane_reference(bad) is None


def test_the_two_non_finite_shapes_BOTH_survive_a_naive_check():
    """★ THIS TEST ALREADY EARNED ITS KEEP: it caught `inf` passing my first validator, which
    tested `v != v` alone. Both non-finite shapes defeat the obvious guards, in OPPOSITE
    directions — NaN drives the score to NaN (reads 'epic'), inf drives size_score to 0.0 (reads
    flat) — so neither a positivity check nor a self-inequality check is sufficient on its own."""
    assert float("inf") > 0.0                       # a bare `if v > 0` admits it
    assert not (float("nan") > 0.0)                 # ...and silently drops NaN for the wrong reason
    assert float("nan") != float("nan")             # self-inequality catches NaN but NOT inf
    assert float("inf") == float("inf")
    assert sim_forecast._sane_reference(float("inf")) is None
    assert sim_forecast._sane_reference(float("nan")) is None


def test_a_good_served_reference_survives_the_boundary():
    """A refusal guard that refuses EVERYTHING passes its own negative tests while breaking the
    feature. This is the known-present control."""
    assert sim_forecast._sane_reference(1.931) == pytest.approx(1.931)
    # A NUMERIC STRING COERCES — deliberately, and identically to `_sane_partitions`, which floats
    # its own inputs. The hazard a string poses is reaching the ENGINE, where it raises TypeError
    # out of a comparison; coercing here is what removes that hazard, so refusing it would be
    # strictly worse. (My first draft asserted the opposite and this test is why I know.)
    assert sim_forecast._sane_reference("1.931") == pytest.approx(1.931)
    assert sim_forecast.served_reference({"served_reference_size_m": 2.069}) == pytest.approx(2.069)
    assert sim_forecast.served_reference({}) is None
    assert sim_forecast.served_reference(None) is None


def test_the_provenance_key_is_the_one_fetch_live_forecast_writes():
    """★ A rename's blast radius: `served_reference` reads a key that another function writes, and
    nothing else joins them. Pin the contract by NAME so a rename on either side goes red here
    rather than degrading into a silent None (which reads exactly like 'the app sent nothing')."""
    src = sim_forecast.fetch_live_forecast.__doc__ is not None      # module imported, not stubbed
    assert src
    import inspect
    body = inspect.getsource(sim_forecast.fetch_live_forecast)
    assert '"served_reference_size_m"' in body, (
        "fetch_live_forecast no longer writes the key served_reference() reads")


# ── 3. PRECEDENCE — a served measurement outranks a hand-tuned constant ───────────────────────

def test_served_outranks_the_hand_tuned_catalog_constant(monkeypatch):
    """★ The principle `f504d52b` established when a grafted 4.0 outranked the climatology:
    **a constant measured for a NAME has no claim over a live row's own measurement.** A served
    reference is the strongest such measurement — it is the number the app actually graded with."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    spot = {**MAVERICKS, "reference_size_m": 4.0}        # the shape the graft used to produce
    assert sim_rating.reference_size_for(spot, allow_lookup=True, served=1.86) == 1.86
    # ...and with nothing served, the hand-tuned value still answers — this fix took nothing away.
    assert sim_rating.reference_size_for(spot, allow_lookup=True, served=None) == 4.0


def test_the_served_reference_does_not_need_the_flag_but_the_lookup_still_does(monkeypatch):
    """The two lanes stay distinct: an OBSERVATION needs no permission, an inference still does."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    assert sim_rating.reference_size_for(MAVERICKS, allow_lookup=True, served=1.86) == 1.86
    assert sim_rating.reference_size_for({**MAVERICKS, "reference_size_m": 2.5},
                                         allow_lookup=True, served=None) is None


# ── 4. ONE ANSWER, ONE CURVE ──────────────────────────────────────────────────────────────────

def test_the_size_verdict_grades_on_the_SAME_curve_as_the_score(monkeypatch):
    """`calculate_surf_rating` resolves the reference TWICE — once for `rating_score` and once for
    `oversize_gate`/`size_verdict`. If only the first took the served value, one payload would
    report a quality and a size verdict computed against two different curves: the `baseline_delta`
    defect `f504d52b` closed, folded inside a single answer.

    Pinned ARITHMETICALLY through the payload: at 2.5x a tiny reference the oversize taper has
    engaged, which is only reachable if the served value reached the SECOND call site too."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    out = sim_rating.calculate_surf_rating(dict(MAVERICKS), **SEA,
                                           served_reference_size_m=0.25)
    assert out["why"]["inputs"]["reference_size_m"] == pytest.approx(0.25)
    # 1.80 m of surf against a 0.25 m reference is 7.2x — past OVERSIZE_FLOOR_MULT (6.0).
    assert out["size_verdict"] != "within_range", (
        "the oversize gate did not see the served reference => the second call site was missed")
    # And the control: the same sea on the global curve is ordinary.
    assert sim_rating.calculate_surf_rating(dict(MAVERICKS), **SEA)["size_verdict"] == "within_range"


def test_the_reference_survives_a_what_if_because_it_describes_the_PLACE(monkeypatch):
    """Unlike `partitions`, a hypothesised swell must NOT drop the reference. The trains describe
    the forecast SEA (so a what-if invalidates them); the reference is the spot's own yardstick, so
    re-scaling it when someone asks 'what if it were 3 m' would silently move the goalposts the
    question is measured against."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    hypothetical = {**SEA, "swell_h": 3.0}
    out = sim_rating.calculate_surf_rating(dict(MAVERICKS), **hypothetical,
                                           served_reference_size_m=SPOT_REFERENCE_M)
    assert out["why"]["inputs"]["reference_size_m"] == pytest.approx(SPOT_REFERENCE_M)


# ── 5. THE ZERO-NETWORK INVARIANT IS STRENGTHENED, NOT SPENT ──────────────────────────────────

def test_reading_a_served_reference_dials_nothing(monkeypatch):
    """⚠️ Recorded trap: a guard for 'this path does no I/O' must count EVERY dial the path can
    make, and must SPY BY RETURNING — the lookup sits in a fail-open `except Exception` that would
    swallow an AssertionError and pass whether or not the dial happened.

    Here the stronger claim holds: a served reference answers BEFORE the blob is considered, so it
    cannot dial even with the flag on and lookup permitted."""
    dials = []

    def _spy(*a, **k):
        dials.append(1)
        return {"spots": {}}                              # RETURN, never raise

    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    import services.weather_pipeline.spot_size_climatology as SSC
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", _spy)

    assert sim_rating.reference_size_for(MAVERICKS, allow_lookup=True, served=1.86) == 1.86
    assert dials == [], "a served reference must short-circuit the climatology loader entirely"

    # THE CONTROL THAT PROVES THE SPY WORKS: with nothing served, the same call DOES dial.
    SSC._ref_map_memo["cell"] = (None, {})
    sim_rating.reference_size_for(MAVERICKS, allow_lookup=True, served=None)
    assert dials, "the spy never fired => this test could not have detected a dial"


# ── 6. THE WHAT-IF: BOTH SIDES OF THE DELTA SHARE ONE REFERENCE ───────────────────────────────
# ✅ Runs in CI: `weather_sim_mcp` imports through `sim_mcp_shim` even without fastmcp.

def test_the_whatif_binds_the_served_reference_once_for_both_calls():
    import inspect

    import weather_sim_mcp
    body = inspect.getsource(weather_sim_mcp.simulate_weather_change)
    assert "_served_ref = sim_forecast.served_reference(provenance)" in body, (
        "the served reference must be bound ONCE, like _reference_lookup_ok")
    # BOTH rating calls in the what-if must consume that one variable. Counting is the point: two
    # occurrences means `calc` and `base_calc`, which is what makes the delta composition-matched.
    assert body.count("served_reference_size_m=_served_ref") == 2, (
        "both sides of baseline_delta must grade on the same size curve (f504d52b)")
