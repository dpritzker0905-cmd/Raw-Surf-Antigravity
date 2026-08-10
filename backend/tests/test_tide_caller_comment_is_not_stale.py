"""A stale comment on a FLAG-GATED path reads true for as long as the flag is off.

⛔ THE COST, 2026-08-10. `surf_point.py` carried "NO SERVING-PATH CALLER SUPPLIES IT YET" about
`water_level_m`. `point_surf_augment` had become that caller — it fetches `tide_norm_at` and
threads `water_level_m` into `estimate_surf_at` — but the FETCH is gated on the same
`SURF_TIDE_DEPTH` flag, so with the flag off the sentence still LOOKED true. I read it as current
fact and told the owner the flag was unmeasurable and that flipping it could not move served
heights. Both wrong.

This is the ordinary stale-doc class made durable: the usual repair for stale prose is that
someone eventually observes the behaviour contradicting it, and a flag-gated path denies them that
observation until the day the flag flips — which is exactly the day the claim matters.

The guard is a DIFFERENTIAL, deliberately: it reads the CALLER's source and the COMMENT's source,
which are two files maintained for different reasons, and fails when they disagree. A test that
only grepped the comment would agree with itself forever.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PIPE = os.path.join(_HERE, "services", "weather_pipeline")


def _src(name):
    with open(os.path.join(_PIPE, name), encoding="utf-8") as fh:
        return fh.read()


def _threads_water_level(src):
    """Does this module pass a NON-CONSTANT water_level_m into estimate_surf_at?"""
    return bool(re.search(r"water_level_m\s*=\s*_?eta\b", src)) or bool(
        re.search(r"water_level_m\s*=\s*[a-z_]+\[[\"']height_m[\"']\]", src))


def test_a_serving_caller_DOES_supply_the_water_level():
    """SETUP + the fact the comment must not contradict. If this ever goes false the wiring was
    removed, and the guard below must be re-derived rather than deleted."""
    aug = _src("point_surf_augment.py")
    assert _threads_water_level(aug), (
        "point_surf_augment no longer threads a water level into estimate_surf_at -- the tide "
        "wiring changed and every claim about it, here and in surf_point, needs re-deriving")
    assert "SURF_TIDE_DEPTH" in aug, "the fetch should still be flag-gated"


def test_surf_point_does_not_claim_there_is_no_caller():
    """THE REGRESSION. The exact sentence that misled a reader, and near-misses of it."""
    sp = _src("surf_point.py")
    lowered = sp.lower()
    for claim in ("no serving-path caller supplies it yet",
                  "no serving path caller supplies it yet",
                  "no caller supplies it yet"):
        assert claim not in lowered, (
            "surf_point.py claims no serving caller supplies water_level_m, but "
            "point_surf_augment does (flag-gated). That sentence reads TRUE while "
            "SURF_TIDE_DEPTH is off and becomes a lie the moment it is flipped -- which is "
            "precisely when someone will be reading it.")


def test_the_correction_names_the_caller_so_a_reader_can_verify_it():
    """A correction that says only "this is wrong" leaves the next reader where I was. Naming the
    caller makes the claim checkable in one grep."""
    sp = _src("surf_point.py")
    assert "point_surf_augment" in sp, (
        "the corrected comment must NAME the caller; an unnamed correction is not verifiable")


def test_the_operator_registry_describes_the_flag_without_claiming_inertness():
    """The admin registry is what an operator reads before flipping. It may say the flag is OFF and
    what it binds on; it must not tell them nothing will happen."""
    reg = os.path.join(_HERE, "routes", "admin", "surf_forecast.py")
    with open(reg, encoding="utf-8") as fh:
        src = fh.read().lower()
    idx = src.find('"surf_tide_depth"')
    assert idx != -1, "SETUP BROKEN: the flag is no longer registered"
    entry = src[idx:idx + 600]
    for phrase in ("changes nothing", "no serving caller", "not wired"):
        assert phrase not in entry, (
            "the operator registry tells whoever flips SURF_TIDE_DEPTH that it is inert; "
            "point_surf_augment threads a water level as soon as it is on")
