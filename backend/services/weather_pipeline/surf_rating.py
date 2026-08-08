"""
surf_rating.py — multivariable SURF-QUALITY rating (0-100 score -> 7-level rating).

Answers "how GOOD is it right now?" (not just "how big?"), as a coastal heatmap + infobox badge — the
thing a pure height layer can't tell you and the differentiator vs chart-only competitors.

Grounding: surf quality is a MULTIVARIABLE composite of breaking wave height, swell period and wind
(offshore vs onshore + speed) — the expert-judgment multivariable surf index of Espejo et al. (2014)
"Surfing wave climate variability" (Global and Planetary Change). Breaking-height physics come from the
bundled surf_transform (depth-limited breaking; Goda 2010 breaker statistics). ``math`` + a single
``os.environ`` read for the wind-gate kill switch — no file/network I/O, no numpy — so it runs
in-process on the serve-only box (cheap, per-cell + per-point) and is fully unit-testable. (Header
corrected 2026-07-26: it previously said "Pure ``math`` only"; the sibling surf_transform.py has read
env flags the same way since v3. Pass `wind_gate(..., enabled=)` explicitly to keep a call site pure.)

Model:
    rating = size_gate(surf_height) * swell_exposure(angle) * sea_clean * oversize_gate * (0.60 * wind_quality + 0.40 * period_quality)  -> 0..100
  - size_gate: there must be a rideable wave (0 when flat; saturates chest-high+). Bigger is NOT penalized
    here — a big CLEAN long-period wave is exactly what 'epic' means; wind + period grade it.
  - oversize_gate: ...until it is too big to ride. size_gate has no descending limb, so this supplies one:
    a separate multiplicative taper once the surf exceeds what the spot (or, with no local reference,
    anywhere) can hold. Inert on any ordinary day; see the block comment above oversize_gate.
  - swell_exposure: the swell ANGLE must be able to reach this coast. Head-on (swell FROM the seaward
    shore-normal) = full; grazing/along-shore = reduced; from behind the coast = blocked (->0.1 floor). Uses
    the shore-normal when known, else neutral 1.0 (no penalty).
  - wind_quality: the dominant cleanliness factor. Offshore/light grooms the face (high); onshore/strong
    is blown out (low); sideshore/cross is moderate. Uses the shore-normal when known, else speed-only.
  - period_quality: long-period groundswell is powerful + organized (high); short windswell is chop (low).
mapped to a 7-level surf-quality scale: very_poor, poor, poor_fair, fair, fair_good, good, epic.
"""
import math
import os

LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]
# (exclusive upper score bound, level) — last bucket is open-ended 'epic'.
_BUCKETS = [(14, "very_poor"), (28, "poor"), (42, "poor_fair"), (56, "fair"),
            (70, "fair_good"), (84, "good")]

MS_TO_KT = 1.943844
# ★ THE ONE knots<->m/s pair, and the reason it is DERIVED rather than written out. Every caller
# that feeds this engine holds wind in KNOTS (the wind product's own unit) and must hand it over in
# m/s, so the value makes a round trip through both constants. Four modules each carried their own
# `KT_TO_MS = 0.514444` — 1/1.943844 TRUNCATED — which round-trips to 0.999998882736 and therefore
# lands just BELOW the knots it started from. Away from a comparison edge the error is 0.0 and every
# test is green; ON one it is a full verdict. `wind_quality`'s glassy branch is a STRICT `< 3.0`, so
# 3.00 kt read glassy on those paths (1.0) and not-glassy in the engine (0.85) — good 83.0 against
# epic 92.0, the map and the sim disagreeing about the same spot-hour.
#     Measured 2026-07-31 before the change: over 30,200 live wind cells (4 hours x 8 coasts) the
#     truncated constant flipped the verdict at 0 of them — the served values carry 4 decimals
#     (27,284 of 30,200) and the flip window is 3.4e-6 kt wide. So this is a LATENT trap, not a live
#     regrade, and correcting it is inert. Deriving it keeps the round trip exact for any value of
#     MS_TO_KT, which is a stronger invariant than "the number is right".
# ⚠️ Callers should read `SR.KT_TO_MS` as an ATTRIBUTE (`from ... import surf_rating as SR`), never
# `from surf_rating import KT_TO_MS` — a from-import snapshots at import time and re-opens exactly
# the divergence this closes (the same landmine as `export {x} from './y'` in JS).
KT_TO_MS = 1.0 / MS_TO_KT

# Composite weights (wind dominates cleanliness; period grades power/organization).
W_WIND = 0.60
W_PERIOD = 0.40


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


# Rideability floor: below this breaking height there is no surfable wave ANYWHERE (ankle-high can't be
# ridden regardless of the spot) — kept ABSOLUTE. The saturation height is LOCAL (see reference_size_m).
_HMIN_RIDEABLE_M = 0.2
# Global default "fully-working" height (chest-high) used when a spot has no local size reference yet —
# makes size_score identical everywhere until per-spot climatology is supplied (backward compatible).
_DEFAULT_REF_SIZE_M = 1.2
# LOCAL-reference curve shape (USER calibration anchors, 2026-07-12: "FL 2-3 ft clean = fair; 3-4 ft+
# = fair or fair-good; Indo 2-3 ft = poor"). The local reference (the spot's p80 good-day height)
# anchors the curve MIDDLE, not its saturation: sg = _REF_ANCHOR_SCORE at h = ref, reaching 1.0 only at
# _REF_SAT_MULT × ref. Saturating AT the reference (the original design) overshot — a clean 2-3 ft FL
# day scored ~89 'good', two notches above the user's 'fair'; anchoring at 0.6 lands it ~55 'fair' on a
# perfect day, and drops big-wave spots' small days exactly as intended.
_REF_ANCHOR_SCORE = 0.6
_REF_SAT_MULT = 2.5


