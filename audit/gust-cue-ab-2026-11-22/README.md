# Gusts: non-colour gustiness cue A/B (2026-11-22)

The owner picks. This folder is the evidence; nothing here picks for him.

## The question

On the Gusts layer the marks move on the mean wind and are coloured by the gust speed. Gustiness itself (the gust factor
G/W = gust / max(mean wind, 2 kn)) needs a channel that is not colour (ACCESSIBILITY mandate). Today that channel is a
0.9 Hz flicker. On 2026-11-22 two advisors called the flicker noisy and a weak channel. This A/B shows it beside two
alternatives and a no-cue control. All four run from one build.

## The arms

| Arm | What the viewer sees | Motion | Reduced motion | Kill |
|---|---|---|---|---|
| A `flicker` (today, default) | where G/W 1.3 -> 2.2, a mark's brightness pulses at 0.9 Hz, up to 35% dimmer, random phase | pulses | off (the legend says so) | `window.__RAW_DISABLE_GUST_FLICKER__` |
| B `width` | where G/W 1.5 -> 2.0, marks drawn up to 1.8x wider across the flow; length (which reads as speed) unchanged | none | stays on | `window.__RAW_DISABLE_GUST_WIDTH__` |
| C `hatch` | static diagonal hatch over the field where G/W >= 1.5, cross-hatch where >= 2.0; 1.25 css px lines every 10 css px (14 on a phone), measured across the lines; on light and beach, a dark core in a 1 css px light halo; pans with the map | none | stays on | `window.__RAW_DISABLE_GUST_HATCH__` |
| D `none` | colour only (the control) | none | n/a | n/a |

The marks' motion is the same in every arm. Each arm has a one-line legend key under the Gusts gradient, in all three
layouts, with one accessible sentence (`role="note"`). See `legend-keys-desktop.jpg`.

Try it in a browser console, then pick Gusts:

```js
window.__RAW_GUST_CUE__ = 'hatch';          // or 'width' | 'flicker' | 'none'
localStorage.setItem('rawGustCue', 'hatch'); // the same, kept across reloads
```

## How it was measured (offline, never the live backend)

- Synthetic weather backend (`serve_synthetic.py --models GFS --layers waves,wind --dynamic 1`) and the dev SPA.
  Headless Chrome through `ab_lib.js`, which proxies `/api/weather/*` to the synthetic backend and stubs the rest.
- Real GFS gust frames from the public frame CDN engage the layer. A controlled gust field then replaces them:
  gust = the engine's own resident wind speed x a known factor, in four vertical bands G/W = 1.0, 1.4, 1.7, 2.3.
- For each arm x theme (dark, light, beach) x size (desktop 1440x900 DPR 1; phone 375x812 DPR 2): 150 frames (~6 s),
  read from the WebGL canvas inside MapLibre's `render` event. Each band's central crop is kept as relative luminance
  (colour removed), and split into 8 sub-patches.
