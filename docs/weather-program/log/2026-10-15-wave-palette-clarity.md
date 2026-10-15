# Marine wave-height palette clarity — local review

Owner: this wave-palette task only. Host verified as `THUNDER`.

## Contract and isolation

David authorized the separate marine WAVE map repair, beach first, light where warranted, dark unchanged.
The later clarification permits additional related colors within each theme's identity; no dark palette copy.
Worktree: `C:/Users/David/Documents/Codex/2026-10-14/task-7/raw-surf-wave-palette`.
Branch: `codex/marine-wave-palette-clarity-2026-10-14`; baseline `131d5d9e434124d9bf510edb9eed2e8238723313`.

The primary checkout's unrelated changes were preserved. Weather task `01a13844-4175-7843-b37f-aa559359e6d6`
and commerce task `01a13c89-9e19-7777-9159-7923956d60c6` received ownership/service notices through supported
task messaging. The active weather diff owned wind/F2 files and shared weather ledgers; it did not own these
marine height-color seams. Commerce's inspected checkout had no tracked diff. Neither task was interrupted.
No cherry-pick, shared browser reuse, shared service restart, live weather load, or rollout occurred.
Their acknowledgements remain pending. PR331's rollout hold remains respected.

Owned edits: `marineWavePalette.js`, the height-color entry in `WebGLMarineShaders.js` and `colorScales.js`,
and the marine-only gradient expression in `MapWeatherControls.js`, plus specifically named tests/harnesses.
No wind/F2 palette, particle shader, wave engine, direction, motion, data resolver, control handler, unit,
scientific threshold or experimental flag was edited. The control component's line count did not grow.

## Diagnosis and implemented behavior

The old beach palette compressed 2.4–5 m into similar orange/red colors. The actual GPU color function measured
weak adjacent-height differences; light also had a deutan near-collision between 1.8 and 2.4 m.
Three middle anchors per theme changed; the original metre anchor positions remain 0, 0.6, 1.2, 2.4, 5 and 10.

| Theme | 1.2 m before → after | 2.4 m before → after | 5 m before → after |
|---|---|---|---|
| Beach | `#F29966` → `#FABB6E` | `#FF6626` → `#E65F31` | `#D9400D` → `#6B1922` |
| Light | `#1F6BD9` → `#1F7DE0` | `#6B33D1` → `#571F8A` | `#D92E80` → `#F25490` |

Beach retains emerald/lagoon, sunlit apricot/coral/terracotta and its rose-white endpoint. Light retains mist,
sea green, azure, royal purple, orchid and white. Dark takes its existing path, and surf quality/rating stays
on its existing path. A shared small table generates GLSL and the JS ramp so new copies cannot drift.
The new dense beach/light legend uses the same table on the original value axes, including the 5 m turn that
the old sparse gradient skipped. Labels, units, endpoints and raster transparency are preserved.

Rollback: set `window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ = true` **before loading the app, then reload**.
The switch is sampled once so the shader and legend always select the same arm. No uniform, texture, draw,
per-frame CPU allocation, or new animation work is added.

## Measured evidence

Instrument: `frontend/scripts/wave-palette/measure.cjs` compiles the actual GLSL color function and the entire
shipped `HEATMAP_FS` in Chrome 154 / AMD Radeon 890M / ANGLE D3D11. GPU/JS agreement is within one byte.
`metrics.py` uses existing Coloraide CIEDE2000, Vienot protan/deutan and Brettel tritan simulations.
The mid/high diagnostic is the worst sampled adjacent pair at 1.2, 1.8, 2.4, 3, 3.6, 4.2 and 5 m.
The full shader also includes 8-bit wave encoding, directional lighting, premultiplied alpha and reference water.

| Theme | Bare GPU ramp minimum ΔE00 before → after | Full shader minimum before → after |
|---|---|---|
| Beach | 2.42 → 6.82 | 1.45 → 4.12 |
| Light | 1.19 → 5.21 | 0.90 → 3.83 |
| Dark | 1.86 → 1.86 | 1.38 → 1.38 |

