"""THE SCIENCE REGISTRY GUARD.

The defect this exists to catch: `GAMMA_MAX_STEEP = 1.25` carried a docstring citing Weggel (1972)
and Kaminsky (1994) -- both real papers -- while sitting 54% above the highest breaker index ever
measured in the field. A citation is not a range check, and prose is not executable.

So this guard is BEHAVIOURAL wherever it can be: it imports the real modules and compares the real
attributes, and it probes `breaker_type` by CALLING it across its boundaries rather than reading a
literal. A substring assertion would have passed against every version of this file.

The out-of-range set is a SHRINK-ONLY RATCHET, the same shape as the LOC gate: today's debt is
listed with a reason, and any NEW out-of-range constant fails the build.
"""

import importlib

import pytest

from services.weather_pipeline import science_registry as SR


# The debt as measured 2026-08-05. This set may SHRINK, never grow.
KNOWN_OUT_OF_RANGE = {
    "GAMMA_MIN",          # 0.62 vs Carini spilling floor 0.63 -- rounding-scale, clamp floor only
    "GAMMA_MAX",          # 1.05 vs field plunging max 0.81
    "GAMMA_MAX_STEEP",    # 1.25 vs field plunging max 0.81 -- the big one, owner decision pending
}

# registry name -> (module, attribute) for constants that ARE a live module-level value.
# A constant absent here must be status=UNVALIDATED (i.e. an explicitly declared gap).
WIRED = {
    "GAMMA": ("services.weather_pipeline.surf_transform", "GAMMA"),
    "GAMMA_MIN": ("services.weather_pipeline.surf_transform", "GAMMA_MIN"),
    "GAMMA_MAX": ("services.weather_pipeline.surf_transform", "GAMMA_MAX"),
    "GAMMA_MAX_STEEP": ("services.weather_pipeline.surf_transform", "GAMMA_MAX_STEEP"),
    "H110_OVER_HS": ("services.weather_pipeline.surf_height_convention", "H110_OVER_HS"),
}


def test_registry_is_not_empty():
    """A registry that silently emptied would make every other test in this file vacuous."""
    assert len(SR.all_constants()) >= 8


def test_wired_constants_match_their_live_module_value():
    """THE ANTI-DRIFT CHECK. If someone retunes a constant and forgets the registry, the registry
    becomes a lie -- which is worse than no registry, because it reads as verified provenance."""
    checked = 0
    for name, (mod_path, attr) in WIRED.items():
        mod = importlib.import_module(mod_path)          # an ImportError here MUST fail, not skip
        assert hasattr(mod, attr), "%s.%s no longer exists -- registry is stale" % (mod_path, attr)
        live = getattr(mod, attr)
        assert live == pytest.approx(SR.value(name)), (
            "%s: registry says %r, %s.%s is %r. Update the registry AND re-check the published "
            "range -- a retune can move a constant out of its source's evidence."
            % (name, SR.value(name), mod_path, attr, live))
        checked += 1
    assert checked == len(WIRED), "expected to verify %d constants, verified %d" % (len(WIRED), checked)


def test_every_constant_is_either_wired_or_declared_unvalidated():
    """No constant may sit in the registry implying it is live when nothing reads it. That is how
    `SWELL_SPREAD_EXPONENT_S` was caught on 2026-08-05: registered against surf_rating, which does
    not implement cos-2s at all."""
    for name, c in SR.all_constants().items():
        if name in WIRED:
            continue
        assert c.status in (SR.UNVALIDATED, SR.IN_RANGE, SR.DERIVED), (
            "%s is not wired to a module attribute, so it must not claim %s" % (name, c.status))


def test_out_of_range_set_is_a_shrink_only_ratchet():
    """A NEW constant outside its own source's observed range fails here. That is the whole point."""
    actual = set(SR.out_of_range_names())
    added = actual - KNOWN_OUT_OF_RANGE
    assert not added, (
        "NEW out-of-range science constant(s): %s. A constant whose value sits outside what its "
        "own source observed needs either a different value or a different source. If it is "
        "genuinely intended debt, add it to KNOWN_OUT_OF_RANGE with the measurement that justifies "
        "it." % sorted(added))
    removed = KNOWN_OUT_OF_RANGE - actual
    assert not removed, (
        "%s is no longer out of range -- good. Remove it from KNOWN_OUT_OF_RANGE so the ratchet "
        "tightens." % sorted(removed))


def test_out_of_range_constants_carry_a_measured_debt_reason():
    """Debt without a reason is indistinguishable from an accident."""
    for name in SR.out_of_range_names():
        c = SR.get(name)
        assert len(c.debt_reason) >= 80, "%s needs a real debt_reason, got %r" % (name, c.debt_reason)
        assert c.published_range is not None, "%s claims out_of_range with no range" % name


def test_published_ranges_are_well_formed_and_actually_bracket():
    """lo <= hi, and in_published_range() agrees with the declared status."""
    for name, c in SR.all_constants().items():
        if c.published_range is None:
            assert c.status in (SR.UNVALIDATED, SR.DERIVED)
            continue
        lo, hi = c.published_range
        assert lo <= hi, "%s has an inverted range %r" % (name, c.published_range)
        inside = SR.in_published_range(name)
        if c.status == SR.OUT_OF_RANGE:
            assert inside is False, "%s is marked OUT_OF_RANGE but %g is inside %r" % (
                name, c.value, c.published_range)
        elif c.status == SR.IN_RANGE:
            assert inside is True, "%s is marked IN_RANGE but %g is outside %r" % (
                name, c.value, c.published_range)


def test_provenance_names_source_method_and_sample():
    """The sim renders this to a user. A number with no provenance is how 1.25 survived."""
    for name in SR.all_constants():
        p = SR.provenance(name)
        c = SR.get(name)
        assert c.source.split()[0] in p and c.method in p and c.units in p
        assert str(c.value) in p or ("%g" % c.value) in p


def test_breaker_type_boundaries_match_the_registered_thresholds_BEHAVIOURALLY():
    """Probe the real classifier across its boundaries instead of reading a literal.
    A mutation of either threshold changes an OUTPUT here, which a substring guard could not see."""
    from services.weather_pipeline.surf_transform import breaker_type

    lo = SR.value("IRIBARREN_SPILLING_PLUNGING")   # 0.5
    hi = SR.value("IRIBARREN_PLUNGING_SURGING")    # 3.3
    eps = 1e-6

    assert breaker_type(lo - eps) == "spilling"
    assert breaker_type(lo + eps) == "plunging"
    assert breaker_type(hi - eps) == "plunging"
    assert breaker_type(hi + eps) == "surging"
    assert breaker_type(None) == "unknown"          # the refuse-rather-than-guess path


def test_gamma_ordering_is_physical():
    """min < reference < max < steep-max. A retune that crosses these is a sign error, not a tune."""
    assert SR.value("GAMMA_MIN") < SR.value("GAMMA") < SR.value("GAMMA_MAX") < SR.value("GAMMA_MAX_STEEP")
