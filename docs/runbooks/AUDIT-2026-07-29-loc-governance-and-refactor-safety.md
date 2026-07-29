# AUDIT 2026-07-29 — the 800-LOC violations, ranked by whether it is SAFE to refactor them

**Read [[standing-work-rules-user-mandate]] first.** This is the standing reference for the repo's
file-size debt. It exists because "refactor the big files" is the wrong instruction on its own:
the variable that decides whether a split lands or joins the marine regression graveyard is **test
coverage of the code being moved**, and that varies from 0% to 100% across the very same list.

---

## 0. ★★★ THE ONE NUMBER

**Aggregate statement coverage across the files over the limit was 22.40% (1,634 / 7,294).**
Seven of them are under 10%. Moving code at 0.14% coverage is not a refactor — it is a rewrite
with no safety net, in the subsystem this repo has regressed most often.

⇒ **Refactor in coverage order, not in size order.** That is the whole finding.

---

## 1. THE INVENTORY (after this session's two splits)

12 files, **14,422 lines**, every one of them in `frontend/src/components/map/`.
The backend is clean: its largest file is `services/weather_pipeline/store.py` at 781.

| file | loc | stmt % | func % | verdict |
|---|---|---|---|---|
| `WebGLMarineEngine.js` | **3,207** | 25.1 | 58.8 | ⚠️ decision layer LIFTED; component half needs staging |
| `WebGLMarineLayer.js` | 1,221 | **0.14** | 0 | ⛔ **DO NOT** — cover first |
| `WeatherEngine.js` | 1,116 | 58.7 | 73.2 | ✅ **READY — next target** |
| `MapWebGL.js` | 1,097 | **0.71** | 0 | ⛔ **DO NOT** — cover first |
| `WebGLWindEngine.js` | 1,095 | 24.7 | 63.6 | ⚠️ mirror of the marine engine; same staged approach |
| `WebGLWindShaders.js` | 1,029 | **100** | 100 | ✅ safe, but see §4 — low value |
| `WebGLMarineParticleShaders.js` | 978 | **100** | 100 | ✅ safe, but see §4 — low value |
| `useMarineDataFetcherCore.js` | 966 | 9.8 | 7.7 | ⛔ **DO NOT** — cover first |
| `MapWeatherControls.js` | 957 | **0.0** | 0 | ⛔ **DO NOT** — and see §5, it is a 3-theme surface |
| `openMeteoProtocol.js` | 943 | 3.4 | 2.4 | ⛔ **DO NOT** — cover first |
| `useMarineOrchestrator.js` | 908 | 6.2 | 9.1 | ⛔ **DO NOT** — cover first |
| `OceanMask.js` | 905 | 4.3 | 2.0 | ⛔ **DO NOT** — cover first |

✅ **Resolved this session:** `WebGLMarineMaskRenderer.js` 1,098 → 723 (68.3% covered, which is
exactly why it went first).

★ Regenerate the coverage column with:
```bash
cd frontend && CI=true npx craco test --watchAll=false --coverage --coverageReporters=json-summary
```

---

## 2. ★★★ THE METHOD THAT MAKES A SPLIT PROVABLE

A passing suite shows no **caught** regression. These four steps show no **change**:

1. **Move by LINE RANGE with a script, never by retyping.** Assert the seam line numbers first, so
   the script fails loudly if the file drifted underneath it.
2. **Keep the public surface byte-identical.** Re-export every moved symbol from the original
   module. If no importer and no test had to change, the move cannot have altered a contract.
3. **Prove it with a multiset line diff** against `git show HEAD:<file>` — every original line must
   still exist somewhere in the resulting files. Both splits this session came back with the exact
   intentional delta and nothing else (mask: 0 lines changed; engine: 5 single-token `export`
   promotions).
4. **Lint the PRE-SPLIT original from git before believing any error is yours.** `WebGLMarineEngine.js`
   reports 9 errors; all 9 pre-date the split, confirmed by line numbers shifted by exactly 637 —
   the size of the extracted block.

### ⚠️ The trap that bit on the first attempt
`export { x } from './y'` **forwards a name without binding it in the module's scope.** The
re-export block alone left five call sites in the host file undefined. ESLint `no-undef` caught it
immediately — which is the argument for linting each split before running the suite, because Jest
would have failed with a far less obvious error.

### ⚠️ Module-level state is the real hazard
Both files carried shared mutable state — `_basinVerdicts` (stashed by one function, read by
another) and `_ratingGraceState` (used by a predicate and its test-reset). **A split that separates
a state object from any of its users silently disables the feature and passes every test that does
not exercise the round trip.** Check for `^let`/`^const _` in any block before moving it.

---

## 3. ⛔ THE PREREQUISITE FOR THE REST OF THE LIST

Seven files cannot be touched safely today. The work that unblocks them is **characterisation
tests** — tests that pin current behaviour rather than assert intended behaviour — on:

`WebGLMarineLayer.js` · `MapWebGL.js` · `useMarineDataFetcherCore.js` · `MapWeatherControls.js` ·
`openMeteoProtocol.js` · `useMarineOrchestrator.js` · `OceanMask.js`

★ This is worth doing on its own merits, not just to enable refactoring: these seven are 6,997
lines of almost entirely unexercised code in the subsystem with the worst incident history in the
repo.

---

## 4. ★ WHERE SPLITTING BUYS LITTLE