def size_score(surf_h_m, reference_size_m=None):
    """Rideability gate [0,1] from breaking height, calibrated to the spot's LOCAL size expectation.

    ``reference_size_m`` is the spot's own TYPICAL surfable day (median climatology). The curve is
    anchored, not saturated, at the reference: below the absolute ~0.2 m rideability floor the score is
    0 (unsurfable anywhere); it rises to _REF_ANCHOR_SCORE (0.6) at the reference and reaches 1.0 at
    _REF_SAT_MULT (2.5×) the reference — a spot's typical day rates mid-scale (fair-ish once wind/
    period multiply in), and only a well-overhead-for-THIS-spot day maxes the size factor.

    ★ TYPICAL, not "good day" (this said p80 until 2026-07-30, and the statistic was p80 to match).
    The 2.5x multiplier is what forces it: if the reference were already a GOOD day, the top of the
    scale would sit at 2.5x a good day — a once-in-years wave — and no spot could reach it. Anchored
    at the median instead, 2.5x lands on a genuinely epic-for-this-spot day. Measured on the live
    catalogue: Florida's median reference is 0.785 m, so the size factor maxes at 1.96 m = 6.4 ft,
    which is exactly where the owner places epic for Florida ("we need pumping 6-8 ft"). At p80 the
    same spot maxed at 7.8 ft and every anchor below it read a level too low.

    When
    ``reference_size_m`` is None the LEGACY global absolute curve is used unchanged (linear to 1.0 at
    1.2 m) — the live default until RATING_LOCAL_SIZE ships. Note the two branches are intentionally
    different shapes: None = absolute/legacy, supplied = local-relative (user anchors 2026-07-12).

    This is what makes surf quality RELATIVE to a spot's potential (Surfline's principle): the same
    clean 2-3 ft day reads fair in Florida (ref ~0.7 m) and poor at Pipeline (ref ~2.5 m)."""
    if surf_h_m is None or surf_h_m <= _HMIN_RIDEABLE_M:
        return 0.0
    if reference_size_m is None or reference_size_m <= _HMIN_RIDEABLE_M:
        # LEGACY absolute curve (live behavior — byte-identical).
        if surf_h_m >= _DEFAULT_REF_SIZE_M:
            return 1.0
        return _clamp((surf_h_m - _HMIN_RIDEABLE_M) / (_DEFAULT_REF_SIZE_M - _HMIN_RIDEABLE_M), 0.0, 1.0)
    ref = reference_size_m
    if surf_h_m >= ref * _REF_SAT_MULT:
        return 1.0
    if surf_h_m >= ref:
        return _clamp(_REF_ANCHOR_SCORE + (1.0 - _REF_ANCHOR_SCORE) * (surf_h_m / ref - 1.0) / (_REF_SAT_MULT - 1.0),
                      _REF_ANCHOR_SCORE, 1.0)
    return _clamp(_REF_ANCHOR_SCORE * (surf_h_m - _HMIN_RIDEABLE_M) / (ref - _HMIN_RIDEABLE_M),
                  0.0, _REF_ANCHOR_SCORE)


def period_quality(tp_s):
    """Power/organization [0,1] from peak period. <=6 s = wind chop (0.40); >=15 s = clean groundswell
    (1.0); linear between. Unknown period -> neutral 0.5."""
    if tp_s is None or tp_s <= 0:
        return 0.5
    if tp_s <= 6.0:
        return 0.40
    if tp_s >= 15.0:
        return 1.0
    return _clamp(0.40 + (tp_s - 6.0) * (0.60 / 9.0), 0.40, 1.0)


def offshoreness(wind_from_deg, shore_normal_deg):
    """-1 (fully onshore) .. +1 (fully offshore), or None if either bearing is missing.

    ``shore_normal_deg`` points OUT TO SEA (seaward). Wind direction is meteorological (the direction wind
    blows FROM). Onshore wind comes FROM the sea -> its FROM-bearing ~= the seaward normal -> offshoreness
    -1. Offshore wind blows FROM the land -> FROM-bearing ~ opposite the seaward normal -> +1."""
    if wind_from_deg is None or shore_normal_deg is None:
        return None
    d = math.radians(wind_from_deg - shore_normal_deg)
    return -math.cos(d)


def wind_quality(wind_speed_ms, wind_from_deg=None, shore_normal_deg=None):
    """Cleanliness [0,1]. Glassy/light = clean (high); strong onshore = blown out (low). Uses the
    offshore/onshore component when a shore-normal is supplied (the dominant factor), else speed-only.

    Direction's effect RAMPS IN with speed (forensic fix 2026-07-12): a 5-6 kt breeze barely textures
    the face whichever way it blows — forecasting guidance puts the it-matters threshold near 6-7 kt
    ("below that it shouldn't present much of an obstacle"; Scarfe et al. review: the perfect wind is
    LIGHT offshore). Previously a 6 kt dead-onshore scored 0.175 (blown-out class) — over-penalized.
    Now the onshore/cross penalty phases in between 3 kt (glassy edge) and 12 kt (full effect);
    OFFSHORE and speed-only grading are byte-identical to before."""
    if wind_speed_ms is None or wind_speed_ms < 0:
        return 0.6  # unknown wind -> neutral
    spd_kt = wind_speed_ms * MS_TO_KT
    if spd_kt < 3.0:
        return 1.0  # glassy: clean regardless of direction
    off = offshoreness(wind_from_deg, shore_normal_deg)
    if off is None:
        # No coast orientation: grade on speed alone (conservative).
        if spd_kt <= 6.0:
            return 0.85
        if spd_kt <= 12.0:
            return 0.65
        if spd_kt <= 20.0:
            return 0.45
        if spd_kt <= 30.0:
            return 0.28
        return 0.15
    base = 0.60 + 0.40 * off  # onshore -> 0.20, cross -> 0.60, offshore -> 1.00
    dir_w = _clamp((spd_kt - 3.0) / 9.0, 0.0, 1.0)  # direction penalty phases in 3 -> 12 kt
    eff_base = 1.0 - dir_w * (1.0 - base)           # offshore (base 1.0) unchanged at every speed
    tol_kt = 8.0 + 14.0 * max(0.0, off)  # offshore tolerates more speed (~22 kt) than onshore (~8 kt)
    sf = _clamp(1.0 - max(0.0, spd_kt - 4.0) / (tol_kt * 2.0), 0.10, 1.0)
    return _clamp(eff_base * sf, 0.05, 1.0)


# ── BLOWN-OUT VETO (2026-07-26) ─────────────────────────────────────────────────────────────────────
# The composite's wind term is an ADDEND: (W_WIND*wq + W_PERIOD*pq). So `pq` alone floors the score no
# matter how bad the wind is — measured on this engine at 2.0 m head-on, DEAD onshore:
#     tp= 6 s -> 19.0    tp=12 s -> 35.0    tp=16 s -> 43.0 "fair"
# and every one of those is IDENTICAL at 16, 30, 60 and 100 kt. Worse, the ordering inverts: in a
# 100 kt onshore gale a LONGER period scores HIGHER. A blown-out day is unsurfable regardless of swell
# period, so the veto has to MULTIPLY, not be averaged in.
#
# It is keyed on the physics (onshore component x speed), NOT on `wind_quality`, because wq saturates
# hard on its own floors — onshore wq is a flat 0.0500 from 16 kt to 100 kt, so a wq-keyed gate could
# not tell a sea breeze from a hurricane.
#
# Deliberately CANNOT touch: offshore wind, cross-shore wind, unknown geometry, or anything under
# WIND_GATE_START_KT. That makes it provably inert for the user's pinned calibration anchors
# (2 m/s dead offshore), which is why those tests stay green.
WIND_GATE_START_KT = 14.0   # dead-onshore speed at which the veto begins to bite
WIND_GATE_ZERO_KT = 40.0    # dead-onshore speed at which the day is fully vetoed
_WIND_GATE_MIN_ONSHORE = 0.25   # scale thresholds by the onshore component, floored so they stay finite


