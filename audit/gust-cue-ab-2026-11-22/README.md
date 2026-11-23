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
| C `hatch` | static diagonal hatch over the field where G/W >= 1.5, cross-hatch where >= 2.0; 1.25 css px lines every 8 css px (12 on a phone); pans with the map | none | stays on | `window.__RAW_DISABLE_GUST_HATCH__` |
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
| C hatch | 0.99, 1.00, **4.87, 5.81** | 0.97, 0.97, **7.27, 9.19** | 1.02, 1.02, **6.17, 7.04** | 0.98, 1.00, **1.76, 2.12** | 1.01, 0.99, **2.02, 2.73** | 0.98, 1.03, **1.82, 2.18** |
| B width (level) | 1.00, 1.00, 1.13, **1.30** | 1.00, 1.00, 1.03, **1.08** | 0.99, 0.99, 1.03, **1.11** | 1.00, 1.00, 1.12, **1.31** | 0.99, 0.99, 1.03, **1.11** | 1.00, 1.00, 1.05, **1.14** |
| A flicker (pulse) | 1.18, 1.16, 1.20, 1.23 | 1.09, 1.12, 1.11, 1.13 | 0.79, 0.77, 0.77, 0.79 | 0.99, 1.00, 0.97, 1.01 | 1.14, 1.15, 1.18, 1.20 | 0.78, 0.78, 0.77, 0.86 |

- **Hatch:** 1.8x to 9.2x the no-cue signal in gusty air, and 0.97x to 1.03x in steady and 1.4 air (no false
  gustiness). Weaker on the phone because its lines are sparser (12 css px). It is plainly visible in the luminance
  sheets at 1.7 and 2.3 in every theme and size.
- **Width:** +3% to +13% coverage at 1.7, +8% to +31% at 2.3, nothing in steady air. Strongest on dark. The marks are
  plainly bolder at 2.3 in the sheets and faint at 1.7.
- **Flicker:** the ratio is flat across the bands in every cell (the steady band moves with the session). This detector
  cannot see it: the marks move, so a pixel never holds one mark for a full 1.1 s period. All three advisors said so.
  This does NOT show the flicker is invisible. By design a mark at G/W 1.7 is at most 15% dimmer at the trough, and at
  2.3 at most 35%, each on its own random phase. In the stills it is invisible; in the clips it is faint.

The sheets (`sheet-desktop.jpg`, `sheet-phone.jpg`) show each arm in luminance only, band by band, with the
full-colour screenshot beside it. The clips (`clip-<size>-<theme>.webm`, real time) show the four arms moving, in
luminance only.

## Contrast (estimate)

These estimates use the measured field luminance and WCAG non-text contrast (1.4.11, 3:1 against adjacent colours).
The hatch line reaches about 2.2:1 on dark, 1.7:1 on light and 1.7:1 on beach at today's alphas (0.30 / 0.34 / 0.34).
Reaching 3:1 would take alpha ~0.42 on dark, ~0.64 on light and ~0.70 on beach, which makes the hatch heavy. That is a
tuning choice for after the pick. The width and flicker cues change the marks' own luminance; the marks are not
re-measured here.

## Advisors (both rounds in the shared notes, GUST-CUE-AB-DESIGN-2026-11-22.md)

- Round 1 (design): Reflection and SubQ both said to drop along-flow lengthening (length already reads as speed) and to
  widen across the flow instead; that became B. Both kept hatch at 1.5 / 2.0 and asked for 12 px spacing on a phone.
  LongCat failed with a network error (not retried).
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
