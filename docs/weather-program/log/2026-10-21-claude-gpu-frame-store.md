# 2026-10-21: instant scrub, phase 2a (frame store foundation, unwired)

Session `claude/quizzical-tu-658e9c` (the GPU-resident frames lane, phase 1 = draft #427). Branch `claude/gpu-frame-store`, cut
from dev `5be9e9dd0` at about 15:20Z on the owner's word in this session:

> "Can we move forward on part 2?"

#422 (static frames) is still an open draft and conflicts with dev. So this PR builds only the half of phase 2 that does not
depend on #422:
- four new modules and their tests;
- a real-GPU check script.

Nothing in the app imports them yet. **No app behaviour changes and no served number changes (no SCOREBOARD row).** #422's files
are untouched. The wiring (#422's worker output, the scrub-cache seam, the engine hook) waits for #422 to merge.

## What was built

Spec: `docs/architecture/gpu-resident-forecast-frames.md`, on #427.

- **`marineFramePack.js`**: a decoded static frame straight to the `u_waveTexture` RGBA8 bytes, with no per-node objects.
  - It follows #422's buildVectors rounding, the encoder's input stage for the `waves` layer, trimDeadEdges' edge rule, and the
    encoder's own `extrapolateOceanData` / `dilateDirectionField`.
  - It uses the encoder's own float type (Float16 where the browser has it), its pack loop, confidence scaling, theme height
    scale and wrap seam.
  - It declines non-`waves` layers, rating grids and the wrap-mirror case.
  - `packSignature()` names every setting that changes the bytes.
- **`marineFrameStore.js`**: sets keyed on `model_run_time` + pack signature, and the frame states absent / unbuilt
  (`path: null`, #422's review fix) / inflight / packed / resident.
  - Fixed tier budgets (desktop 64 MB GPU, handheld 16, constrained 8, webgl1 8).
  - LRU eviction by set, then by frame, with protected cursor frames.
  - A terminal miss for frames the packer declines; telemetry.
- **`marineFramePrefetch.js`**: the intent-gated policy the simulator scored, plus the loop.
  - The plan: a +-8 window (+-4 on slow links), then the one-click-away sets' settled hour, then the rest of the series once the
    wheel has moved 4 frames.
  - The loop: cap 6 (3 slow), nothing before the first marine draw, aborts outside the top 2 x cap except the active set,
    re-pin on 404/400, packing in idle slices.
- **`marineFrameStoreGpu.js`** (no imports):
  - pooled WebGL2 texture arrays with LRU eviction;
  - `uploadMany` (texSubImage3D);
  - `copyToTexture` (a layer into the engine's 2D wave texture through a read framebuffer: no shader port);
  - full save/restore of the state it touches;
  - the WebGL1 `uploadBytesTo2D` fallback.
- **`frontend/scripts/frame-store-gpu-check/`**: loads that exact module file in headless Chrome, Edge and SwiftShader and checks
  it on the GPU.

## Design decision taken while building (spec to be updated on #427)

- **Packing runs on the main thread, in idle slices.** A Blob worker would need the encoder's functions inlined as text, and a
  minified build renames the module variables they close over. Calling the same module functions makes the bytes identical by
  construction. Cost: about 2.2 ms per world frame (node, real frames), done before the frame is needed.
- **WARM frames (one-click-away sets) stay as CPU bytes.** They are uploaded to the 2D texture on a toggle (0.03-0.2 ms), so no
  shared WARM array is needed.
- **Finding for the wiring step:** for layers other than `waves`, the series conform (`useMarineWindData`) emits vectors without
  `is_valid`/`isOcean`. The encoder then treats land cells of raw flat series vectors as ocean on lane B, while lane A (the /grid
  mapper) keeps them land.
  - It is not reachable today: static frames publish GFS `waves` only.
  - It must be settled before non-waves static frames ship. The packer declines those layers until then.

## Measured (this session; offline, AMD 890M)

- **Parity:** `marineFramePack.parity.test.js` passes 34/34.
  - Coverage: the real GFS world frame plus 3 synthetic frames x 7 settings (three themes, dilation off, confidence off,
    strength 0.4, trim off) x both lanes, plus Float16 arrays.
  - Bytes are identical to the real `encodeMarineTexture` upload.
  - Positive controls: 5 mutants (byte rounding, u/v rounding, no seam average, top trim 1, bottom trim 3) each failed 12-29
    cases. The top-trim mutant first SURVIVED (only one dead top row in the synthetic frame); the frame was strengthened to 2
    top / 3 bottom dead rows, and both trim mutants then failed.
- **Unit tests:** store 12/12, prefetch 14/14, GPU module 7/7.
- **Real GPU** (`frame-store-gpu-check/run.js`, Chrome, Edge, SwiftShader):
  - 24/24 layer copies byte-exact, with a foreign TEXTURE_2D, READ_FRAMEBUFFER and FLIP_Y planted before each;
  - state restored 24/24, 0 GL errors;
  - uploads under FLIP_Y = PREMULTIPLY = true succeed and restore them;
  - WebGL1 fallback exact;
  - copy CPU p50 0-0.1 ms, p95 0.2 ms.
- **Whole frontend Jest tree** (dot-free copy, node_modules junctioned): 461/465 suites passed.
  - Three of the four failures read repo-root files absent from a frontend-only copy. They pass once those 6 files are copied in
    (windBenchLadder, OceanMask.coastBuffer, encodingDebris).
  - The fourth, netlifyIconStoredTailScope, fails here with `spawnSync bash ETIMEDOUT` on this overloaded machine; it spawns bash
    and is unrelated to new, unimported files. Hosted CI is the authority.
- **ESLint ratchet:** passes after removing two unused `eslint-disable` directives it flagged (+2 warnings).
- **LOC ratchet:** no new violations.

## Ledger

- **1570** `pr_open`: #437 (draft), opened from dev `5be9e9dd0` at `0c37d4937`.
- The phase-2 commitment written on #427's branch (its line 1559 there; that branch's ledger forks from dev's at 1557) stays
  open: it is for the wired build after #422.