def wind_gate(wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, enabled=None):
    """Multiplicative blown-out veto in [0,1]. 1.0 (inert) unless the wind is ONSHORE and strong.

    Returns 1.0 for unknown geometry, any offshore/cross component, or light wind — so it can only
    ever REMOVE score from genuinely blown-out onshore conditions. Kill: RATING_WIND_GATE=0, or pass
    `enabled=False` to keep a call site free of the environment read."""
    if enabled is None:
        enabled = os.environ.get("RATING_WIND_GATE", "1") != "0"
    if not enabled:
        return 1.0
    if wind_speed_ms is None or wind_speed_ms < 0:
        return 1.0
    off = offshoreness(wind_from_deg, shore_normal_deg)
    if off is None or off >= 0.0:
        return 1.0                      # unknown, offshore, or exactly cross-shore -> untouched
    onshore = min(1.0, max(_WIND_GATE_MIN_ONSHORE, -off))
    kt = wind_speed_ms * MS_TO_KT
    start = WIND_GATE_START_KT / onshore
    zero = WIND_GATE_ZERO_KT / onshore
    if kt <= start:
        return 1.0
    if kt >= zero:
        return 0.0
    return _clamp((zero - kt) / (zero - start), 0.0, 1.0)


# ── OVERSIZE VETO (2026-07-29) ──────────────────────────────────────────────────────────────────────
# `size_score` is monotonic non-decreasing and CLAMPS AT 1.0, so it has no descending limb. Measured on
# this engine (clean offshore wind, head-on swell, Tp 14 s, the LIVE reference_size_m=None path):
#     2 ft -> 38.8   3 ft -> 67.8   4 ft -> 97.3 "epic"
#     ... and 6 / 12 / 25 / 35 / 60 / 100 ft ALL -> 97.3 "epic", identically.
# A 35 ft closeout was rated exactly like a groomed 4 ft day at all 1,773 spots. That is a SAFETY
# defect, not just information loss.
#
# Surf quality vs size is NOT monotonic — it has an optimum and then a descending limb. Stormsurf's
# published Swell Rating System states the principle directly: "Most unobstructed sandbar and reef
# breaks become unrideable once the swell size is sufficient to start becoming rideable at Mavericks,
# as they become closed-out." Surfline's rating is likewise RELATIVE to each spot's potential — the
# same principle `reference_size_m` already encodes here.
#
# Shape: a separate MULTIPLICATIVE veto rather than a reshape of `size_score`, for the same reasons
# `wind_gate` is one — it is independently kill-switchable, independently testable, and it leaves the
# user's pinned calibration anchors (2026-07-12) provably untouched because it is inert at their sizes.
#
# THRESHOLDS, and why these numbers:
#  * LOCAL (a reference exists): the spot's own capacity scales it. `size_score` already treats
#    2.5x ref as "as good as it gets here", so the taper starts ABOVE that plateau at 3.5x and floors
#    at 6x. Cocoa Beach (ref 0.7 m) tapers 8.0 -> 13.8 ft; Pipeline (ref 2.5 m) 28.7 -> 49.2 ft;
#    Mavericks (ref 4.0 m, the REF_CLAMP_MAX_M ceiling) 46 -> 79 ft. A big-wave spot earns its ceiling.
#  * ABSOLUTE (no reference — the LIVE default today): we cannot tell a 15 ft Pipeline day from a
#    15 ft beach-break closeout, so the fail-safe is a deliberately GENEROUS ceiling that only fires
#    where it is right for every spot. Measured against production /spot-ratings on 2026-07-28,
#    428 spots across 6 regions: p50 1.28 m, p90 2.16 m, p99 2.71 m, MAX 3.73 m — nothing above 4 m.
#    And through this repo's own transform, 6 m of breaking surf needs ~5 m of offshore Hs (a genuine
#    storm swell). So 6 m is >2x the observed global extreme: inert on any ordinary day, biting only
#    where ~20 ft+ of breaking surf is beyond the paddle limit essentially everywhere.
#
# ⚠️ THE FLOOR IS NOT ZERO, DELIBERATELY. `rating_transform_grid` skips any cell scoring <= 0
# ("no rideable wave -> nothing to rate"), so a zeroing veto would ERASE the coastal rating band from
# the map on exactly the biggest swells of the year. 0.30 takes a 97.3 "epic" down to ~29 "poor_fair":
# still rendered, still honest that something big is happening, no longer calling it epic.
#
# ⚠️⚠️ BIG-WAVE SPOTS ARE FOR BIG-WAVE SURFERS — the ceiling MUST be spot-aware (owner, 2026-07-29).
# A single absolute ceiling is right for the ~97% of the catalogue that is beach and reef breaks and
# WRONG for exactly the spots people look at: an early draft of this gate knocked Mavericks from
# "epic" to "good" at 24.7 ft and to "poor_fair" at 31 ft — the days that spot exists for.
# So capacity is resolved in three tiers, most-trusted first (each falls through when unavailable):
#
#   1. `reference_size_m` — the spot's MEDIAN (p50) surfable-day breaking height. ⚠️⚠️ THIS SAID
#      "p80 good-day" until 2026-08-08 and OVERSIZE_START_MULT was chosen against THAT quantity;
#      `e3aedb06` moved REF_PERCENTILE 0.80 -> 0.50 and nothing re-derived the multiplier, so the
#      taper starts at 3.5x the TYPICAL day. ⛔ AND TIER 2 IS UNREACHABLE: coverage is 1,821/1,821,
#      and `oversize_thresholds` returns on the reference before reading `break_depth_m`. Measured
#      at Mavericks this reinstates the outcome this very paragraph says the tiering prevents —
#      24.7 ft -> "good", 31 ft -> "poor_fair", verbatim. ⚠️ Reach TODAY is ZERO (`oversize` bound
#      0 of 338 served spots, 2026-08-08T15:00Z, boreal summer): a WINTER risk, and re-deriving the
#      multiplier is an OWNER call, not a silent fix. Full measurement + the December re-run:
#      docs/runbooks/HANDOFF-2026-08-08-E-the-yardstick-was-being-replaced-underneath.md
#   2. `break_depth_m` — the ETOPO nearshore depth already resolved on every point call. A wave
#      cannot stand taller than gamma*depth, so the spot's own bathymetry bounds what it can hold.
#      Measured over all 1,773 catalogue spots (2026-07-29) this ORDERS CORRECTLY:
#         Cocoa Beach 15.1 ft < Jeffreys 23.0 < Trestles 23.8 < Uluwatu 24.3 < Pipeline 28.4
#         < Waimea 30.5 < Nazare-Norte 53.7 < Mavericks 56.6 < Jaws 62.7 < Nazare 64.0
#      ⚠️ BUT ITS TAIL IS JUNK — 39.9% of spots have no `break_depth_m` at all, and where the 15
#      arc-second grid cannot resolve a reef pass it samples the deep water outside it: Teahupo'o
#      reads 273 m deep => a 699 ft "capacity". Hence BOTH bounds below. Out-of-band readings are
#      treated as no information (fail open), never as a licence to crush a spot.
#   3. the absolute pair — used only when we know nothing about the spot.
#
# ⚠️ The absolute pair is deliberately LATE (26 ft) because tier 2 is missing on real big-wave spots
# (Puerto Escondido-Zicatela, Todos Santos, Dungeons, Mullaghmore, Punta de Lobos and Cloudbreak all
# lack `break_depth_m`). Where we cannot identify the spot, the fail-safe is to under-penalise: a
# 35 ft unknown still drops epic -> fair_good, and 46 ft+ reaches the floor.
OVERSIZE_START_MULT = 3.5      # x reference_size_m: taper begins (above size_score's 2.5x plateau)
OVERSIZE_FLOOR_MULT = 6.0      # x reference_size_m: taper reaches the floor
OVERSIZE_ABS_START_M = 8.0     # know nothing about the spot: ~26.2 ft of breaking surf
OVERSIZE_ABS_FLOOR_M = 14.0    # know nothing about the spot: ~45.9 ft of breaking surf
OVERSIZE_FLOOR = 0.30          # never 0 — see the band-erasure note above
# Tier 2 constants. GAMMA mirrors surf_transform.GAMMA (the McCowan depth-limited breaking index);
# test_oversize_gamma_mirrors_the_transform pins them together so the two cannot drift apart.
OVERSIZE_GAMMA = 0.78
OVERSIZE_CAPACITY_MULT = 0.8   # people stop riding BELOW the physical maximum the bathymetry allows
OVERSIZE_MAX_BREAK_DEPTH_M = 30.0  # deeper than any real break (Nazare 25.0, Jaws 24.5, Mavericks 22.1)
                                   # => the depth sample missed the reef; clamp rather than believe it
