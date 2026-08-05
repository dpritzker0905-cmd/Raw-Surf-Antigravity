"""THE SCIENCE REGISTRY — every physical constant in the forecast chain, with its PROVENANCE
and its PUBLISHED VALIDITY RANGE, in one machine-readable place.

WHY THIS EXISTS (2026-08-05)
---------------------------
`GAMMA_MAX_STEEP = 1.25` sat in `surf_transform.py` for weeks with a docstring citing Weggel (1972)
and Kaminsky (1994). Both citations are real. The value is still **54% above the highest breaker
index ever measured in the field** (Carini et al. 2021: plunging 0.73-0.81 over 1,600+ waves at the
Duck FRF). Nobody caught it, because the provenance lived in PROSE and prose is not checkable: a
docstring can name a source without the value being inside what that source observed.

    ***  A CITATION IS NOT A RANGE CHECK.  ***

So: constants declare their published range HERE, and `test_science_registry.py` asserts that (a) the
live value in the module still equals the registry, and (b) it sits inside the published range --
with an explicit, reasoned grandfather list so existing debt is DOCUMENTED rather than silently
tolerated, and any NEW out-of-range constant fails the build.

HOW TO USE IT
-------------
* Reading a constant for science:  `science_registry.value("GAMMA_MAX_STEEP")`
* Explaining a number to a user / the sim:  `science_registry.provenance("GAMMA_MAX_STEEP")`
* Adding a constant: add a `Constant(...)` below. The guard FAILS if a module defines a science
  constant that is not registered -- that is deliberate. Register it, with a real source.

CONVENTIONS
-----------
* `method` is how the number was OBSERVED, and it is load-bearing: FIELD beats LAB beats MODEL.
  A laboratory plane-slope regular-wave value does not automatically apply to a field significant
  wave height -- see GAMMA_MAX_STEEP's own note.
* `published_range` is what the SOURCE observed or validated, NOT what we would like to be true.
  If a source gives no range, say so with `published_range=None` and set `status=UNVALIDATED`.
* ASCII only. This file is imported by the MCP weather sim, which prints to a cp1252 stdout.
"""

from typing import Dict, NamedTuple, Optional, Tuple

# --- status vocabulary -------------------------------------------------------------------------
IN_RANGE = "in_range"            # live value sits inside the published range
OUT_OF_RANGE = "out_of_range"    # live value is outside it -- MUST carry a `debt_reason`
UNVALIDATED = "unvalidated"      # no published range exists for this quantity
DERIVED = "derived"              # our own calibration, not a published constant


class Constant(NamedTuple):
    name: str
    value: float
    units: str
    what: str                       # one line a non-specialist can read
    module: str                     # dotted path of the module that defines the live value
    source: str                     # author, year, venue
    method: str                     # "field" | "laboratory" | "reanalysis" | "model" | "owner"
    sample: str                     # n, and what the n counts
    published_range: Optional[Tuple[float, float]]
    status: str
    debt_reason: str = ""           # required when status == OUT_OF_RANGE
    applies_to: str = ""            # the wave-height convention / regime the source measured


_REGISTRY: Dict[str, Constant] = {}


def _add(c: Constant) -> None:
    if c.status == OUT_OF_RANGE and not c.debt_reason:
        raise ValueError("%s is OUT_OF_RANGE and must carry a debt_reason" % c.name)
    _REGISTRY[c.name] = c


# --- depth-limited breaking --------------------------------------------------------------------

_add(Constant(
    name="GAMMA",
    value=0.78,
    units="dimensionless (H_b / h_b)",
    what="Reference depth-limited breaker index used when the period is unknown.",
    module="services.weather_pipeline.surf_transform",
    source="McCowan (1894) solitary-wave limit; ubiquitous in coastal engineering",
    method="theory",
    sample="analytic",
    published_range=(0.73, 0.83),
    status=IN_RANGE,
    applies_to="regular / solitary waves",
))

_add(Constant(
    name="GAMMA_MIN",
    value=0.62,
    units="dimensionless",
    what="Floor of the period-dependent breaker index: short-period windchop breaks low and mushy.",
    module="services.weather_pipeline.surf_transform",
    source="Carini et al. (2021), J. Geophys. Res. -- spilling breakers",
    method="field",
    sample="413 spilling waves of 1,600+ observed, Duck FRF (LIDAR + infrared)",
    published_range=(0.63, 0.71),
    status=OUT_OF_RANGE,
    debt_reason=(
        "0.62 is 1.6% below Carini's observed spilling floor of 0.63 -- a rounding-scale gap, not a "
        "physical claim. Harmless today: it is a CLAMP FLOOR, so it binds only when the period "
        "adjustment would push lower still. Tighten to 0.63 whenever the clamp ladder is next "
        "touched."),
    applies_to="individual waves at onset of breaking",
))