`WebGLWindShaders.js` and `WebGLMarineParticleShaders.js` are at 100% coverage and would be trivial
to split — but they are largely GLSL source strings. Cutting them satisfies the ratchet without
making anything easier to reason about. **Do them last, or leave them and record why.** The limit
exists to bound complexity, and a long string constant is not complex.

⇒ Prefer `WeatherEngine.js` (1,116 loc, 58.7% covered) as the next real target.

---

## 5. OTHER VIOLATIONS FOUND (not file size)

### 5a. ✅ FIXED — the LOC gate could not see TypeScript
`loc_ratchet.SCOPES` scanned `backend/**.py` and `frontend/src/**.js`. `frontend/src/admin/` is
TypeScript — 21 files, 4,733 lines — so an entire language was ungoverned while the gate printed
"[OK] No new violations". The workflow's `paths:` filter had the same hole, so a TypeScript-only
change would not even have triggered the job. Both widened (`2706a9f9`); scanned files 1,858 →
1,929, still zero new violations, so it cost nothing to close.
★ **Ask what a green gate would look like if it were not running.**

### 5b. ⛔ OPEN — 152 ESLint errors in `components/map`
188 errors / 128 warnings across `frontend/src`; **152 errors and 92 warnings are in
`components/map` alone**, across 53 files. Worst: `GridParserWorker.js` (67),
`backendWeatherServiceClient.js` (10), `WebGLMarineEngine.js` (9), `WebGLWindEngine.js` (8).

⚠️ **One is a genuine latent bug, not style:** `WebGLMarineEngine.js` — `'_washOpacityEff' is not
defined` (`no-undef`). That is a `ReferenceError` on whatever path reaches it. It is pre-existing
and was deliberately NOT fixed inside a refactor commit; it needs its own forensic pass.
Also 5 × `no-redeclare` in the same file, which is how a `let` shadows a live value.

### 5c. ⚠️ `scratch/` is tracked in git
Including `scratch/euroExtendedEstimate_utf8.js` at 970 lines, which appears in every repo-wide
sweep and is governed by nothing. Untrack it. (`Graph-Tools/` is already untracked — fine.)

### 5d. ⚠️ Source-grep tests break under refactoring AND under coverage
`WebGLMarineTextureEncoder.dilation.test.js` asserts on `encodeMarineTexture.toString()` with a
regex. Istanbul rewrites function bodies, so **the whole suite fails under `--coverage` and passes
without it** — which is how a coverage run reads as a real regression. It also breaks on any
reformat of a function it does not test the behaviour of. 2 assertions; replace with behavioural
ones.

---

## 6. ★★★ COVERAGE SAYS *SAFE*. STRUCTURE SAYS *CHEAP*. THEY ARE DIFFERENT AXES.

⚠️ **This section corrects an earlier version of this document**, which named `WeatherEngine.js` as
the obvious next target purely because it is 58.7% covered. Checked structurally, it is **one
1,094-line React hook** (`useWeatherEngine`, lines 22–1116) with no top-level seam at all — safe to
touch, but nothing cheap to lift out. Splitting it means extracting sub-hooks, which moves closure
capture and dependency arrays, not just lines.

`WebGLWindEngine.js` reads like the marine engine's twin and is not: a 23-line constructor, ~126
lines of pure exported helpers, then **nine `WebGLWindEngine.prototype.*` GPU methods** carrying the
remaining ~885 lines. Lifting its pure block yields 1,095 → ~970 — still over the limit.

⇒ **The cheap structural wins are now exhausted.** Both splits this session worked because those
files contained a large, contiguous, pure, already-tested block. No file left on the list does.

| axis | question it answers | what it rules out |
|---|---|---|
| **coverage** | if I move this, will a break be caught? | 7 files at <10% |
| **structure** | is there a contiguous block to move at all? | the rest |

A file needs BOTH. That is why the list stalls here rather than continuing at the same pace.

### ⇒ THE ORDER OF WORK
1. **Characterisation tests** for the seven ⛔ files, worst-covered first (`MapWeatherControls.js`
   at 0.0%, `WebGLMarineLayer.js` at 0.14%, `MapWebGL.js` at 0.71%). This is now the *critical
   path*, not a parallel nice-to-have — nothing else on this list proceeds safely without it.
2. **`map/ARCHITECTURE.md`** — highest value ÷ risk in the whole audit, and it needs no test
   coverage to be written. See the note below.
3. **`WebGLMarineEngine.js` stage 2** — separate the pure predicates in the post-component block
   from the `WebGLMarineEngine.prototype.*` GPU methods they are interleaved with. Surgical, but
   the block is known and bounded.
4. **`_washOpacityEff`** — its own forensic pass, not folded into a refactor.
5. **`WeatherEngine.js` / `WebGLWindEngine.js`** — real decomposition work, after (1).
6. The two 100%-covered shader files, last, if at all (§4).

⚠️ **A directory reorg is NOT on this list on purpose.** `components/map/` is flat — 230 files,
53,087 non-test lines, 24% of the frontend, zero subdirectories — and subdividing it would be the
single biggest readability win available. But it spends regression risk in the worst possible
place for a benefit that is purely navigational. **Write `map/ARCHITECTURE.md` first** (the data
path: fetch → decode/encode → mask → render → interact, and which file owns each stage). Prose
carries no regression risk and captures most of the benefit.