OVERSIZE_MIN_START_M = 4.0     # never claim "too big" below ~13 ft on bathymetry alone — a shallow
                               # (or simply wrong) depth reading must not crush an ordinary day
_OVERSIZE_TAPER_SPAN = OVERSIZE_FLOOR_MULT / OVERSIZE_START_MULT   # keep every tier's taper shape equal


def oversize_thresholds(reference_size_m=None, break_depth_m=None):
    """(start_m, floor_m) — the breaking heights where the oversize taper begins and bottoms out.

    Three tiers, most-trusted first: the spot's size climatology, else its bathymetric capacity,
    else the conservative absolute pair. See the block comment above for why, and for the measured
    evidence behind each bound."""
    if reference_size_m is not None and reference_size_m > _HMIN_RIDEABLE_M:
        return reference_size_m * OVERSIZE_START_MULT, reference_size_m * OVERSIZE_FLOOR_MULT
    if break_depth_m is not None and break_depth_m > 0:
        depth = min(float(break_depth_m), OVERSIZE_MAX_BREAK_DEPTH_M)
        start = max(OVERSIZE_MIN_START_M, OVERSIZE_CAPACITY_MULT * OVERSIZE_GAMMA * depth)
        return start, start * _OVERSIZE_TAPER_SPAN
    return OVERSIZE_ABS_START_M, OVERSIZE_ABS_FLOOR_M


def oversize_gate(surf_h_m, reference_size_m=None, enabled=None, break_depth_m=None):
    """Multiplicative CLOSEOUT veto in [OVERSIZE_FLOOR, 1.0]. 1.0 (inert) until the surf exceeds what
    the spot — or, with no local reference, anywhere — can hold.

    Bigger is still better right up to the taper: this only ever removes score from surf that is past
    the point of being rideable, and it never returns 0 (a 0 would un-render the map's rating band).
    Kill: RATING_OVERSIZE=0, or pass `enabled=False` to keep a call site free of the environment read."""
    if enabled is None:
        enabled = os.environ.get("RATING_OVERSIZE", "1") != "0"
    if not enabled or surf_h_m is None or surf_h_m <= 0:
        return 1.0
    start, floor_h = oversize_thresholds(reference_size_m, break_depth_m)
    if surf_h_m <= start:
        return 1.0
    if surf_h_m >= floor_h:
        return OVERSIZE_FLOOR
    frac = (surf_h_m - start) / (floor_h - start)          # 0 at the taper start -> 1 at the floor
    return _clamp(1.0 - (1.0 - OVERSIZE_FLOOR) * frac, OVERSIZE_FLOOR, 1.0)


# ── NON-SURFABLE PERIOD VETO (2026-07-29) ───────────────────────────────────────────────────────
# THE THIRD INSTANCE OF ONE DEFECT: an ADDITIVE term with a generous floor cannot veto anything.
# `period_quality` floors at 0.40 and enters the composite as (0.60*wq + 0.40*pq), so light offshore
# wind alone carries the score. Measured on this engine at 4 ft, clean light offshore:
#     Tp = 2 s -> 76.0 "good"    3 s -> 76.0    4 s -> 76.0    6 s -> 76.0    8 s -> 81.3
# A 2 s wave has a deep-water wavelength of ~6 m. That is ripples, and the engine called it good.
# ★ Note that merely dropping period_quality's floor to 0.0 does NOT fix it — 0.60*wq still lands
#   60 "fair_good". Only a MULTIPLICATIVE veto can express "there is no rideable wave here",
#   exactly as `wind_gate` (blown out) and `oversize_gate` (closed out) already do.
#
# ⚠️ IT MUST NOT PUNISH SHORT-WINDSWELL COASTS. The Gulf of Mexico, the Mediterranean, the Baltic
# and the Great Lakes surf 5-8 s windswell as their normal condition — that is real surf, not chop.
# So the veto is fully inert at and above 7 s and only bites below it, reaching its floor at 3 s
# where no board can catch anything. The user's pinned calibration anchors sit at 9 s and 11 s, so
# this is PROVABLY inert for them.
# ⚠️ The floor is not 0, for the same reason as oversize_gate: `rating_transform_grid` skips cells
# scoring <= 0, so a zeroing veto would punch holes in the coastal band. Kill: RATING_PERIOD_GATE=0.
PERIOD_GATE_FULL_S = 7.0     # at/above this the veto is inert — short windswell is still surf
PERIOD_GATE_FLOOR_S = 3.0    # at/below this nothing is rideable
PERIOD_GATE_FLOOR = 0.25     # never 0 (band-hole guard)


