# OPEN BLOCKERS AND EVIDENCE GAPS — AUDIT 12.0

`dev` @ `3ec3fd13` · 2026-08-12

**What this audit could not establish, stated so no reader mistakes silence for a clean result.**

---

## 1. Evidence gaps in **this** audit

| ID | Gap | Impact | What would close it |
|---|---|---|---|
| **G-12.1** | **No live browser session was run.** No dev server started, no page loaded, no journey driven. | The §23 baseline smoke journey in the brief was **not performed**. Every frontend claim here is from static reads, production API responses, or an isolated jest run. | A headed run once WS-CAN-0027 lands — a hidden-tab run would reproduce the exact defect 11.1 and 11.2 both hit |
| **G-12.2** | **No recordings, screenshots, traces, HARs, heap snapshots or CPU profiles were produced by this audit either.** | 12.0 is the **fifth consecutive audit** with zero media evidence. I am inside the finding I am reporting. | WS-CAN-0027. Stated plainly: this audit did not close its own most-repeated finding |
| **G-12.3** | **React Scan and React Profiler were not run.** | React render-count claims anywhere in the program remain unverified. | The frame harness (WS-CAN-0037) |
| **G-12.4** | **Backend Python tests were not executed.** | Backend verification here is static reads plus live production responses plus CI-green-at-HEAD. | A local backend run — noting the Windows/py3.14 vs production interpreter parity caveat that has stood since 11.0 |
| **G-12.5** | **Only two of ten 11.4 mutants were re-run** (M8, M9). | Gate C is refuted on content mutations, which was the specific claim. M1–M7 and M10 rest on the audit's own `MUTATION_RESULTS_FINAL_10of10.json`. | Re-run the full harness. The two chosen were the two that most directly test the published claim |
| **G-12.6** | **Four program inputs live outside version control** (`OneDrive/Documents/New project/`), including Report 11.0's primary lead-set. | An input that can be edited or lost without a commit is a provenance gap. Their hashes are recorded in `AUDIT_SOURCE_INDEX.csv` as of today. | Copy them into `docs/research/external/` |
| **G-12.7** | **Five findings were accepted on prior-audit receipt, not re-verified**: WS-CAN-0006, 0013(c), 0016, 0033, 0044. | Marked `No Evidence Located` or `Partially Verified` — never `Verified Current`. | Targeted re-verification, ranked by the register |
| **G-12.8** | **No load or capacity testing.** | Capacity figures are read from live telemetry under organic traffic, not under controlled load. | A controlled harness — **not** against production |
| **G-12.9** | **Memory entries were indexed but not exhaustively read** (104 of 341 indexed by relevance filter). | A decision recorded only in an unindexed memory file could be missed. | Full pass — 341 files, mostly out of scope |

---

## 2. Blockers carried from prior audits, still open

| ID | Blocker | Owner | Standing since |
|---|---|---|---|
| **B-1** | **Production Netlify frontend frozen at `3bd38a83` (2026-05-20).** Measured today: prod `BUILD_VERSION 3bd38a83` vs dev `3ec3fd13` = HEAD. **84 days.** | **Owner** | 2026-08-05 |
| **B-2** | Two live credentials committed in `BRAIN_RULES.md`. History retains them regardless of any future edit. | **Owner** | 2026-08-09 |
| **B-3** | Render environment variables never read. Bounds several flag-state questions in one screen. | **Owner** | 2026-08-08 (two masters) |
| **B-4** | Calibration bound value. **Never widen.** | **Owner** | 2026-08-09 |
| **B-5** | Vercel GitHub App still installed after 8/8 failing deployments. | **Owner** | 2026-08-05 |
| **B-6** | Frame rate unmeasurable in the browser pane (RAF ~1 frame / 5 s). All program FPS readings retracted. | Engineering (WS-CAN-0037) | 2026-08-11 |
| **B-7** | The band/glyph binding sub-term is not isolated. **Do not tune either lane.** | Engineering (WS-CAN-0024) | 2026-08-09 |
| **B-8** | Six stale registered git worktrees (11.0 flagged one). Five belong to a prior session and may hold live work — **prune deliberately, not blind.** | Session owner (WS-CAN-0055) | 2026-08-09 |

---

## 3. Claims I deliberately did **not** make

Recorded because a reader could reasonably expect them, and each was checked and withheld.

| Tempting claim | Why I did not make it |
|---|---|
| *"The RC-01 provenance fix is unreachable at its best branch, because `resolution` is always null."* | I checked. `backendWeatherServiceClientDiag.js:203-210` derives resolution from served grid bounds when the backend sends none, and labels the source. `AUTHORITATIVE NATIVE` remains reachable on the grid lane. **The hypothesis was plausible and wrong.** |
| *"`grid_series` latency regressed since 11.1."* | 11.1 reported **p90**; I measured **p50/p99**. Different statistics. What I can state is the absolute: p99 31.1 s, 36.8% over 10 s. |
| *"The audits falsely claimed to have run React Scan / recorded video."* | They did not. Every one disclosed the gap in its own front matter. The finding is a **never-closed requirement**, not a false claim. |
| *"Audit 11.4 was wrong to run."* | It was advised against, and it still produced a real finding nothing else caught — that three passing mutation arms had made a tautological harness look sound. **The advice was right about churn and wrong about yield.** |
| *"Audit 11.4's headline verdict is wrong."* | Its **stated basis** (Gate C) is refuted. Its **conclusion** — do not open the next engineering gate — still holds, for a different and better reason: Gate 1 correctness. Right answer, wrong reason. |
| *"The product's forecast is bad."* | It loses to a free public model at +24/48/72 h on n≈1,700–1,800 paired samples, **and** it beats naive persistence at +48/+72 h, **and** the gap is narrowing (+0.050 → +0.038 at +24 h). The defect I am reporting is that **the gate does not grade this at all** — not a verdict on the science. |

---

## 4. The single most important thing this audit could not verify

**Whether any of this reaches a user.**

The production frontend has served `3bd38a83` since 2026-05-20. Every frontend finding in this
program — the churn loop, the truth layer, the legends, the mask cache, the executed-GL oracle — is
about an artifact **production does not serve**.

That is not an engineering blocker. It is one owner decision (B-1), and it silently bounds the value
of roughly half the register.

---

## 5. What would most change this audit's conclusions

Ranked by how much a single measurement would move the verdict:

1. **A full re-run of the 10-mutant harness** — if M1–M7 or M10 now survive, Gate C is *not* cleanly
   PASS and WS-CAN-0031 reopens. *(Cheap: the harness is committed at
   `audit/weather-simulation-11.4/evidence/mutated-repair/run_mutations.js`.)*
2. **A headed browser journey with video** — the §23 baseline this audit could not perform. It would
   either confirm the frontend claims or produce the program's first temporal evidence in five
   audits.
3. **Reading the Render env screen** — could reveal a flag state that changes several
   "verified at HEAD" conclusions, since HEAD-code ≠ production-behaviour when a flag differs.
4. **One more accuracy-monitor cycle** — if the paired gap continues narrowing at the current rate,
   the urgency of WS-CAN-0026 changes in *degree*. It does not change in *kind*: a gate that cannot
   see the comparison is broken whether or not the comparison currently favours us.
