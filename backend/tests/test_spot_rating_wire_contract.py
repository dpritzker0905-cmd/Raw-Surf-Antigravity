"""THE WIRE CONTRACT — a field is not shipped until a test asserts it survives serialisation.

WHY THIS EXISTS (2026-08-03). `6da4c16e` added `limiter` / `limiter_f` to `rate_one_spot`'s returned
dict and shipped 138 lines of guards for `rating_factors`. The code deployed correctly — `/api/health`
reported the SHA — and the field was **absent from every response for hours**, because
`SpotRatingItem` is a Pydantic model and **Pydantic drops undeclared keys**. Nothing tested the wire.

That is the same defect this repo already recorded as `e8b38e42`: *"the geometry provenance envelope
was served and dropped at the render boundary."* The producer was guarded; the BOUNDARY was not.

★ THE CONTROL IS THE POINT. `test_an_undeclared_field_is_dropped` proves the MECHANISM is live, so a
  future reader cannot dismiss these as testing nothing. If Pydantic's behaviour ever changed, that
  control goes red and this whole suite's premise is re-examined.
"""
import pytest

from routes.weather import SpotRatingItem, SpotRatingsResponse

# The keys `rate_one_spot` actually returns, and which therefore have to survive the boundary.
# Kept as an explicit list rather than introspected from the producer: an introspected list would
# agree with the producer by construction and could never catch a field being dropped.
PROVENANCE_FIELDS = [
    "limiter", "limiter_f",          # 6da4c16e — which factor removed the most
    "geometry_readiness",            # what the forecast RAN ON
    "run_time", "wind_run_time",     # which model RUN produced it
    "confirmed", "raw_score",        # the observation gate's audit trail
    "directional_conflict",          # the size and the quality disagree about the same swell
    "forecast_confidence",           # 10.0 §1.2 — how much the ensemble members disagree
]


def _item(**over):
    base = dict(spot_id="a-uuid", name="Irita", latitude=33.5, longitude=134.3,
                score=64.2, level="fair_good", confidence="medium",
                surf_height_m=2.908, period_s=14.6, why="~9.5 ft surf, 15s period, 6kt offshore wind",
                limiter="size_gate", limiter_f=0.6438,
                geometry_readiness="degraded", run_time="2026-08-03T06:00:00Z",
                wind_run_time="2026-08-03T05:00:00Z", confirmed=None, raw_score=64.2,
                directional_conflict={"reason": "size_and_quality_disagree_on_swell_exposure",
                                      "quality_exposure": 0.1, "height_exposure_factor": 0.595,
                                      "height_implied_energy": 0.354, "energy_disagreement": 3.54,
                                      "means": "the SIZE shown assumes about 35% ..."},
                forecast_confidence={"level": "moderate", "spread_m": 0.31,
                                     "relative_spread": 0.22, "calibrated": False,
                                     "basis": "ecmwf_waef_member_spread",
                                     "means": "members differ by about 22% of wave height; "
                                              "this does not change the rating"})
    base.update(over)
    return base


@pytest.mark.parametrize("field", PROVENANCE_FIELDS)
def test_every_provenance_field_survives_serialisation(field):
    """The one that would have caught it: build from the producer's dict, dump, assert present."""
    src = _item()
    assert field in src, f"SETUP BROKEN: {field} not in the fixture the producer returns"

    dumped = SpotRatingItem(**src).model_dump()

    assert field in dumped, (
        f"'{field}' was DROPPED at the response boundary — declare it on SpotRatingItem. "
        f"This is the e8b38e42 defect: a producer that returns it and a model that does not know it."
    )
    assert dumped[field] == src[field]


def test_an_undeclared_field_is_dropped__THE_CONTROL():
    """KNOWN-FAILING CONTROL: proves the drop mechanism is real and still active.

    Without this, the parametrised test above could pass on a model that accepted everything, and
    would then be testing nothing at all."""
    dumped = SpotRatingItem(**_item(a_field_nobody_declared="value")).model_dump()
    assert "a_field_nobody_declared" not in dumped, (
        "Pydantic no longer drops undeclared keys — the premise of this suite has changed, and the "
        "boundary guards above must be re-derived rather than trusted."
    )


def test_the_limiter_reaches_the_wire_through_the_FULL_response_model():
    """The item model is not the boundary the client sees — the response wraps it. Assert through
    the whole envelope, because a list[Model] field re-validates its members."""
    resp = SpotRatingsResponse(model="GFS", valid_time="2026-08-03T20:00:00Z", count=1,
                               source="live", spots=[SpotRatingItem(**_item())])
    spot = resp.model_dump()["spots"][0]
    assert spot["limiter"] == "size_gate"
    assert spot["limiter_f"] == pytest.approx(0.6438)