The full-shader minimum covers opacity 0.65/0.75/0.80 and directions 0/90/180/270 degrees. These are
color-difference measurements, not WCAG/text-contrast certification. The bare-ramp design diagnostic of 5
fails before (exit 1) and passes after (exit 0); composites improve but do not all reach 5.

Dark's 1,001-height GPU sweep and all 12 complete-shader opacity/direction cases are exactly equal before and
after. All three themes' retained surf-mode sample sets are equal; the rollback restores all original rows.
The full app's dark legend CSS also stays unchanged. All gradient samples are continuous, with no adjacent
0.01 m sample moving by more than 4 byte levels in any channel in the combined three-theme sweep.

Full local production app: `app-check.cjs`; synthetic marine fields, all API writes intercepted, service workers
blocked, isolated browser contexts and ephemeral localhost ports. Actual Mapbox Outdoors / Navigation Day /
Navigation Night basemaps were read via authorized GETs; no live weather backend was used. Both complete
before/after passes recorded 269 successful Mapbox responses and the same 86 existing asset 404s. Neither had
page errors or GL errors across 18 theme/device/zoom stages. No claim is made that all Mapbox assets were available.
Desktop 1280×900 and emulated phone 390×844 DPR2 cover zoom 4/6/9, wave-motion sequences, units, drawers,
Play/Pause, mouse pan and emulated touch. The initial 2.2-second Play/Pause samples precede the existing four-second
forecast cadence. Supplementary sequential runs advance the UI to hour 6 and then manually to 7 in both arms.
The synthetic resident grid remains at hour 0 in both arms, so these runs do **not** qualify live forecast-frame
advancement. This fixture/serve-path limitation is retained explicitly rather than described as data acceptance.

Fresh source checks:

- Required map + `src/tests` trees: **317 suites / 4,583 tests passed**, 181.908 s.
- Existing playback hook: **18 tests passed**.
- Focused new palette tests: **10 tests passed**, included in the 4,583 above.
- Production build: exit 0, with pre-existing lint warnings. Original build also had warnings.
- ESLint debt ratchet: exit 0, no new violation or baseline growth (existing 86 errors / 917 warnings).
- LOC ratchet: exit 0, 12 grandfathered files, none growing. `git diff --check` passed.

The first mixed capture runs overlapped and are not a controlled performance comparison. The separate sequential
zoom-9 receipts measured beach desktop p50 17 → 17 ms, p95 19 → 21 ms; light phone emulation p50 16 → 16 ms,
p95 19 → 19 ms. Both retain 3 draws, 13 textures and 6 shader compilations. These are short observations, not a
device-wide performance certification. Hardware mobile/iOS/Android and live forecast-data acceptance remain unverified.
No served number changed. No main/production promotion, PR, deploy, flag activation, customer or payment mutation occurred.

## Review artifacts and tools

Open local `evidence/REVIEW.html`: full-map before/after, desktop/mobile/zoom selectors, sampled wave motion,
color-vision swatches and links to raw receipts. The screenshot/JSON directory is retained locally as supporting
evidence rather than added wholesale to the public repository. `wave-palette-clarity-2026-10-15.json` pins source
hashes and summarized receipts. Harness commands are in `frontend/scripts/wave-palette/README.md`.

Applied skills: Code Work (scope, independent evidence), Harmonize Palette (preserve anchors/families and
separate lightness), Mapbox Cartography (value hierarchy, color-vision and device checks), Computer Use
(attempted runtime initialization, which failed). Color Designer's editable palette tool was called for both
revised ordered palettes. Existing Playwright, webpack, Coloraide and project test tools produced the evidence;
no dependency install, purchased generation, or external marine/scientific model change was needed.
The general creative/UI skills were inspected but their broad theme redesign recommendations were not applied
to this constrained repair. The Computer Use runtime failed with a platform-directory error; no browser MCP
was exposed, so the existing isolated Playwright harness was used. A test-client certificate-chain failure was
resolved within that test context; provider tokens stayed in memory and were not embedded in source or receipts.

Shared `ACTIONS.jsonl` and `STATE.md` were deliberately not edited while the weather task owns their active
chain. A separate proposed ledger receipt accompanies this session; integration must reconcile it with the
current shared head through `action_ledger.py append` after owner coordination. No rollout is qualified here.