def period_gate(tp_s, enabled=None):
    """Multiplicative veto in [PERIOD_GATE_FLOOR, 1.0] for periods too short to carry a rideable
    wave. 1.0 (inert) for unknown period and for anything at/above PERIOD_GATE_FULL_S."""
    if enabled is None:
        enabled = os.environ.get("RATING_PERIOD_GATE", "1") != "0"
    if not enabled or tp_s is None or tp_s <= 0:
        return 1.0                              # unknown period -> no opinion (never invent a veto)
    if tp_s >= PERIOD_GATE_FULL_S:
        return 1.0
    if tp_s <= PERIOD_GATE_FLOOR_S:
        return PERIOD_GATE_FLOOR
    frac = (tp_s - PERIOD_GATE_FLOOR_S) / (PERIOD_GATE_FULL_S - PERIOD_GATE_FLOOR_S)
    return _clamp(PERIOD_GATE_FLOOR + (1.0 - PERIOD_GATE_FLOOR) * frac, PERIOD_GATE_FLOOR, 1.0)


def swell_exposure(swell_from_deg, shore_normal_deg):
    """Swell-ANGLE factor [0..1]: can this swell actually reach the coast, head-on or grazing? ``shore_normal_deg``
    points OUT TO SEA; a swell whose FROM-bearing aligns with it arrives head-on (best energy). Beyond ~90° off
    the shore-normal the swell travels along/behind the coast and can't build a rideable wave. Softened incidence
    projection (refraction bends swell shore-normal, so gentler than a hard cosine) with a small floor so coarse
    shore-normal noise can't fully zero a real swell. Returns 1.0 when geometry is unknown (no penalty)."""
    if swell_from_deg is None or shore_normal_deg is None:
        return 1.0
    align = math.cos(math.radians(swell_from_deg - shore_normal_deg))  # +1 head-on, 0 at 90°, -1 from behind
    return _clamp(0.10 + 0.90 * max(0.0, align), 0.0, 1.0)


# ── PARTITION-AWARE factors (rating plan Step 3) ────────────────────────────────────────────────────
# Every model already ingests the full swell partitions (swell_1/swell_2/wind_waves, each with height +
# direction + period) but the composite historically saw only the TOTAL field — one blended mean period
# + one mean direction. These helpers consume a ``partitions`` list of {h, tp, dir, kind} dicts (kind:
# 'swell' for SW1/SW2, 'windsea' for WW; every key None-safe) and are BACKWARD-COMPATIBLE: with
# partitions absent/degenerate each returns None/neutral and the caller keeps the total-field behavior.

SEA_CLEAN_K = 0.5          # windsea-fraction penalty slope (fraction 0.8+ reaches the floor)
SEA_CLEAN_FLOOR = 0.6      # sea state REFINES the rating; even a fully windsea sea never zeroes it


def dominant_swell_period(partitions):
    """The period of the most ENERGETIC swell train (h² weighting; wind waves excluded) — the
    surf-relevant period. A 16 s groundswell hiding under an 8 s windsea currently reads ~11 s blended;
    this recovers the 16 s. None when no swell partition carries height+period (caller falls back to
    the total field's period)."""
    best_e = 0.0
    best_tp = None
    for p in partitions or []:
        if not isinstance(p, dict) or p.get("kind") == "windsea":
            continue
        h = p.get("h")
        tp = p.get("tp")
        if h is None or tp is None or h <= 0 or tp <= 0:
            continue
        e = h * h
        if e > best_e:
            best_e = e
            best_tp = float(tp)
    return best_tp


# ⭐⭐⭐ THE SWELL PARTITIONS MUST ACTUALLY BE THE SEA BEFORE THEY MAY SPEAK FOR IT (2026-08-03).
# This function's only guard used to be `den <= 0 -> None`, so on a windsea-dominated day it
# answered "can the swell reach this coast" from whatever slice was left — with full confidence.
# Measured live at 49 served spots, the divergence from the shipped total-field path is ENTIRELY
# concentrated where the swells are marginal: median |d exposure| 0.235 at <10% energy share vs
# 0.028 in the >60% CONTROL band. Worst case Shelly Bay — a HEAD-ON sea (exposure 1.000) vetoed to
# 0.100 by a swell carrying 6% of the energy.
# ★ 0.50 is PRINCIPLED, not fitted: a swell-only statement may speak for the sea only when the
#   swells are the MAJORITY of it. Deliberately inside the clean band rather than on the measured
#   0.30 break — n=49 at one hour is no basis for a tight constant, and refusing is one-sided:
#   `rating_factors` already falls back to the total-field value, i.e. to TODAY'S served behaviour.
# ⚠️ PRE-FLIP GATE for queue #5. SURF_PARTITIONS is OFF, so this does not run in production today.
# ⇒ FULL EVIDENCE, both control bands and the before/after A/B: tests/test_partition_exposure_energy_share.py
# Kill switch: RATING_MIN_SWELL_ENERGY_SHARE=0 restores the pre-2026-08-03 behaviour exactly.
MIN_SWELL_ENERGY_SHARE = float(os.environ.get("RATING_MIN_SWELL_ENERGY_SHARE", "0.50"))