def test_a_frame_without_a_limiter_still_validates():
    """Older precomputed frames simply omit it — the field must be Optional, not required, or every
    pre-deploy blob 500s the endpoint."""
    src = _item()
    del src["limiter"]
    del src["limiter_f"]
    item = SpotRatingItem(**src)
    assert item.limiter is None and item.limiter_f is None


def test_a_frame_without_a_directional_conflict_still_validates():
    """ABSENT IS THE NORMAL CASE HERE — unlike the fields above, this one is missing on ~85% of
    spots BY DESIGN (it fires only at dtheta >= 75.73 deg). If it were required, the common path
    would 500."""
    src = _item()
    del src["directional_conflict"]
    assert SpotRatingItem(**src).directional_conflict is None


# ── ⭐⭐⭐ THE CHOKEPOINT: producer keys vs boundary fields ───────────────────────────────────────
#
# The list above catches a DECLARED field being removed. It cannot catch the defect that actually
# shipped: a field ADDED to the producer and never declared on the model. `limiter` was returned
# correctly by `rate_one_spot` and absent from every response for hours, and no explicit list would
# have known to include it — the list is written by the same person who forgot the declaration.
#
# ⭐ THIS IS A DIFFERENTIAL, NOT AN INTROSPECTION. It reads the keys from the PRODUCER's source and
# checks them against the BOUNDARY's declared fields. Those are two different files maintained for
# two different reasons, so agreement between them is evidence; a list introspected from either one
# alone would agree with itself by construction and could never fail.

def _producer_return_keys():
    """The literal string keys of `rate_one_spot`'s `return {...}`, read statically from source.

    Static (ast) rather than called: `rate_one_spot` is async and needs a live resolver, a DB spot
    row and a marine point. Parsing the return literal needs none of that and cannot be fooled by a
    mock that happily returns whatever it is asked for.

    ⭐⭐⭐ `**` UNPACK KEYS ARE COUNTED, AND THAT OMISSION IS WHY THIS GUARD ONCE SHIPPED BLIND
    (MASTER-AUDIT-10.0 §1.5). In `ast.Dict`, a `**x` entry stores `key = None` — so the original
    `{k.value for k in keys if isinstance(k, ast.Constant)}` could not see ANY key added by
    dict-unpacking. That matters here more than anywhere, because `**({"f": v} if v else {})` is
    precisely how this repo expresses "absent unless it binds" — the idiom used by
    `forecast_confidence` (`spot_ratings.py:272`), which was returned by the producer, undeclared on
    the model, and invisible to this extractor at the same time.

    ⚠️ The docstring below already NAMED `**spread` as a restructuring that should force a
    re-derivation, and the `>= 10` floor was supposed to detect it — but there are 17 literal keys,
    so the floor had seven keys of slack and could never fire. **A floor that cannot be reached is
    not a guard.** The floor is now pinned just under the real count.
    """
    import ast
    import inspect

    from services.weather_pipeline import spot_ratings

    def _spread_keys(value):
        """Keys that `**value` contributes AT THIS LEVEL.

        ⚠️ DELIBERATELY NOT `ast.walk` (fixed 2026-08-09). Walking descends into nested dict
        VALUES and reports their inner keys as though they were top-level payload fields. The
        moment a spread carried a nested dict — `**({"inputs": {"wind_ms": ...}} if s else {})` —
        the guard demanded that `wind_ms`, `offshore_hs_m` … be declared on SpotRatingItem, when
        the only key crossing the boundary is `inputs`. A guard that reports keys the producer
        does not emit fails the same way as one that misses keys it does: it stops being read.
        Structural recursion instead: dict → its own keys; `X if c else Y` → both branches.
        """
        if isinstance(value, ast.Dict):
            return _keys_of(value)
        if isinstance(value, ast.IfExp):
            return _spread_keys(value.body) | _spread_keys(value.orelse)
        raise AssertionError(
            "SETUP BROKEN: `**%s` in rate_one_spot's return is not a dict literal or a conditional "
            "between two dict literals, so this extractor cannot see which keys it contributes — "
            "and an unseen key is exactly the defect this guard exists to catch. Re-derive the "
            "extractor rather than letting it silently return a short list."
            % type(value).__name__)

    def _keys_of(dict_node):
        """Constant string keys of an ast.Dict, INCLUDING those inside `**` unpacked sub-dicts."""
        found = set()
        for key, value in zip(dict_node.keys, dict_node.values):
            if key is None:
                found |= _spread_keys(value)
            elif isinstance(key, ast.Constant) and isinstance(key.value, str):
                found.add(key.value)
        return found

    tree = ast.parse(inspect.getsource(spot_ratings))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "rate_one_spot":
            for sub in ast.walk(node):
                if isinstance(sub, ast.Return) and isinstance(sub.value, ast.Dict):
                    return _keys_of(sub.value)
    return set()


