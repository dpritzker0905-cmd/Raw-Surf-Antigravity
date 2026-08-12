# HANDOFF 2026-08-12 — Gate 6: the mask cost model, two levers, and six retractions

**Branch** `dev` · **tip at close** `421b7cf4` · working tree clean · all work pushed
**Started from** `23743f63` (certification 11.2 closed, NOT CERTIFIED)
**Suite** 216 suites / 1,999 tests → **225 / 2,098** · LOC ratchet 0 new, 0 regressed

⚠️ **A concurrent session (audit 11.4) worked in this same tree throughout and independently
hardened two things I had called done.** Read `audit/weather-simulation-11.4/` before trusting any
"verified" claim below. Their headline: *a 32-test suite could not see an INVERTED mask, and 4 of 10
mutants became 10 of 10*.

---

## 1. What is live in production

| change | status | kill switch |
|---|---|---|
| Truth-layer parity on every path | live, E2E green | `__RAW_DISABLE_PARITY_VERDICT__` |
| `isEnabled` for boolean GL caps | live, **measured win** | — (revert `34d76000`) |
| `__WebGLMarineLayer_DIAG__` schema | live | — |
| Mask verdict cache | live | `__RAW_DISABLE_SHELTER_CACHE__` |
| Mask settle debounce | live but **DEFAULT-OFF** | `__RAW_MASK_SETTLE_DEBOUNCE_MS__` (unset = off) |

**The only change with a confirmed production improvement is `isEnabled`:** `gl.getParameter` went
from 1411–1519 ms to 960–1292 ms across five profile runs — **non-overlapping ranges**, ~19%.

---

## 2. The mask cost model — the durable output of this session

Four independent instruments, converging. This is the first figure in this line of work that
survived scrutiny; every earlier one collapsed.

| quantity | value | method |
|---|---|---|
| per-call cost | **46.7 ms** | real canvas, production dims, positive control |
| — classifier | 28.0 ms (60%) | |
| — downsample | 11.7 ms (25%) | |
| — `getImageData` | 4.5 ms (10%) | |
| — stamp back | 2.5 ms (5%) | |
| call rate, static | ~1.1 /s | counter at the function |
| call rate, panning | ~2.0 /s | counter at the function |
| sustained cost | **~51 ms/s, ~5.1% of wall** | product, cross-checked against CPU profile |
| redundancy, static | 96% | input hash |
| redundancy, panning | 32% | input hash |

Cross-check: counter × per-call = 1.54 s vs CPU profile self-time 1.39–1.49 s over 30 s. Within 11%,
production and local agree.

### What the two levers actually buy

| lever | static | panning |
|---|---|---|
| verdict cache | 88% hit → ~53% of mask cost | 21% hit → ~12% |
| settle debounce (safe form) | — | ~27% |

⛔ **Do not quote 71% for the debounce.** That figure was measured with a broken version that left
the mask stuck un-suppressed. Wiring the re-drive cost two thirds of the win. ~27% is the real offer.

---

## 3. Open — in priority order

1. **Visual check on the settle debounce.** CPU and safety are answered; nobody has looked at a pan
   with `__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 1000`. No instrument in this session can answer it. Until
   a human does, it stays off. **This is the only thing blocking it.**
2. **Panning is still ~85 ms/s after the cache.** The debounce addresses it; the chamfer/flood
   itself is the next lever after that, not before.
3. **`npm run build` is broken on Windows** — `NODE_OPTIONS=...` is bash syntax, npm uses cmd.exe.
   Pre-existing, unrelated to the prebuild hook added in `421b7cf4`. A cross-platform fix
   (`cross-env`, or dropping the flag if Node 18/20 no longer needs it) is unmade.
4. **Gate 1/3/5/7 verdicts still FAIL.** Two of the four cited MECHANISMS are repaired (`516a7200`,
   `a38bca79`) but a gate verdict is a measurement and the failure-injection journeys have not been
   re-run. `DO_NOT_ADVANCE_ITEMS.md` is reconciled against `RELEASE_GATE_MATRIX.csv` as of 08-12.
