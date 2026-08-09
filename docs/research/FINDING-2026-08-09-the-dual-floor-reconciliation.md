# The dual floor, reconciled — built, graded, and left OFF

2026-08-09. Owner: "fix the exposure floor first, then move forward... test before and after."

## What the defect actually is (and it is not what the symptom looks like)

One quantity — "how much of this swell is aimed at this coast" — is modelled **twice**:

| chain | function | at the floor | implied ENERGY |
|---|---|---|---|
| quality | `surf_rating.swell_exposure` | 0.100 | 0.100 |
| height | `surf_transform._height_exposure_factor` = `0.55 + 0.45*exposure` | 0.595 | **0.354** |

`H ~ sqrt(E)` is stated in the height chain's own docstring, so the energy the height implies is
`factor**2`. The two disagree by **3.54x** past 90 deg. That is how one payload says **"9.6 ft"** and
**"2.7 very_poor"** at the same time.

⭐ **The symptom points the wrong way.** "18.9% of spot-hours are crushed to very_poor" reads as *the
score is too low*. The physics says the opposite: bracketed by real spectra (narrow swell s=70 to
broad windsea s=10), at 90 deg the onshore flux bracket is **[0.068, 0.181]** — quality's 0.100 sits
INSIDE it; height's implied 0.354 is **above both**. At 120 deg the bracket top is 0.026 against
quality's 0.100 (~4x generous) and height's 0.354 (~14x). **Both constants are too generous; the
height is far more so.** ⇒ the score is roughly right and **the height is the wrong number**.

## Before / after (measured through the live functions, not reasoned)

    dtheta   quality(E)  height  h^2     ratio        height change
      0        1.0000    1.0000  1.0000  1.000  ->  1.000     +0.0%
     45        0.7364    0.8814  0.7768  1.055  ->  1.000     -2.6%
     75        0.3329    0.6998  0.4898  1.471  ->  1.000    -17.5%
     90+       0.1000    0.5950  0.3540  3.540  ->  1.000    -46.9%

`SURF_EXPOSURE_RECONCILED=1` replaces `0.55 + 0.45*exposure` with **`sqrt(exposure)`**, so
`height**2 == exposure` **by construction** — the chains agree at *every* angle, exactly 1.000. This
is assertable as an identity rather than a tolerance because it is a law, not a fitted constant.

★ **Head-on is untouched (+0.0%)**, which is simultaneously why the owner anchors stay green and why
they cannot grade this: their own docstring says every gate is 1.0 on those anchors.

## Served reach (the gate, not the suite)

- 7-day sweep (13,166 spot-hours, 23 viewports): **18.9%** of served spot-hours pinned at the floor;
  `swell_exposure` is the binding limiter on **70%** of `very_poor`.
- Independent spot check the same day (n=361, 6 viewports): **14.7%** at the floor. Same order.
- Concrete, live: **Jeffreys Bay 9.6 ft / score 2.7 -> 5.1 ft / score 2.7.** The reconciliation does
  not raise the score; it lowers the height until the payload stops contradicting itself.

## ⛔ Why it ships OFF

1. **The height chain was calibrated with 0.595 in place** (gamma 0.81 + `REFRACTION_KR` 0.797 +
   H110). Memory's standing instruction — *height is right BY CANCELLATION* — is about that fit, and
   a -46.9% change on ~1 spot-hour in 6 is a product event, not a config edit. It needs the same
   served-delta census `RATING_LOCAL_SIZE` was held to.
2. **The spectral figures are deep-water LOWER bounds**, so they establish the DIRECTION of the error
   confidently and its MAGNITUDE only loosely.
3. ⚠️ **The floored rows cluster.** All eight largest were J-Bay variants at an identical 9.6 ft,
   which means one coordinate's shore normal is driving them. If a shore normal is wrong, the
   reconciliation makes the height wrong in a NEW way rather than fixing it. **Audit the shore
   normals at the top floored clusters before flipping.**

## What is pinned so this cannot rot

`tests/test_directional_exposure_harness.py` (10 tests):
- the legacy 3.54x disagreement stays pinned as a characterization of the default;
- the reconciled mode is asserted to be exactly 1.000 at every angle;
- **the flag is asserted OFF by default** (a kill switch that is on by accident is not a kill switch);
- the pre-existing mutation test still proves the harness can see BOTH factors move.

⇒ Turning this on is an owner decision. Everything needed to grade it now exists.
