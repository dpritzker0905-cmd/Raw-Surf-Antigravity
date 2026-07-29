# HANDOFF 2026-07-29 NIGHT — the FL report, and why the rating says what it says

**Read [[standing-work-rules-user-mandate]], then `memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md`.**
Continues `HANDOFF-2026-07-30-EVE-provenance-geometry-and-the-jacobian.md` and
`AUDIT-2026-07-29-loc-governance-and-refactor-safety.md`.

---

## 0. ★★★ THE OWNER'S REPORT, ANSWERED

> *"wind in the forecast being offshore wind in FL east coast early next week and waves, but only
> poor to fair conditions on the glyphs. I still don't think our science is on point."*

**The science is on point. The offshore wind is fully credited. The limiter is SIZE, measured
against a GLOBAL reference instead of Florida's.**

Sebastian Inlet, 2026-08-03T06:00Z, the best hour in the window, with the full factor breakdown:

| factor | value | reading |
|---|---|---|
| `wind_gate` | **1.000** | nothing vetoed |
| `wind_quality` | **0.997** | the offshore wind is credited essentially perfectly |
| `period_gate` | 1.000 | 7.9 s clears the 7 s veto |
| `swell_exposure` | 0.953 | swell is square to the beach |
| `oversize_gate` / `tide_fit` / `breaker_type` | 1.000 | inert |
| **`size_gate`** | **0.694** | ⟵ **THE LIMITER**: 2.9 ft against the global 1.2 m (~4 ft) reference |
| `period_quality` | 0.529 | 7.9 s is mediocre — real, see §1 |
| | **53.6 → `fair`** | |

★ **Rate Florida against Florida and the same hour scores 77.2 (`good`).** That is queue item #1
(`RATING_LOCAL_SIZE` + a real climatology blob) — no longer a theoretical unlock, it now has a
measured, user-visible cost.

⚠️ It cuts BOTH ways, which is why it is the fix rather than a thumb on the scale: on the global
curve a perfect-clean **4 ft Florida day scores 89.3 = `epic`**. With a FL reference (0.7 m) it
scores 71.3 = `good`. The global curve is wrong at both ends — pessimistic at 2-3 ft, absurd at 4 ft.

---

## 1. ★★★ THREE OF MY OWN HYPOTHESES DIED PROVING IT

1. **"The FL shore normals must be wrong."** I saw `swell_exposure` pinned at its 0.10 floor and
   called it a smoking gun. **It was a sampling error in my own instrument** — I sorted the table by
   score and read the worst 30 of 166 rows, which self-selects for low exposure. Measured properly:
   **all 96 FL east-coast spots face east (45–135°), 100%**, and live exposure runs **0.95–0.99**.
   ★ *Sort order is part of the instrument. Read the aggregate before the tail.*
2. **"The size curve regressed against the owner's anchor."** No: production (no reference) gives
   **FL 2.5 ft clean = 49.1 `fair`**, against the anchor's documented ~49 `fair`. Exactly on spec.
   ⚠️ But the anchor TEST passes `reference_size_m=0.7`, a branch production does not take — so the
   acceptance spec is green on a path the app never runs. Worth closing when #1 ships.
3. **"The 3-second periods must be a data defect."** **NDBC buoys say they are real.**

| buoy | real Hs | real DPD | ours Hs | ours Tp |
|---|---|---|---|---|
| 41117 St Augustine | 0.60 m | **4.0 s** | 0.64 | 4.2 |
| 41009 Canaveral | 0.70 m | **5.0 s** | 0.68 | 7.7 |
| 41113 Fort Pierce | 0.50 m | **4.0 s** | 0.46 | 7.7 |

★★ **Our Tp runs +2.7 s HIGH against the buoys (range −0.2…+3.7).** Heights match well. So the
model is **optimistic** on period, not pessimistic — if anything the ratings are too generous.
⇒ **NEW QUEUE ITEM: a Tp bias check against NDBC, catalogue-wide.** Per the Jacobian, Tp+10% is
2.7 points; +2.7 s on a 5 s period is +54%, worth roughly 14 points of score.

★ Method note: **an offshore wind grooms a surface, it cannot manufacture period.** 2 ft of 4–5 s
windchop with perfect offshore wind is still 2 ft of windchop, and `poor_fair` is the honest answer.

---

## 2. ✅ SHIPPED — the sim can now say WHY (`30044e71`, `b539efd5`)

