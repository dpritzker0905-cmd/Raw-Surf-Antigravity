# 2026-11-12 · Fable · one-way crests (the marine "opposing motion" fix)

Branch `fable/one-way-crests`, stacked on `claude/marine-motion-direction` (#796, the diagnosis and its 36-test suite) with dev
`10b4ef4cf` merged in. Draft PR only, nothing merged. Client only: no served number, shader text, palette or markup changes, so
no SCOREBOARD row. Same lane as `log/2026-11-11-fable-layer-animation.md` (#793); that file lives on #793's branch, so this
PR's record is here.

**Owner, 2026-11-11 (relayed):** "I'm seeing opposing wave animations in all the marine layers, unless that is part of the
animation's design, to create a moving effect?"

**Diagnosis (#796, not mine):** no sign error. The orbital pitch (`__RAW_ORBITAL_PITCH__` = 2.5 px, default since 2026-07-01)
sways each dash forward under a crest and backward under a trough at 0.7-2 px/s; the dash's own drift is 0.03-0.5 px/s. So
41-49 % of the dashes move against the swell at any moment, in every marine layer and theme.

## What changed

| Change | Module | Kill switch |
|---|---|---|
| The orbital pitch default is 0: the sway branch in DRAW_VS is skipped (it is gated on the uniform), so a dash's only along-swell motion is its drift and the band sweeping over it, both toward FROM + 180 | `marineEngineDecisions.js` (`NATURAL_ANIM_DEFAULTS`), `oneWayCrests.js` (`resolveOrbitalPitch`), one line of `WebGLMarineEngine.js` | `window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true` (the 2.5 px sway, as before) |
| Under `prefers-reduced-motion` the wave-train band's phase rate takes the drift's 0.15x. The foam roll (and the sway, under the kill) ride that phase, so they slow with it | `oneWayCrests.js` (`bandMotionScale`), one line of `WebGLMarineEngine.js` | `window.__RAW_DISABLE_REDUCED_MOTION_BAND__ = true` (the band at full speed, as before) |
| The dev tuner's pitch default and Natural preset are 0, and a stored 2.5 is dropped once | `MarineAnimTuner.js` | none (dev chrome: localhost, `?tuner=1`) |

The resolution order is unchanged: an explicit `window.__RAW_ORBITAL_PITCH__` number wins (0 included), then
`__RAW_ANIM_LEGACY__` reads 0, then the default. The kill restores that order with 2.5 as the default.

**Not changed, on purpose:**
- The shader text (pinned byte for byte by `motionFixes.killSwitch.test.js`): the fix is a uniform value.
- The band, foam roll, trochoidal shape, heading jitter, density, colours: one visual variable at a time (LESSONS, the wind
  visual-change rule).
- The rating-band shimmer (surf mode, two ripples 135 degrees apart). The director marked a one-way shimmer optional. It is a
  second visual variable and its text is pinned in `marineMotionDirection.test.js` section 5; it should be its own A/B.
- `WAVES_ANIM_DOMINANT_SWELL` and its 0.35 gate: a served number, left alone.

## Evidence

- **Mechanism (unit, `oneWayCrests.test.js`):** at the diagnosis table's rows (z3 / z6 / z9) the backward share of the cycle is
  0 with the default and above 0.35 with the 2.5 px sway (positive control). Kill, explicit number and legacy orders pinned.
- **Through the real engine (offline harness, built client over `serve_synthetic.py`):** `window.__RAW_GPU__.anim.orbitalPitch`
  reads **0** by default and **2.5** with the kill set, in dark, light and beach, desktop 1280 x 800 and phone 390 x 844 dpr 3
  (`scn_crest_clips.js`, the dev tuner switched off: on 127.0.0.1 it seeds every animation global and would mask a kill).
- **Moving clips for the owner** (sway beside one-way, same view, the synthetic vortex off Mexico at z5): six animated WebP
  files, three themes x two viewports. Not in git (2-4 MB each); sent to the owner. A reduced-motion clip was NOT made: the
  harness browser hung at map load under Playwright's `reducedMotion: 'reduce'` context (not investigated), so that change
  rests on its unit tests alone. They are for the eye: nothing is measured from them.
- **Not measured:** an on-screen count of backward-moving dashes (the 41-49 % is the diagnosis's arithmetic from the shader
  constants, not a pixel measurement), and the live site.

## PR #786 checklist (the researcher's 14 items) against this change

| # | Item | Status |
|---|---|---|
| 1, 2, 13 | One convention, per partition, wrap and missing | Unchanged by this PR; established by #796 (Copernicus buoy row still OPEN there) |
| 3 | Offline direction test | #796's suite, still green with the default at 0 (section 4 now characterises the kill's sway) |
| 4 | Step under a quarter wavelength | Unchanged: band step per frame is at most 1/16 of a set (#796, H3) |
| 5 | One dominant motion per field | **This PR**, for the dashes. The surf-mode shimmer still counter-moves (not changed, see above) |
| 6, 11, 12 | c vs c_g vs Stokes; deep water | **Named in `oneWayCrests.js`:** the band is a screen-rate crest cue scaled by period with no depth term (read as deep water only); the dash drift is a VISUAL rate, neither c_g nor Stokes drift. No legend text was added (legend files are Codex-reserved) |
| 7 | Direction not by colour alone | Unchanged (motion carries it; no arrow label added) |
| 8 | Reduced motion | **This PR:** band, foam roll and sway damped with the drift. Not covered: the legacy band when `__RAW_DISABLE_CREST_LOCAL_PHASE__` is set (it reads u_time) |
| 9 | Before and after evidence | Moving clips, three themes, desktop and phone. No reference viewer was opened |
| 10 | Served numbers untouched | Yes: no height, rating, glyph or direction moves |
| 14 | Phone frame rate | See "Frame rate" below |

## Frame rate (phone profile)

Compositor frames delivered in a 7 s window, waves on at z5, phone viewport 390 x 844 dpr 3, headless Chrome with the
screencast on, NO CPU throttle, one run per cell (`scn_crest_clips.js`):

| theme | sway (kill) | one-way (default) |
|---|---|---|
| dark | 350 | 337 |
| light | 217 | 261 |
| beach | 339 | 214 |

That is 31-50 frames per second in both arms with no consistent direction: the run-to-run spread is larger than any effect.
The default does strictly less per vertex (the sway branch is skipped), so a cost is not expected. Not measured: a throttled
(mid-range) CPU profile of this change alone, and a real phone.

## Tests and gates

- +1 suite / +18 tests (`oneWayCrests.test.js`); floor fragment `.github/ci-floors.d/fable-one-way-crests.frontend.json`
  (with #796's and no others: frontend 8499 + 36 + 18).
- Both kills are in `killSwitch.inventory.test.js` (TESTED). `MarineAnimTuner.defaults.test.js` and
  `marineMotionDirection.test.js` (section 4) now expect the 0 default; section 4 keeps characterising the 2.5 px sway.
- Local: the marine suites (`oneWayCrests`, `marineMotionDirection`, `MarineAnimTuner.defaults`, `motionFixes.killSwitch`,
  `crestLocalPhase`, every `WebGLMarine*`) pass. The whole tree: 653 of 658 suites; the five failures are 5 s test timeouts and
  a Git Bash spawn timeout on this loaded Windows machine (`marineFrameStoreCrop`, `marineFrameStoreRegional`, two
  `AdminSupportDashboard` suites, `netlifyIconStoredTailScope`), in files this change does not touch. They failed again when
  re-run alone with the offline servers still up. Hosted CI is the authority.
- `check_eslint.js`: no rule over baseline. `wind-color/check.mjs`: 0 red lines. File sizes: 0 violations
  (`marineEngineDecisions.js` stays 799, `WebGLMarineEngine.js` 3199 against its 3207 baseline). Build ok.

## For the owner

- Watch the six clips: left pane is the sway (today's look), right pane is one-way. If the sea reads flatter without the
  sway, `window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true` puts it back, and `window.__RAW_ORBITAL_PITCH__ = 1` tries a half
  measure live.
- Open: a one-way rating shimmer (its own A/B); a legend line naming the motion (needs a Codex-reserved file).
