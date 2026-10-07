# Repeated water-mask painting: measured hotspot, open cause

## 2026-10-07 02:12Z — live receipt and offline isolation

PR250 is qualified and served on dev26a1cc8b. One paused GFS Waves observation
tripped the existing fallback at1FPS after12low-FPS windows. Over17.987s:

| CPU boundary | Calls | Total CPU milliseconds |
| --- | ---: | ---: |
| Whole wave custom callback | 18 | 95.6 |
| Engine draw within callback | 18 | 77.2 |
| Wave data update | 2 | 78.1 |
| Regional mask refresh | 21 | 4268.2 |
| Overlay mask refresh | 21 | 3668.8 |
| Water-mask painting | 22 | 4038.3 |
| Mask feature query | 22 | 96.7 |
| Base mask canvas | 22 | 107.9 |
| Mask upload helper | 22 | 11.7 |

These boundaries overlap. In particular, the regional path may delegate to the
overlay path; their totals must not be added. The painting mean is183.6ms per
call, while the callback mean is5.3ms. Eighteen delivered long tasks total4196ms,
maximum737ms. All18measured callback entries were visible and focused. Zero
delivered long-animation-frame entries does not exclude stalls. These are CPU
durations, including possible driver waiting, and do not measure GPU completion,
the whole MapLibre frame or every operation between wave callbacks.

The diagnostic bundle was main.3de9efe1.js. Playback stayed paused; no scrubbing,
parallel forecast scene or local build/test ran during the observation. Waves
were switched off and read back as aria-pressed=false; the owned tab was closed.
Post API health was healthy at01:59:32.6924738Z on the matching merge revision;
data health was warn. Ledger825 fulfills813. The fallback and smoothness issue
remain open; this establishes a hotspot, not its sole cause.

## Offline native controls

A generated copy of the actual painter adds clocks around its existing stages.
Native Chrome canvases use synthetic straight and5000-vertex coasts, at512and
2048widths. Three measured paints per leg follow warm-up. No backend or GPU
rendering is used. The initial2048 controls took28.2to49ms per paint, substantially
less than the live average. Inland-water checks and pixel copies/readbacks were
material; these fixtures do not reproduce the full live cost or invalidate the
live measurement. Browser activity outside the owned fixture was not controlled.

An isolated prototype reuses one Natural Earth distance field only after exact
input-byte and dimension equality. It preserves the existing distance algorithm
and returns fresh water-dependent verdicts. It matched the unchanged source in
10633controls, perturbing water, Natural Earth pixels, dimensions and distance
thresholds, including special radii, mutated arrays and generic-array bypass.

Eight native before/after legs, three samples each, compared every final RGBA
byte with the baseline; all matched. Visible/focused start and end were recorded.
For2048 canvases, three-paint inland-stage sums changed30.2to24.3ms on the straight
coast and33.4to28.5ms on the complex coast. Whole-paint timings were mixed:
straight27/34.7/29ms versus32.9/25.5/35.6ms; complex24.8/23.9/51.9ms versus
22.2/22.2/56.4ms. This does not establish a whole-paint improvement. The prototype
remains outside the served app. All owned tabs and probe servers were closed.

[MDN's canvas guidance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
suggests reusing repeated rendering work. Our controls show why input identity,
pixel parity and measured total cost must precede adopting that advice here.

## Next discriminating work

The engine's hysteresis deliberately refuses to retain a degraded paint. A
source-query fallback or open-water damage verdict can therefore cause repeated
work on a stationary view. The live receipt did not capture which verdict or
coverage condition caused these retries; do not label that hypothesis confirmed.
The layer also handles loaded events from all sources. Trace the actual triggering
source and paint verdict before filtering events or reusing a completed paint.
Retain tile-readiness, coastline, island, inland-water and damage-healing policies.

The installed MapLibre source has a render completion event, but no matching
renderstart event. An end-to-end frame-duration instrument needs a real supported
starting boundary; pairing guessed events would create false timing evidence.

Portable reproduction: run renderer-probe/build-water-profile.py from the repo
root. It writes generated modules and loopback server into ignored visual/.
Run the pinned Node runtime on visual/inland-prototype-controls.mjs for the oracle
controls, or visual/serve-water-profile.cjs for native controls. The fixture CSP
forbids network connections. These tools are research controls, not an accepted
app optimization. Original Play/scrub, served-time, Gulf amplitude, device and
isolated staging-publication acceptance remain open. No served forecast number
or scientific flag changed.