Answering §0 took twenty minutes of bespoke scripting against engine internals, and four seconds of
reading once the nine factors were on screen. That asymmetry is the bug.

`services/weather_pipeline/sim_explain.py` — every payload from `calculate_surf_rating` now carries
`why` and `why_summary`:

> *"53.6/100 (fair) — limited by size gate at 0.694: wave size vs the reference good-day size.
> Fix that alone and it would score 77.2."*

* ★ **The LIMITER, not just the list.** With nine factors the one nearest zero IS the story, and it
  carries `score_if_this_were_1_0` so the answer is actionable.
* ★ When every multiplier is 1.0 it names the **wind/period blend** rather than inventing a veto —
  pinned by a test, because calling a 1.000 factor "the limiter" would manufacture a problem.
* ⚠️⚠️ **THE HONESTY CHECK IS THE FEATURE.** It reconstructs the product and compares it to the
  engine's own score; drift > 0.15 emits a warning naming the engine authoritative. **Live:
  `reconstruction_error 0.0`.** A breakdown describing a different composition than the one that
  produced the number is worse than none — ONE FORECAST COMPOSITION applied to explanation.
* Read-only, `SIM_EXPLAIN=0`, a test asserts every other field is byte-identical on/off.
* ⚠️ Its broad `except` is the `8ce65c95` shape (a swallowed NameError once left the surf transform
  silently OFF), so a test asserts the error path is **not** the one being exercised.

197 tests pass across sim, rating, composition-parity and hub-parity, including the AST guard.

---

## 3. ⚠️ THE FULL BACKEND SUITE — READ THIS BEFORE TRUSTING A RUN

Three full runs this session gave **1 failed / 1,414 passed**, then **96 failed / 28 errors**, then
an empty log. **Root cause: the disk hit 100% (936 GB used, 0 free).** A full disk breaks subprocess
spawning, SQLite temp files and pytest tempdirs — exactly the `test_wind_native_viewport_fallback.py`
error signature, which **passes 8/8 in isolation**. Freed 2.1 GB (`frontend/node_modules/.cache`
1.9 G, `build/`, `coverage/` — all untracked and gitignored).

⚠️ **`df -h` before trusting a red suite on this machine.** And ⚠️ my own `tail -5` on the
background run captured the summary line and none of the failures, so the first diagnosis had no
evidence to work from — **do not pipe a suite you may need to diagnose.**

---

## 4. ⛔ THE QUEUE

1. ★★★ **`RATING_LOCAL_SIZE` + a real climatology blob** — now the direct answer to a user report,
   not a theoretical unlock. `load_size_climatology_l2_cached()` returns None; nothing has a
   reference. Fixes FL at BOTH ends (2-3 ft too low, 4 ft absurdly `epic`).
   ⚠️ When it ships, close the anchor test's blind spot (§1.2) and re-run the owner's anchors.
2. ★★★ **NEW — Tp bias vs NDBC, catalogue-wide.** +2.7 s median on 3 FL buoys. Instrument exists
   (`validate_nearshore_transform.py` is the model).
3. ★★★ **EURO cadence seam** — still the other user-reported defect (3 h→144 h then 6 h vs a filler
   gated on a horizon; 10 dead slots ≡ 3 mod 6).
4. ★★ Geometry in the DB (needs a production schema change — owner's call).
5. ★★ Refraction / Kr site offset · depth-dependence.
6. ★ Wire `partitions` into the RATING · thread a spot id into the hub.
7. From the LOC audit: characterisation tests for the seven <10%-coverage map files are the
   critical path; `map/ARCHITECTURE.md`; `_washOpacityEff` is a real latent ReferenceError.

---

## 5. ★ METHOD NOTES

1. ★★★ **Sort order is part of the instrument.** I read the 30 worst rows of 166 and generalised to
   "nearly every row". The aggregate said the opposite.
2. ★★★ **An acceptance test that passes an argument production does not supply is green on a path
   the app never runs.** The FL anchor test supplies `reference_size_m`; production supplies None.
3. ★★ **Check the model against an instrument before calling the model wrong.** Three NDBC buoys
   turned "our periods look broken" into "our periods are 2.7 s too GENEROUS".
4. ★★ **Explanation needs the same composition discipline as computation** — reconstruct and compare,
   or the breakdown becomes a second opinion.
5. ★ **`df -h` belongs in the triage list.** A full disk looks exactly like 96 flaky tests.