- Three matched detectors run on every arm: `hatch` (2-D Fourier amplitude at the hatch frequency over mean luminance),
  `level` (mean luminance: the marks' coverage), and `pulse` (per-pixel temporal power at 0.6-1.2 Hz over 1.5-3 Hz).
- PAIRED: each detector is a ratio, cue arm over no-cue arm, on the same sub-patch. The same field and palette are
  under both arms, so the palette's own luminance differences cancel.
- Harness: `harness/` (`gustcue.js` captures, `analyze.py` scores, `make_sheet.py` and `gif2webm.py` draw the sheets
  and clips). The raw numbers are in `metrics.json`.

## Results: cue / no-cue ratio on each arm's own detector, bands [1.0 steady, 1.4, 1.7, 2.3]

| | desktop dark | desktop light | desktop beach | phone dark | phone light | phone beach |
|---|---|---|---|---|---|---|
| C hatch (cased, round 3) | 0.95, 0.99, **7.38, 9.33** | 0.97, 1.03, **9.41, 14.13** | 0.99, 0.99, **9.77, 12.40** | 0.97, 0.98, **2.63, 3.22** | 0.99, 0.99, **1.93, 2.22** | 0.97, 0.98, **2.22, 2.17** |
| B width (level) | 1.00, 1.00, 1.13, **1.30** | 1.00, 1.00, 1.03, **1.08** | 0.99, 0.99, 1.03, **1.11** | 1.00, 1.00, 1.12, **1.31** | 0.99, 0.99, 1.03, **1.11** | 1.00, 1.00, 1.05, **1.14** |
| A flicker (pulse) | 1.18, 1.16, 1.20, 1.23 | 1.09, 1.12, 1.11, 1.13 | 0.79, 0.77, 0.77, 0.79 | 0.99, 1.00, 0.97, 1.01 | 1.14, 1.15, 1.18, 1.20 | 0.78, 0.78, 0.77, 0.86 |

- **Hatch:** 1.9x to 14.1x the no-cue signal in gusty air, and 0.95x to 1.03x in steady and 1.4 air (no false
  gustiness). These are the cased hatch's numbers; its detector reads harmonics 1-3, because a cased line carries much
  of its energy there. The round-1 alpha-only hatch read 1.8x-9.2x. Weaker on the phone, where the lines are sparser
  (14 css px). Plainly visible in the luminance sheets at 1.7 and 2.3 in every theme and size.
- **Width:** +3% to +13% coverage at 1.7, +8% to +31% at 2.3, nothing in steady air. Strongest on dark. The marks are
  plainly bolder at 2.3 in the sheets and faint at 1.7.
- **Flicker:** the ratio is flat across the bands in every cell (the steady band moves with the session). This detector
  cannot see it: the marks move, so a pixel never holds one mark for a full 1.1 s period. All three advisors said so.
  This does NOT show the flicker is invisible. By design a mark at G/W 1.7 is at most 15% dimmer at the trough, and at
  2.3 at most 35%, each on its own random phase. In the stills it is invisible; in the clips it is faint.

The sheets (`sheet-desktop.jpg`, `sheet-phone.jpg`) show each arm in luminance only, band by band, with the
full-colour screenshot beside it. The clips (`clip-<size>-<theme>.webm`, real time) show the four arms moving, in
luminance only.

## Round 3 (2026-11-23): the hatch made 3:1 against every background, then tested by pattern alone

Reflection and SubQ recommended C (hatch). The director asked for 3:1 contrast against every background in every
theme, then a confirming test: grayscale, reduced motion, desktop and 375 px. The default stays `flicker` until David
has watched the candidates in motion.

**Contrast (WCAG 1.4.11, 3:1).** Backgrounds: stills with the marks switched off (harness only) and a gust RAMP of
0 -> 75 kn injected under the field, over land and sea. That is every gust colour each theme can draw: 9,622 to 10,160
distinct background colours per theme. The hatch is forced on everywhere (`contrast-stills.jpg`). A blend model
(ink x a + bg x (1 - a), on 8-bit sRGB, as the canvas blends) matched the rendered line centres to within 1.1/255.
- Raising the alpha alone works on **dark**: white reaches 3:1 at alpha 0.50.
- It **cannot** work on light or beach. Even at alpha 1.0 the worst background gives 1.67:1 (light) and 1.74:1
  (beach), because their fast-gust colours are dark, and a dark line cannot stand off a dark colour.
- So light and beach get a **cased** line: a dark core (alpha 1.0) in a 1 css px light halo (alpha 0.68 on light,
  0.72 on beach). One of the two always stands off the field. This is the casing the marks already use.

| | dark (white, alpha 0.58) | light (navy core + white halo 0.68) | beach (brown core + cream halo 0.72) |
|---|---|---|---|
| model, worst of every background | **3.53:1** (5th pct 3.78) | **3.36:1** (core vs halo >= 9.8:1) | **3.33:1** (core vs halo >= 9.8:1) |
| rendered, desktop, worst 20 px window | **4.27:1** | **3.36:1** | **3.18:1** |
| rendered, 375 px phone, worst 28 px window | **4.37:1** | **3.55:1** | **3.43:1** |

The lines are now 10 css px apart (14 on a phone), measured across the lines, to offset the extra ink. The earlier
"8 px" was measured along x, so it was really 5.7 px across. Files: `contrast/`.

**Pattern alone, grayscale, reduced motion.** Bands G/W 1.0 and 1.3 (steady), 1.6 (gusty) and 2.2 (very gusty), just
either side of the 1.5 and 2.0 thresholds. Each theme was run at desktop and at 375 px. Reduced motion came from the
app's own path (a `prefers-reduced-motion` match plus `__RAW_REDUCED_MOTION__`); every session confirmed it. 40 frames
of luminance were captured, and patches were classified at 64 px desktop and 120 px phone, 30 to 180 per band. The
classifier reads the hatch frequency along each diagonal, against a threshold calibrated **only on the no-cue arm**.
Neither diagonal on means steady, one means gusty, both mean very gusty.

| | desktop dark | desktop light | desktop beach | phone dark | phone light | phone beach |
|---|---|---|---|---|---|---|
| gusty (1.6) correct | 100% | 100% | 100% | 100% | 100% | 100% |
| very gusty (2.2) correct | 100% | 100% | 100% | 100% | 100% | 100% |
| false pattern in steady air (1.0, 1.3) | 0.3% | 0% | 0% | 0% | 0% | 0% |
| wind travel direction, hatch vs none | <= 4.3 deg | <= 3.3 deg | <= 2.9 deg | <= 1.5 deg | <= 1.4 deg | <= 1.2 deg |
| marks' contrast, hatch / none | 0.99-1.06 | 0.95-0.99 | 0.98-1.01 | 0.99-1.03 | 0.97-1.01 | 0.97-1.02 |

Notes:
- A fundamental-only classifier, written first, scored 41% and 50% on desktop light and beach. There the cross-hatch's
  fundamental nearly cancels: the dark core's and the light halos' deviations offset. The pattern is plainly visible
  (`rm-sheet-desktop.jpg`); the harmonics carry it. Both results are kept in `contrast/`.
- Direction is read from where the marks TRAVEL: the per-pixel temporal sd, which the static hatch cannot add to.
- A still-frame measure (residual after the session median) swings in two cells: desktop light at 1.6 by 78 deg, and
  desktop beach at 2.2 by 16 deg. Slow marks passing over dark lines hide and reveal the lines along the diagonal. The
  clips (`rm-clip-*.webm`) are the honest check of how direction reads.
- Playwright's own `reducedMotion: 'reduce'` emulation hung the page right after the map opened, in both arms, so the
  app-level path was used instead. Whether a real reduced-motion browser hits the same hang is not known; it needs its
  own look.

Sheets: `sheet-*.jpg` and `clip-*.webm` (all four arms, normal motion, cased hatch); `rm-sheet-*.jpg` and
`rm-clip-*.webm` (no cue vs hatch, reduced motion).

## Advisors (both rounds in the shared notes, GUST-CUE-AB-DESIGN-2026-11-22.md)

- Round 1 (design): Reflection and SubQ both said to drop along-flow lengthening (length already reads as speed) and to
  widen across the flow instead; that became B. Both kept hatch at 1.5 / 2.0 and asked for 12 px spacing on a phone.
  LongCat failed with a network error (not retried).
- Round 3 (the cue choice, public context only): Reflection and SubQ each recommended C (hatch), with the alpha raised
  to reach 3:1 first. LongCat was not asked this question; in round 2 it said to show hatch and width without picking.
  The raise is done above, with a halo where alpha alone could not reach 3:1.
- Round 2 (results): all three judged the paired measurement fair for luminance detectability, and the flicker detector
  unable to see a random-phase pulse on moving marks. LongCat and Reflection traced a 1.17-1.21x hatch leak in the 1.4
  band to the missing half-cell wind registration. That is fixed: the hatch now samples the wind exactly as the marks do,
  and the 1.4 band reads 0.97-1.03x. SubQ and Reflection flagged hatch contrast (above) and asked for a real-phone check.
  The reported WebGL1 fallback (`GL_FRAGMENT_PRECISION_HIGH`) is in place.
- LongCat's other findings did not hold. The hatch phase is in screen space, so world copies cannot seam. Both cues use
  the same `max(speed, 2 kn)` floor. `v_bold` is declared in both stages.

## Not covered

- No real phone GPU was used: the run is headless Chrome on ANGLE d3d11.
- No user task study was run.
- Panning was not recorded. The hatch phase is anchored to the map: a unit test pins that.
- The whole particle animation has no pause control (WCAG 2.2.2). That is outside this A/B.

## After the pick

The chosen cue becomes the default (`GUST_CUE_DEFAULT` in `windGustColour.js`), ON, with its kill above. The kill is
already registered in `src/tests/killSwitch.inventory.test.js`. The legend key follows the cue automatically.