def effective_swell_exposure(partitions, shore_normal_deg):
    """Energy-weighted swell exposure over the SWELL partitions (wind waves excluded):
    Σ(h_p² · swell_exposure(dir_p)) / Σ(h_p²). A well-angled secondary swell lifts exposure; a shadowed
    dominant swell is penalized by exactly its energy share. None when the geometry or every partition is
    unusable, OR when the swell partitions carry less than ``MIN_SWELL_ENERGY_SHARE`` of the total wave
    energy — in every case the caller falls back to the total-field exposure."""
    if shore_normal_deg is None:
        return None                      # geometry unknown -> total-field path is already neutral 1.0
    num = 0.0
    den = 0.0
    total_e = 0.0
    for p in partitions or []:
        if not isinstance(p, dict):
            continue
        h = p.get("h")
        if h is None or h <= 0:
            continue
        e = h * h
        total_e += e                     # EVERY train, windsea included — this is the whole sea
        if p.get("kind") == "windsea":
            continue
        if p.get("dir") is None:
            continue
        num += e * swell_exposure(p["dir"], shore_normal_deg)
        den += e
    if den <= 0.0:
        return None
    # ⛔ REFUSE rather than answer from a marginal slice. See the block above for the measurement.
    if total_e > 0.0 and (den / total_e) < MIN_SWELL_ENERGY_SHARE:
        return None
    return _clamp(num / den, 0.0, 1.0)


def sea_cleanliness(partitions):
    """Sea-state cleanliness [SEA_CLEAN_FLOOR..1]: penalizes a windsea-DOMINATED sea even when the local
    wind reads light/offshore — chop generated elsewhere that the wind factor can't see.
    windsea_fraction = h_WW² / Σh² over ALL partitions. Neutral 1.0 when partitions are absent or carry
    no windsea (clean groundswell)."""
    ww_e = 0.0
    tot_e = 0.0
    for p in partitions or []:
        if not isinstance(p, dict):
            continue
        h = p.get("h")
        if h is None or h <= 0:
            continue
        e = h * h
        tot_e += e
        if p.get("kind") == "windsea":
            ww_e += e
    if tot_e <= 0.0 or ww_e <= 0.0:
        return 1.0
    return _clamp(1.0 - SEA_CLEAN_K * (ww_e / tot_e), SEA_CLEAN_FLOOR, 1.0)


# Preferred tide bands (normalized tide level: 0 = low water, 1 = high water) parsed from a spot's free-text
# ``best_tide`` prior. Compound phrases first so "low to mid" wins over "low".
_TIDE_BANDS = [
    ("low to mid", (0.0, 0.60)), ("low-mid", (0.0, 0.60)), ("mid to low", (0.0, 0.60)),
    ("mid to high", (0.40, 1.0)), ("mid-high", (0.40, 1.0)), ("high to mid", (0.40, 1.0)),
    ("low", (0.0, 0.35)), ("high", (0.65, 1.0)), ("mid", (0.33, 0.67)), ("medium", (0.33, 0.67)),
]


def parse_best_tide(best_tide_text):
    """Parse a spot's free-text ``best_tide`` prior into a preferred normalized tide band (lo, hi) in 0..1
    (0 = low water, 1 = high water), or None when there's no usable LEVEL preference ('all tides', empty, or a
    trend-only note like 'incoming'/'rising'). Compound phrases match first so 'low to mid' beats 'low'."""
    if not best_tide_text or not isinstance(best_tide_text, str):
        return None
    t = best_tide_text.strip().lower()
    if not t or "all" in t or "any" in t:
        return None
    for phrase, band in _TIDE_BANDS:
        if phrase in t:
            return band
    return None


def tide_fit(tide_norm, best_tide_band):
    """Tide-quality factor [0.5..1.0]: 1.0 inside the spot's preferred band, tapering with distance outside,
    FLOORED at 0.5 — tide REFINES a rating (a wrong tide knocks it down) but never zeroes a good swell. Neutral
    1.0 when the tide level (``tide_norm``) or the preference (``best_tide_band``) is unknown."""
    if tide_norm is None or not best_tide_band:
        return 1.0
    lo, hi = best_tide_band
    dist = max(0.0, lo - tide_norm, tide_norm - hi)   # 0 inside the band; grows outside
    return _clamp(1.0 - 1.3 * dist, 0.5, 1.0)


def breaker_type_quality(xi):
    """Breaker-TYPE quality factor [0.82..1.0] from the Iribarren number ξ0 (surf_transform.iribarren).
    PLUNGING waves (hollow, powerful — ξ0 ~0.5..3.3) are the prized type → 1.0; SPILLING (mushy, ξ0<0.5) and
    SURGING/closeout (ξ0>3.3) score lower. Bounded + gentle (breaker type REFINES, never dominates). Neutral
    1.0 when ξ0 is unknown — so this is a no-op until a finer slope asset feeds a real Iribarren."""
    if xi is None:
        return 1.0
    if xi < 0.5:                                  # spilling: ramps 0.85 (ξ→0) up to 1.0 at the plunging edge
        return _clamp(0.85 + 0.30 * xi, 0.82, 1.0)
    if xi <= 3.3:                                 # plunging: the ideal
        return 1.0
    return _clamp(1.0 - 0.06 * (xi - 3.3), 0.82, 1.0)  # surging/closeout: gentle taper


def rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None,
                 tide_norm=None, best_tide=None, breaker_xi=None, reference_size_m=None, partitions=None,
                 break_depth_m=None):
    """Composite 0..100 surf-quality score:
    size_gate * swell_exposure * sea_clean * tide_fit * breaker_type * wind_gate * oversize_gate *
    (0.60*wind + 0.40*period). 0 when flat OR when the swell angle can't reach the coast. Each factor degrades gracefully to neutral when
    its geometry/inputs are unknown (no shore-normal -> speed-only wind + full exposure; no tide / no Iribarren
    -> neutral). ``reference_size_m`` calibrates the size gate to the spot's LOCAL good-day size (None ->
    global 1.2 m default, no change). ``partitions`` (list of {h, tp, dir, kind}) makes the composite
    PARTITION-AWARE: period_quality grades the dominant swell train (not the blended mean), exposure is
    energy-weighted per swell train, and a windsea-dominated sea is penalized (sea_cleanliness). None/
    degenerate -> total-field behavior, byte-identical to before."""
    f = rating_factors(surf_h_m, tp_s, wind_speed_ms, wind_from_deg, shore_normal_deg, swell_from_deg,
                       tide_norm, best_tide, breaker_xi, reference_size_m, partitions, break_depth_m)
    return f["score"]


# The nine terms of the composite, in multiplication order. `wind_period_blend` is the additive
# (0.60*wind + 0.40*period) tail — it multiplies the product like the rest, so it belongs here.
FACTOR_NAMES = ("size_gate", "swell_exposure", "sea_clean", "tide_fit", "breaker_type",
                "wind_gate", "oversize_gate", "period_gate", "wind_period_blend")