5. **`freshness_sec` is still wrong.** Measured cadence ~8 h (two methods, positive control);
   declared 1800 s. Owner decision between ~9 h nominal and ~18 h worst-case — cycles get skipped
   (recent-gap p90 is 16.1 h). Do not change the client's stale-refusal logic; it is behaving
   correctly on a wrong number.

---

## 4. ⛔ Six retractions — read before citing anything from earlier in this session

Every one was published, then refuted by measuring the specific thing.

| claim | what refuted it |
|---|---|
| "`DO_NOT_ADVANCE` fences the mask as perf work" | §5 fences four other items; the word *mask* is absent |
| "The E2E red was a structural CI race" | `e2e-tests.yml` already gates both deploys; the log shows both passing |
| "~1.4 s per `suppressShelteredWater` call" | 46.7 ms measured — off by 30×, obtained by division |
| "`getImageData` is the largest cost" | it is 10% of the call; the classifier is 60% |
| "Zero mask repaints in steady state" | wrong counter — `__RAW_MASK_REPATCH_LOG__` is written at the layer re-patch site |
| "Startup cost, not steady state" | 33 calls / 30 s, rate flat from burst to steady |

★ **Five of six came from reporting what a neighbouring artifact implied instead of measuring the
thing.** The three figures that held — `isEnabled` at 209 µs, 46.7 ms/call, 1.1 calls/s — were all
predicted first, then observed.

---

## 5. ★ Method notes worth keeping

- **A mutation arm proves the MUTANT is caught. It says nothing about the assertions it did not
  touch.** My cache proof compared one canvas *with itself* — a cache returning an all-zero,
  all-one or fully INVERTED mask passed all 32 tests. Every mutation arm I ran still failed tests,
  which made the harness look sound. Audit 11.4 caught it.
- **Absence must be judged AFTER the thing that creates the value.** Cost three separate false
  conclusions here, twice *after* writing the rule down.
- **Grep the WRITE site before trusting a counter.** A counter answers its author's question.
- **Do not optimise against a quantity obtained by division.**
- **A cache saves the stage it replaces, not the call it sits in.**
- **A debounce interval is only meaningful relative to the arrival rate** — 250 ms was a no-op
  against a ~540 ms gap.
- **A debounce that also debounces its own settle signal can never converge.**
- **A listener is removed by REFERENCE** — wrapping at the `on()` site is a change to `off()` too.
  Nearly shipped a 3-listener-per-remount leak.
- **Verify a build by a string the minifier cannot rename** (`__RAW_*` window props, not function
  names). And **confirm the artifact under test contains the thing under test** — a stale dev server
  silently answered two measurement runs, and the symptom read as "the feature does nothing".

---

## 6. Instruments left behind

All under `audit/weather-simulation-11.2/evidence/forensics/`, all re-runnable, all self-refusing
when they cannot see:

| file | answers |
|---|---|
| `GATE6_frame_harness.js` | frame behaviour; certifies itself with a dose ladder before reporting |
| `GATE6_stall_attribution.js` | LoAF — is a stall JS, render, or paint? |
| `GATE6_cpu_profile.js` | CPU profile + named native totals + workload counters |
| `GATE6_getParameter_microbench.js` | per-enum GL read cost, randomised-order control |
| `GATE6_mask_percall_bench.js` | mask stage breakdown, real canvas, positive control |
| `GATE6_repeat_profile.sh` | N runs → a range, not a point |
| `F-STALE_cadence_sample.js` | product refresh cadence from one request |

⚠️ **Frame rate is unmeasurable in the Browser pane** (RAF ~1 frame/5 s under throttling). Use the
frame harness headed — `HEADED=1` also gets the real GPU; headless falls back to SwiftShader.

⚠️ **Do not run browser harnesses against `dev--rawsurf.netlify.app` during a long E2E run.**
Refined from the original blanket rule: a single 60 s session is fine (verified — E2E passed while
I profiled). Sustained load across ~25 min correlates with the `286a4e6b` red.