_add(Constant(
    name="GAMMA_MAX",
    value=1.05,
    units="dimensionless",
    what="Ceiling of the period-dependent breaker index when NO bottom slope is supplied.",
    module="services.weather_pipeline.surf_transform",
    source="Carini et al. (2021) plunging 0.73-0.81; Goda (2010) reanalysis",
    method="field",
    sample="111 plunging waves at Duck FRF; Goda: multi-source field + laboratory reanalysis",
    published_range=(0.73, 0.81),
    status=OUT_OF_RANGE,
    debt_reason=(
        "30% above the highest FIELD-observed plunging index. Inherited from the pre-2026 chain and "
        "entangled with SURF_HEIGHT_H110: see GAMMA_MAX_STEEP's note -- the correct pairings are "
        "(H110 off, gamma ~0.8) or (H110 on, gamma ~1.0), never a free choice of both."),
    applies_to="individual waves at onset of breaking",
))

_add(Constant(
    name="GAMMA_MAX_STEEP",
    value=1.25,
    units="dimensionless",
    what="Ceiling of the breaker index when a bottom slope IS supplied (steep-reef plunging).",
    module="services.weather_pipeline.surf_transform",
    source="Carini et al. (2021) JGR; Goda (2010) Coastal Eng. J.; Chin (2022) Water Sci. Eng.",
    method="field",
    sample="Carini: 1,600+ waves, Duck FRF. Chin: basin experiments, oblique incidence 15-30 deg.",
    published_range=(0.73, 0.81),
    status=OUT_OF_RANGE,
    debt_reason=(
        "*** 54% ABOVE the highest field-observed plunging index (0.81). *** Three independent "
        "sources bound it lower, not higher: (1) Carini 2021 field, plunging 0.73-0.81. (2) Goda "
        "2010: incipient breaking of the SIGNIFICANT wave is ~30% BELOW the regular-wave value, and "
        "this cap is applied to Hs while Weggel/Kaminsky are regular-wave plane-slope LABORATORY "
        "data. (3) Chin 2022: oblique incidence breaks at gamma ~0.67, well under normally-incident "
        "predictions; most real spots take oblique swell. "
        "MEASURED IMPACT 2026-08-05: production serves Pipeline at 12 m/18 s as 45.5 ft; a "
        "defensible ceiling gives 31.0 ft. Changing it moves 1 of 8 anchor/big cases and NOTHING "
        "else -- gamma binds only where the depth cap binds, so it is ORTHOGONAL to "
        "SURF_HEIGHT_H110 (measured: disjoint sets), NOT a cancelling pair. "
        "OWNER DECISION -- see docs/research/SCIENCE-2026-08-05-*.md"),
    applies_to="Hs (significant height) -- but the sources measured individual/regular waves",
))

_add(Constant(
    name="WEGGEL_SLOPE_VALIDITY_HI",
    value=0.07,
    units="dimensionless (bed slope m = tan beta)",
    what="Upper bed slope at which Weggel-class breaker-index formulas are still validated.",
    module="services.weather_pipeline.surf_transform",
    source="Camenen & Larson (2007), Predictive Formulas for Breaker Depth Index and Breaker Type",
    method="laboratory",
    sample="524 cases collected from 22 published sources",
    published_range=(0.01, 0.07),
    status=IN_RANGE,
    debt_reason="",
    applies_to=(
        "PLANE BEACH slopes. Camenen & Larson: predictions are 'typically not satisfactory' above "
        "m > 0.1. Our live _slope_proxy = depth_m/(shelf_width_km*1000) is a SHELF-scale quantity, "
        "not a beach slope; bathymetry.bed_slope_at is the nearshore partner. Measured 2026-08-05: "
        "Teahupoo 0.156 and Uluwatu 0.129 exceed 0.1 even with the real asset -- 2 of 10 anchors "
        "are outside the formula's evidence base whichever slope is fed."),
))

# --- wave height conventions -------------------------------------------------------------------

_add(Constant(
    name="H110_OVER_HS",
    value=1.27,
    units="dimensionless",
    what="Ratio H(1/10) / H(1/3). Governs SURF_HEIGHT_H110, the 'surfer-reported height' convention.",
    module="services.weather_pipeline.surf_height_convention",
    source="Rayleigh distribution of wave heights; Goda (2010) surf-zone reanalysis",
    method="theory + field",
    sample="Goda: multi-source; ratio departs from Rayleigh inside the surf zone",
    published_range=(1.25, 1.30),
    status=IN_RANGE,
    applies_to=(
        "DEEP water Rayleigh statistics. Goda: H1/10, H1/3 and Hrms relative to Hm0 all INCREASE "
        "with nonlinearity toward the outer surf zone, so 1.27 is a deep-water figure applied "
        "nearshore. MEASURED 2026-08-05: flipping SURF_HEIGHT_H110 alone moves the served height "
        "+27.0% on 7 of 8 anchor cases (memory recorded +25.5%; replicates)."),
))

# --- directional exposure ----------------------------------------------------------------------