def rating_factors(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None,
                   swell_from_deg=None, tide_norm=None, best_tide=None, breaker_xi=None,
                   reference_size_m=None, partitions=None, break_depth_m=None):
    """THE composition, decomposed. Returns {score, factors, limiter, limiter_value}.

    WHY THIS EXISTS (2026-08-03). The served rating is a product of NINE terms each in [0,1], and
    the payload published only the score plus a `why` string naming height, period and wind. Those
    are three INPUTS, not the factors — so when the live catalogue topped out at 68.8 with zero
    'good', the ceiling could not be attributed. Measured that day on the real served numbers: Irita
    (2.908 m, 14.6 s, 6 kt OFFSHORE) scored 64.2, while the same conditions with ideal geometry
    score 96.2 — and **three different single inputs reproduce 64.2 equally well**: a local
    reference of ~2.3 m, a swell ~50 deg off shore-normal, or a tide at either extreme. The `why`
    string names the three things that were GOOD and hides the one that was BAD, which is why the
    rating reads as broken to anyone looking at it. A count is not an attribution.

    ★ ONE COMPOSITION, NOT TWO. `rating_score` CALLS this — it does not re-derive the product. A
      parallel decomposition that drifts from the thing it describes is exactly the second-path
      defect CLAUDE.md forbids, and `test_rating_factors.py` pins `prod(factors)*100 == score`.
    ★ `limiter` is argmin(factors): in a product, the smallest term is the one that removed the most.
      That single name is the attribution the payload was missing.

    Pure: no I/O, no env reads. Callers decide what to publish.
    """
    sg = size_score(surf_h_m, reference_size_m)
    if sg <= 0.0:
        return {"score": 0.0, "factors": {"size_gate": 0.0}, "limiter": "size_gate",
                "limiter_value": 0.0}
    ex = effective_swell_exposure(partitions, shore_normal_deg) if partitions else None
    if ex is None:
        ex = swell_exposure(swell_from_deg, shore_normal_deg)
    if ex <= 0.0:
        return {"score": 0.0, "factors": {"size_gate": sg, "swell_exposure": 0.0},
                "limiter": "swell_exposure", "limiter_value": 0.0}
    sc = sea_cleanliness(partitions) if partitions else 1.0
    tf = tide_fit(tide_norm, parse_best_tide(best_tide))
    bt = breaker_type_quality(breaker_xi)
    wq = wind_quality(wind_speed_ms, wind_from_deg, shore_normal_deg)
    ptp = dominant_swell_period(partitions) if partitions else None
    pq = period_quality(ptp if ptp is not None else tp_s)
    # `wg` MULTIPLIES so a blown-out onshore day cannot be floored up by period (see wind_gate).
    wg = wind_gate(wind_speed_ms, wind_from_deg, shore_normal_deg)
    # `og` MULTIPLIES for the mirror-image reason: `size_score` saturates at 1.0 and has no descending
    # limb, so without it a 35 ft closeout scores exactly like a groomed 4 ft day (see oversize_gate).
    og = oversize_gate(surf_h_m, reference_size_m, break_depth_m=break_depth_m)
    # `pg` MULTIPLIES for the third time on the same reasoning: an additive period term with a 0.40
    # floor let 2-second ripples score 76 "good" on light wind alone (see period_gate).
    pg = period_gate(ptp if ptp is not None else tp_s)
    blend = W_WIND * wq + W_PERIOD * pq
    score = 100.0 * sg * ex * sc * tf * bt * wg * og * pg * blend
    # ⛔⛔ NaN MUST NOT REACH THE BUCKETS, AND THE FAILURE DIRECTION IS WHY.
    # `score_to_level` maps by `score < upper`, and NaN is never `<` anything, so a NaN score falls
    # past all six buckets into the open-ended top one and renders **'epic'** — the maximum possible
    # error on a 0-100 scale, produced by an ABSENT input. Measured 2026-08-01 at HEAD, TWO input
    # paths reached it: `surf_h_m=NaN` and `tp_s=NaN` (the period route survives `size_score`, then
    # poisons `period_quality`). `+inf`/`-inf` do NOT leak — they are bounded by the gates — so a
    # positivity or self-inequality check is the wrong guard here; only `isfinite` catches both
    # shapes, and the two shapes fail in OPPOSITE directions.
    # ★ THE INVARIANT LIVES WHERE EVERY PATH PASSES, not in the callers. Today `estimate_surf`'s
    # `Hs_m != Hs_m` guard and the sim's validator both hold, so this is latent — but that is
    # exactly the distributed-guard shape the 2026-07-19 wind lesson says leaks, and a NEW caller
    # is how it comes back. None is the established sentinel: `compute_surf_rating` already returns
    # (None, 'unknown') and `score_to_level(None)` is 'unknown'.
    if not math.isfinite(score):
        return {"score": None, "factors": {}, "limiter": None, "limiter_value": None}
    factors = dict(zip(FACTOR_NAMES, (sg, ex, sc, tf, bt, wg, og, pg, blend)))
    limiter = min(factors, key=factors.get)
    return {"score": round(score, 1), "factors": factors,
            "limiter": limiter, "limiter_value": round(factors[limiter], 4)}


def score_to_level(score):
    """Map a 0-100 score to one of the 7 levels (very_poor..epic). None/NaN -> 'unknown'."""
    if score is None:
        return "unknown"
    # TERMINAL guard, deliberately redundant with `rating_score`'s. The bucket loop below is
    # `score < upper`, which NaN fails for every bucket and therefore falls through to the
    # open-ended 'epic'. This function is the LAST thing every rating surface calls — the map band,
    # the hub, the sim, the live route and the precompute all end here — so it is the one place a
    # non-finite value can be stopped no matter which producer let it through. Cheap, and it makes
    # the worst failure direction unreachable rather than merely unlikely.
    if score != score or score in (float("inf"), float("-inf")):
        return "unknown"
    for upper, name in _BUCKETS:
        if score < upper:
            return name
    return "epic"


