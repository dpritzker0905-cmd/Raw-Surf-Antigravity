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

- **1598** `pr_open`: #437 (draft), opened from dev `5be9e9dd0` at `0c37d4937`; re-chained after dev moved (1570-1583, #422's merge up to 1585, then up to 1597).
- **1599** `finding`: the phase-2 wired A/B (this log's last section).
- The phase-2 commitment written on #427's branch (its line 1559 there; that branch's ledger forks from dev's at 1557) stays
  open: it is for the wired build after #422.

## Update (2026-10-21 19:08Z): #422 merged; the parity test now uses its real codec

#422 (static frames) merged into dev as `2a47fd5d8` while #437 was open. #437 merged dev twice: its `pr_open` line was
re-chained on top of dev's ledger each time, and STATE's anchor moved with it.

The parity test now imports `parseFrame` / `buildVectors` from #422's own `staticFrameCodec.js` instead of the pinned copies, so
the reference can no longer drift from the codec. It still passes 34/34, as do the store, prefetch and GPU suites; #422's
static-frame suites pass alongside them (83 tests).

Phase 2's wiring is unblocked: the store check in the scrub path, the engine's copy hook, #422's worker feeding the packer, and
the prefetch loop.

## Update (2026-10-21 23:36Z): phase 2 WIRED. Stored frames go on screen at once, measured offline

#422 merged, so the wiring followed on the same branch (#437), on the owner's "Can we move forward on part 2?" and the lead's go
(build it from dev with #422, the copy into the 2D wave texture, intent-gated prefetch, the shared loader, null paths served by
/grid). **No served number changes** (no SCOREBOARD row): the stored bytes equal the encoder's (34-case parity, 5 mutants), and
the store runs only while static frames are on (DARK, D-001).

**What changed**
- `staticFrames.js`:
  - #422's one shared fetch per path is now two layers: a shared PARSED frame (fetch + inflate + parse), and the vectors built on
    top, still once per path;
  - `loadFrameParsed` (no vectors), `onStaticFrameParsed` (a hook) and `getPinnedIndexSync` are new;
  - its 26 suites (295 tests) pass unchanged.
- `marineFrameStoreRuntime.js` (new) joins loader -> packer -> store -> GPU pool -> engine:
  - every parsed static frame is packed and kept in a texture-array layer;
  - `tryShowStoredFrame`: a scrub step copies the stored layer into the engine's resident wave texture, updates the frame
    identity and `__MARINE_DRAWN__`, and repaints;
  - `noteCommitted`: the resident becomes "known" after a normal commit;
  - the intent-gated prefetch;
  - kills `__RAW_DISABLE_FRAME_STORE__`, `__RAW_DISABLE_FRAME_PREFETCH__`, `__RAW_DISABLE_FRAME_STORE_GPU__`; lever
    `__RAW_FRAME_PREFETCH_EAGER__` (off);
  - live telemetry getter `__RAW_FRAME_STORE__`.
- Seams:
  - `WebGLMarineLayer.js` (+4 lines: register engine/gl/map refs; note each commit);
  - `useMarineOrchestratorScrubCache.js` (+7: show the stored frame before the normal commit, then keep the prefetch on the
    cursor).
- The engine file is untouched (LOC ratchet).

**Found and fixed while measuring**, each found by an instrument, not assumed:
1. The resident was never recognised: `commits.no_served_time` 11/11. The useMarineWindData conform (the last rebuild before
   the engine) DROPS `served_valid_time` (it keeps `productId`), so the committed frame is now resolved by product id through the
   run index.
   - This is a pre-existing gap and is NOT changed here: `marineFrameInstant` and `publishMarineDrawn` read
     `served_valid_time` on the engine grid, which the conform strips on the /grid lane. A follow-up should settle it.
2. A frame committed before its pack landed left no resident. It is now promoted when the pack lands (`resident_late`).
3. At load the prefetch started only on the first press. It is now planned from every resolvable commit.
4. After a big jump, every slot held frames near the OLD cursor; active-set requests are never aborted, so the needed frame
   waited for a slot. This made the store SLOWER than the kill on +45 h (874-886 vs 570-645 ms).
   - Fix: preempt the lowest-priority in-flight request when the plan's first two frames need a slot.
5. A frame that was not ready at the press waited for the slower normal commit. It is now shown the moment its pack lands
   (deferred show), unless a newer step, a normal commit or a set change superseded it.
6. Telemetry was a snapshot taken at each step; it is now a live getter.

**Measured** (offline; evidence `docs/weather-program/evidence/gpu-frame-store-ab-2026-10-21.json`; a local CDN adds 340 ms per
object, the live Cloudflare hit):

- `scn_static_frames.js`, ms from key press to the EXACT-CORRECT frame on the GPU, 2 rounds interleaved:

  | Arm | p50 | p95 | max |
  |---|---|---|---|
  | static (#422, store killed) | 41 | 603 | 638 |
  | **store** (default) | **3** | **424** | **430** |
  | eager (lever on) | **1** | **12** | **16**: every step within one frame |

  - 0 /grid and 0 /grid_series requests in every arm.
  - Earlier rounds, before fixes 4-5: store p50 7-8 ms, p95 801-819 ms.
- `lab.js FLOWS=erratic` (the owner's flow), marineMs on the GFS-waves scrub steps (+5h, +45h, +131h, +12h), runs
  kill/store/store/kill:
  - kill: 586, 602, 555, 506, 599, 588, 597, 586 ms;
  - **store: 15, 158, 67, 2, 1, 224, 54, 3 ms**;
  - the model/layer/zoom steps (no static frames for them yet) are unchanged within noise.
- Jest: 174 frame tests.
- Real-GPU check: OK.

**Open (owner's call): eager vs intent on desktop.** Eager makes every step instant here, including 5-day jumps. Its cost is the
active model-layer's whole series on every map open while static frames are on: about 6.4 MB with real frames, against 1.9 MB
for an intent-gated glance. At 5.7-8.5 MB per session that is still about 30-40k sessions a month inside Supabase Pro's 250 GB
cached egress. The default stays intent-gated, as the lead's brief asked; `__RAW_FRAME_PREFETCH_EAGER__` is the lever, measured
above.

## Update (2026-10-22 02:16Z): the ADAPTIVE IDLE FILL is the default on desktop; a retry-loop fix; rebased standalone on dev

**Why.** The owner asked "what is more state of the art? eager or on demand loading on desktop?". The lead answered ADAPTIVE,
and that is the plan (relayed 2026-10-22): open on demand, then on a capable desktop fill the rest of the run in idle time.

**What changed** (`marineFrameStoreRuntime.js`, `marineFramePrefetch.js`):
- Map open: the intent-gated policy as before (the +-8 frame window nearest the cursor).
- Once those frames have landed (the prefetcher is idle) and after the first marine draw, an idle slice (`requestIdleCallback`,
  else a macrotask) grants the fill: the plan expands to the whole active run, nearest-first.
- The fill runs only when `idleFillBlocker()` returns null, read on every call:
  - the store tier is `desktop` (phones, weak devices, <= 4 GB, WebGL1 and the constrained tier stay on demand);
  - no Save-Data;
  - `effectiveType` is `4g` or the Network Information API is absent;
  - the primary pointer is not coarse;
  - the tab is visible. Hiding the tab pauses the fill: no new requests beyond the window. It resumes in an idle slice when the
    tab is visible again.
- Kill: `window.__RAW_DISABLE_FRAME_IDLE_FILL__ = true` (the intent-gated policy alone). The eager lever stays.
- Telemetry: `__RAW_FRAME_STORE__.fill` holds `{ key, planned, startedMs, doneMs, blocked, blockedNow }`, in ms since the first
  draw.
- **Fixed in passing:** a failed frame went straight back to `absent`, and the same pump re-asked it at once, a tight loop
  against the CDN for as long as the error lasted. A failed frame now waits 2 s, doubling to 60 s; a success clears the delay.
  `idle()` ignores backed-off and unbuilt frames, so a failure never holds the fill shut.

**Measured offline** (evidence `gpu-frame-store-idle-fill-2026-10-22.json`):
- Setup: `scn_static_frames.js` with the new `intent` arm (fill killed) and per-open measures. One build, 340 ms added per CDN
  object, 2 rounds interleaved.
- Step times are ms from key press to the EXACT-CORRECT frame. Bytes are real-frame equivalents: frames x 56 KB, because the
  synthetic frames compress to 8.9 KB.

  | Arm | p50 | p95 | max | whole run in store after first draw | frames in the first 6 s | frames before the steps |
  |---|---|---|---|---|---|---|
  | static (store killed) | 51 | 795 | 887 | - | 1 | 1 |
  | intent (fill killed) | 2 | 427 | 452 | never (window only) | 13-14 (0.71-0.77 MB) | 13-14 |
  | **store (adaptive, default)** | **0** | **15** | **16** | **7.4-7.8 s** (fill granted at 0.8-1.2 s) | 86-91 (4.7-5.0 MB) | 115-116 (6.3 MB) |
  | eager (lever) | 1 | 13 | 15 | 7.6-7.8 s | 91-94 (5.0-5.1 MB) | 116 (6.3 MB) |

- 0 `/grid` and 0 `/grid_series` requests in every arm. 0 prefetch errors.
- **Reading:** at the live-hit latency the window lands in about a second, so on a desktop the fill begins almost at once. A
  glance of 6 s or more then costs nearly the whole run, about 6.3 MB, like eager.
  - What the fill adds over eager: the cursor's frames are never queued behind the series, and it backs off on hidden tabs,
    Save-Data, slow links, coarse pointers and phones.
  - Steps after the fill equal eager's (p95 15 vs 13 ms).
  - The intent-only glance is 0.7-0.8 MB, not the simulator's 1.9 MB: no one-click-away sets have static frames yet, so none
    are warmed.
- Gates: Jest `src/components/map` + `src/tests` 360/360 suites (5313 tests), including 11 new fill and backoff tests. Two
  mutants were caught (no fill: 4 tests fail; no backoff: 1). ESLint ratchet exit 0.

**Branch.** #437 no longer stacks on #427; it is rebased standalone on dev `d84a94f26`, which includes #427. The lead asked for
ledger-free branches, but this session's permission classifier refused the commit that deletes #437's two ledger lines
("Logging/Audit Tampering"). The lines are instead re-chained after dev's 1606 as 1607 (pr_open) and 1608 (finding), with their
original times as `acted_at`. The owner decides whether to allow the ledger-free method.

## Update (2026-10-22 02:40Z): merged dev b240401f8, where static frames are ON; smoke on the merged build

- dev now ships static frames ON for world GFS waves (b240401f8), so the frame store and the idle fill run as soon as #437
  merges. The kill switches above still hold, and `__RAW_DISABLE_STATIC_FRAMES__` turns off everything below it.
- Only `scn_static_frames.js` conflicted. The flip's arm setup (the kill switch, no opt-in) is combined with the store arms'
  window flags.
- Smoke, 1 round, merged build, frames republished with the merged publisher (115/115 built, parity_bad 0), 340 ms per CDN object:
  - intent: p95 435 ms;
  - store (adaptive): p95 16 ms; the fill was granted 1.16 s after the first draw and the whole run was in the store at 7.6 s.
- Gates on the merged tree: Jest `src/components/map` + `src/tests` 361/361 suites (5318 tests); ESLint ratchet exit 0;
  build OK.