_add(Constant(
    name="SWELL_SPREAD_EXPONENT_S",
    value=10.0,
    units="dimensionless (s in cos^2s(phi/2))",
    what="Directional spreading exponent for a wind-sea/swell spectrum.",
    module="scripts.directional_exposure_science",   # NOT WIRED -- research script only
    source="Longuet-Higgins et al. (1963) cos-2s model; Mitsuyasu et al. (1975)",
    method="field",
    sample="pitch-and-roll buoy observations",
    published_range=(5.0, 25.0),
    status=UNVALIDATED,
    debt_reason="",
    applies_to=(
        "*** NOT IMPLEMENTED IN THE SERVED CHAIN. *** Verified 2026-08-05: cos-2s appears ONLY in "
        "scripts/directional_exposure_science.py. The live chain uses surf_rating.swell_exposure "
        "and surf_transform._height_exposure_factor, neither of which is spectral. Registered here "
        "so the gap is VISIBLE rather than assumed-done. The science: a real sea is a SPECTRUM, so "
        "flux at delta-theta = 100 deg is ~0.013 of head-on versus our flat 0.100 quality floor -- "
        "the floor is GENEROUS and 37-deg-past spots are correctly floored."),
))

# --- breaker type (Iribarren / surf similarity) -------------------------------------------------

_add(Constant(
    name="IRIBARREN_SPILLING_PLUNGING",
    value=0.5,
    units="dimensionless (xi_0 = tan(beta) / sqrt(H0/L0))",
    what="Surf-similarity boundary between spilling and plunging breakers.",
    module="services.weather_pipeline.surf_transform",   # breaker_type(); gated RATING_BREAKER_TYPE
    source="Okazaki & Sunamura (1991), J. Coastal Research",
    method="laboratory",
    sample="150 wave-flume runs, slopes 1/20 to 1/0.5",
    published_range=(0.4, 0.6),
    status=IN_RANGE,
    applies_to=(
        "Uniformly inclined laboratory beaches, regular waves. Companion boundaries from the same "
        "study: plunging/collapsing xi_0 = 2.5, collapsing/surging xi_0 = 3.7. "
        "*** CONTESTED -- READ BEFORE ENABLING RATING_BREAKER_TYPE. *** Two independent studies "
        "find xi_0 is NOT a sufficient classifier: Moragues et al. (2020, JMSE, 1:10 slope) -- 'the "
        "Iribarren number was not sufficient to predict the expected type of wave breaker... except "
        "for spilling and early plunging, no biunivocal relationship'; Diaz-Carrasco et al. (2020, "
        "Coastal Eng.) -- 'there is not a biunivocal relationship between Ir and the type of "
        "breaker... not a sufficient similarity parameter'. So the breaker-type QUALITY factor is "
        "trustworthy only at the spilling/early-plunging end, which is the mushy end -- the "
        "opposite of the reef spots it was built for."),
))

_add(Constant(
    name="IRIBARREN_PLUNGING_SURGING",
    value=3.3,
    units="dimensionless (xi_0)",
    what="Surf-similarity boundary above which breaking is surging/collapsing (often a closeout).",
    module="services.weather_pipeline.surf_transform",   # breaker_type()
    source="Battjes (1974) classical boundary; Okazaki & Sunamura (1991) split it in two",
    method="laboratory",
    sample="Okazaki: 150 flume runs -> plunging/collapsing 2.5, collapsing/surging 3.7",
    published_range=(2.5, 3.7),
    status=IN_RANGE,
    applies_to=(
        "Our single 3.3 collapses Okazaki's TWO boundaries (2.5 and 3.7) into one, so a "
        "'collapsing' class is not represented at all. 3.3 sits inside their bracket, which is why "
        "this is IN_RANGE rather than debt. The same 'not biunivocal' caveat as "
        "IRIBARREN_SPILLING_PLUNGING applies."),
))


# --- accessors ----------------------------------------------------------------------------------

def all_constants() -> Dict[str, Constant]:
    """The whole registry, keyed by name."""
    return dict(_REGISTRY)


def get(name: str) -> Constant:
    return _REGISTRY[name]


def value(name: str) -> float:
    return _REGISTRY[name].value


def in_published_range(name: str) -> Optional[bool]:
    """True/False, or None when the quantity has no published range."""
    c = _REGISTRY[name]
    if c.published_range is None:
        return None
    lo, hi = c.published_range
    return lo <= c.value <= hi


def out_of_range_names() -> Tuple[str, ...]:
    """Constants whose live value sits outside what their own source observed. This IS the debt
    list, and it is meant to be read -- see test_science_registry.py for the ratchet."""
    return tuple(sorted(n for n, c in _REGISTRY.items() if c.status == OUT_OF_RANGE))


def provenance(name: str) -> str:
    """One human-readable paragraph. Used by the weather sim to explain a number rather than
    merely emit it -- a number with no provenance is how GAMMA_MAX_STEEP survived."""
    c = _REGISTRY[name]
    rng = ("published range %.3f-%.3f" % c.published_range) if c.published_range else "no published range"
    line = ("%s = %g %s -- %s | source: %s (%s, %s) | %s | status: %s"
            % (c.name, c.value, c.units, c.what, c.source, c.method, c.sample, rng, c.status))
    if c.applies_to:
        line += " | measured on: %s" % c.applies_to
    if c.debt_reason:
        line += " | DEBT: %s" % c.debt_reason
    return line