def compute_surf_rating(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None,
                        tide_norm=None, best_tide=None, breaker_xi=None, reference_size_m=None, partitions=None,
                        break_depth_m=None):
    """Return ``(score, level)`` — score 0-100 (None if surf height missing), level in LEVELS.

    surf_h_m: nearshore BREAKING height (from surf_transform). tp_s: peak/swell period. wind_speed_ms +
    wind_from_deg: local wind (meteorological FROM). shore_normal_deg: seaward bearing (optional; enables
    offshore/onshore wind grading AND the swell-angle exposure gate). swell_from_deg: dominant swell FROM
    bearing (optional; with shore_normal gates whether the swell angle can reach the coast). tide_norm:
    normalized tide level 0..1 (optional; with best_tide applies the tide_fit factor). best_tide: the spot's
    free-text tide preference prior (optional). breaker_xi: Iribarren number (optional; applies the breaker-type
    quality factor — neutral when None). reference_size_m: the spot's local "fully-working" breaking height
    (optional; calibrates the size gate to local expectation — None keeps the global 1.2 m default).
    partitions: optional list of {h, tp, dir, kind} swell/windsea trains (kind 'swell'|'windsea') — enables
    the partition-aware factors (dominant-swell period, energy-weighted exposure, sea cleanliness); None
    keeps total-field behavior."""
    if surf_h_m is None:
        return None, "unknown"
    score = rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg, shore_normal_deg, swell_from_deg,
                         tide_norm, best_tide, breaker_xi, reference_size_m, partitions, break_depth_m)
    return score, score_to_level(score)


def rating_transform_grid(vectors, depth_fn, coastal_fn=None, width_fn=None, wind_fn=None, shore_normal_fn=None,
                          reference_fn=None, gate_fn=None):
    """In-place RATING-BAND transform of a marine grid for the surf-quality MAP overlay (the on-map
    differentiator). Per COASTAL cell: derive the breaking height (surf_transform.estimate_surf) then the
    0-100 surf-quality SCORE (compute_surf_rating, with wind + shore-normal co-sampled via the injected fns),
    and write that score into ``speed`` so the heatmap colours by QUALITY (the frontend keys the 7-level
    rating colormap off the grid's rating mode). OPEN-OCEAN cells are transparency-masked (is_valid=False) ->
    a coastal RATING BAND, exactly like surf_transform_grid.

    Injected fns keep it pure/unit-testable (no I/O): depth_fn(lat,lng)->m|None, coastal_fn(lat,lng)->bool,
    width_fn(lat,lng)->km, wind_fn(lat,lng)->(speed_ms, from_deg)|None, shore_normal_fn(lat,lng)->bearing|None,
    reference_fn(lat,lng)->m|None (the LOCAL good-day size reference — P-local band half; None per cell or
    fn absent keeps the global 1.2 m size-gate default, byte-identical to before),
    gate_fn(lat,lng,score)->score (the OBSERVATION GATE — caps good/epic unless a nearby confirmation
    unlocks them; absent = ungated, byte-identical to before; a gate error keeps the raw score).
    Returns (n_rated, n_masked). Mutates each vector: ``speed`` becomes the score, ``u``/``v`` are zeroed
    (rating is scalar — no direction arrows), and ``rating_level`` is set when the attribute exists. Truly
    flat cells (size gate 0 -> score 0) are left untouched/non-rendered (no wave to rate)."""
    from services.weather_pipeline.surf_transform import estimate_surf
    n_rated = 0
    n_masked = 0
    for vec in vectors:
        sp = getattr(vec, "speed", 0) or 0
        if sp <= 0:
            continue
        lat = getattr(vec, "lat", None)
        lng = getattr(vec, "lng", None)
        if coastal_fn is not None:
            try:
                coastal = bool(coastal_fn(lat, lng))
            except Exception:
                coastal = True
            if not coastal:
                if hasattr(vec, "is_valid"):
                    vec.is_valid = False
                # §0e ANIM-PHYS: the masked cell keeps its honest speed, but carry it in
                # phys_speed too so the frontend has ONE uniform honest-height field across
                # every cell the transform touched (rated AND masked).
                if hasattr(vec, "phys_speed"):
                    vec.phys_speed = sp
                n_masked += 1
                continue
        try:
            depth = depth_fn(lat, lng)
        except Exception:
            depth = None
        width = 0.0
        if width_fn is not None:
            try:
                width = width_fn(lat, lng) or 0.0
            except Exception:
                width = 0.0
        period = getattr(vec, "period", None)
        surf, regime = estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)
        if surf is None or regime in ("open_ocean", "calm", "unknown"):
            continue
        wind_speed = wind_from = None
        if wind_fn is not None:
            try:
                w = wind_fn(lat, lng)
                if w:
                    wind_speed, wind_from = w
            except Exception:
                pass
        shore_normal = None
        if shore_normal_fn is not None:
            try:
                shore_normal = shore_normal_fn(lat, lng)
            except Exception:
                shore_normal = None
        # The cell's wave/swell FROM bearing → swell-angle exposure gate (paired with shore_normal).
        swell_from = getattr(vec, "direction", None)
        reference = None
        if reference_fn is not None:
            try:
                reference = reference_fn(lat, lng)
            except Exception:
                reference = None
        # ⚠️ `break_depth_m` is DELIBERATELY NOT PASSED HERE. `depth_fn` supplies the SHELF depth
        # (p50 157-234 m), which is a different quantity from the nearshore break depth (p50 ~11 m) —
        # feeding it to the oversize gate would compute a capacity from the wrong depth and read as a
        # ~100 m ceiling, i.e. silently inert. The band therefore uses the climatology reference when
        # one exists and the absolute pair otherwise. A heatmap cell is a zone, not a spot.
        score, level = compute_surf_rating(surf, period, wind_speed, wind_from, shore_normal, swell_from,
                                           reference_size_m=reference)
        if score is None or score <= 0:
            continue                                   # no rideable wave -> nothing to rate
        if gate_fn is not None:
            try:
                gated = gate_fn(lat, lng, score)
                if gated is not None and gated > 0:
                    score = gated
                    level = score_to_level(score)
            except Exception:
                pass                                   # a gate error must never kill the band
        # Encode score/10 into the height channel: the marine texture packs height as clamp(h/10,0,1), and the
        # shader recovers the score as waveHeight*10 -> getRatingColor(score). Keeps the existing encode/decode
        # untouched (the rating overlay is just a different colormap on the same 0-10 channel).
        # §0e ANIM-PHYS (2026-07-14): preserve the HONEST height BEFORE the score overwrite —
        # the frontend animates crest size/drift from phys_speed so animations are identical
        # rating-on/off (the score channel only ever colors the band).
        if hasattr(vec, "phys_speed"):
            vec.phys_speed = sp
        vec.speed = round(float(score) / 10.0, 4)
        if hasattr(vec, "rating_level"):
            vec.rating_level = level
        # u/v are KEPT (2026-07-12; previously zeroed as "rating is scalar"): the frontend
        # animates wave crests/particles from the u/v motion vector, so zeroing froze every
        # animation over the rating band ("the band clamps the wave animations"). The color
        # channel is `speed` (the score); u/v carry the real swell motion under the colors.
        n_rated += 1
    return n_rated, n_masked