# The real count at the time this floor was set. A floor far below the true count (the old `>= 10`
# against 17 literal keys) cannot detect the restructuring it exists to detect — see §1.5.
_PRODUCER_KEY_FLOOR = 17


# The keys `rate_one_spot` ITSELF must return. A subset of PROVENANCE_FIELDS: `confirmed` and
# `raw_score` are stamped later by the observation gate (`apply_gate_to_frames`), not by the
# producer, so requiring them here would fail for the wrong reason.
PRODUCER_MUST_RETURN = [
    "limiter", "limiter_f", "geometry_readiness", "run_time", "wind_run_time",
    "directional_conflict",
]


def test_every_key_the_producer_returns_is_declared_on_the_model():
    """The guard that would have caught `limiter` WITHOUT anyone remembering to list it."""
    produced = _producer_return_keys()

    # SETUP ASSERTION: a parse that found nothing would pass this test having tested nothing —
    # the 'green and ran nowhere' failure mode. Pin a floor and a known member.
    assert len(produced) >= _PRODUCER_KEY_FLOOR, (
        f"SETUP BROKEN: parsed only {len(produced)} keys from rate_one_spot's return literal "
        f"({sorted(produced)}). The function was probably restructured (multiple returns, a dict "
        f"built incrementally, or **spread) — re-derive this extractor rather than trusting it."
    )
    assert "score" in produced and "limiter" in produced, (
        f"SETUP BROKEN: parsed keys do not look like the rating payload: {sorted(produced)}"
    )

    declared = set(SpotRatingItem.model_fields)
    dropped = produced - declared

    assert not dropped, (
        f"{sorted(dropped)} — returned by `rate_one_spot` and NOT declared on `SpotRatingItem`, so "
        f"Pydantic will drop {'them' if len(dropped) > 1 else 'it'} silently at the response "
        f"boundary. The producer will look correct, health will report the right SHA, and the "
        f"field will be absent from every response. This is the 6da4c16e / e8b38e42 defect."
    )


@pytest.mark.parametrize("field", PRODUCER_MUST_RETURN)
def test_the_producer_still_returns_each_contracted_field(field):
    """THE OTHER DIRECTION — and a mutation caught this hole, not the colour green.

    The differential above compares `produced - declared`, so it fires when a field is ADDED to the
    producer and never declared. It is BLIND to the reverse: delete `"directional_conflict": _conflict`
    from `rate_one_spot` and `produced` merely shrinks, `dropped` stays empty, and every test above
    stays green — because the model still declares the field, it is Optional, and it simply becomes
    `None` on every spot forever. That is the SAME shipped-inert defect approached from the other
    side, and the fixture-based tests cannot see it either: `_item()` is hand-written, so it proves
    what the MODEL accepts, never what the PRODUCER sends.

    Measured: mutant M2 survived the first version of this suite. This assertion is what kills it.
    """
    produced = _producer_return_keys()
    assert len(produced) >= _PRODUCER_KEY_FLOOR, (
        f"SETUP BROKEN: parsed only {len(produced)} keys — see the note above")
    assert field in produced, (
        f"`rate_one_spot` no longer returns '{field}'. The model still declares it, so it will "
        f"serialise as null on every spot and nothing else in this suite will notice."
    )


def test_the_chokepoint_guard_actually_detects_a_dropped_key__THE_CONTROL():
    """MUTATION: an undeclared key MUST be reported. Without this the assertion above could be
    vacuous (e.g. if `_producer_return_keys` silently returned a subset of what is declared)."""
    produced = _producer_return_keys() | {"a_key_the_model_never_declared"}
    dropped = produced - set(SpotRatingItem.model_fields)
    assert dropped == {"a_key_the_model_never_declared"}, (
        "the differential failed to flag an undeclared producer key — it is not testing the "
        "boundary it claims to test"
    )


def test_a_nested_dict_inside_a_spread_does_not_leak_its_inner_keys():
    """REGRESSION (2026-08-09): `**({"inputs": {...}} if sampled else {})` made the extractor
    demand that every INNER key of `inputs` be declared on SpotRatingItem. Only `inputs` crosses
    the boundary. A guard that reports keys the producer never emits gets muted like any other
    false alarm -- so the false-positive direction is pinned as tightly as the false-negative one
    (which THE_CONTROL above pins)."""
    produced = _producer_return_keys()
    assert "inputs" in produced, "the sampled inputs payload must still be VISIBLE to the guard"
    for inner in ("offshore_hs_m", "swell_from_deg", "wind_ms", "wind_from_deg",
                  "shore_normal_deg", "break_depth_m"):
        assert inner not in produced, (
            "%r is nested inside `inputs`; reporting it as a top-level producer key would demand a "
            "declaration for a field that never reaches the response boundary" % inner)
