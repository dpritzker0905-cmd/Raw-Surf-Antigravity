# CHAT & HANDOFF DELTA LEDGER — since Report 11.0

Handoffs and audit records created or updated after the Report 11.0 baseline `c9a0e9fc`, each
claim checked against commits, current source, and runtime evidence.

Classification: **Verified** · **Partially verified** · **Implemented but unvalidated** · **Stale**
· **Contradicted** · **Not located** · **Regressed** · **Unable to verify**

---

| # | Document | Date | Goal | Headline claim | Actual commits | Runtime verification by this audit | Status |
|---|---|---|---|---|---|---|---|
| 1 | `docs/research/HANDOFF-2026-08-09-B-report-11-the-stability-block-and-the-reference-generation-close.md` | 08-09 | Ship the R11 P1 stability block | Actions 3–7, 9, 10 shipped same-day | `512b1cb6..9fe18414` | R11-02/03/04/08/10a all present at HEAD with file:line; R11-04's `run_census` **caught a live mixed-run response** | **Verified** |
| 2 | `docs/research/HANDOFF-2026-08-09-C-the-instrument-session.md` | 08-09 | Instrument the shadow A/B and the wrapping question | 4 owner decisions, 5 self-corrections | `40866137..a1971972` | Not re-exercised; the shadow-A/B harness exists | **Unable to verify** (not in this audit's scope) |
| 3 | `docs/research/HANDOFF-2026-08-09-C-the-five-layer-refutation.md` | 08-09 | Refute the ray-cast/wrapping hypothesis | Data-resolution problem, not algorithm | `2c314ad6..fd152d6a` | Not re-exercised | **Unable to verify** |
| 4 | `docs/research/HANDOFF-2026-08-09-D-jacobian-audit-of-the-instrument-session.md` | 08-09 | Rank by effect on the user's number | Tide A/B produced its first trustworthy verdict; one open discrepancy | `3d3ccdc2`, `9f4f8570` | The discrepancy was closed at `c97db5bf` (the comparison was wrong, not either number) | **Verified (superseded)** |
| 5 | `docs/runbooks/HANDOFF-2026-08-09-E-the-audit-that-audited-itself.md` | 08-09 | 64 findings against the session's own 7 commits | "the E2E lane is red" | `19889a25` | **STALE** — E2E recovered green on `19889a25` and `e32342a7`; the doc records the `d1b40987` failure as current | **Stale** (self-flagged by the 08-10 audit §4) |
| 6 | `docs/research/AUDIT-2026-08-10-the-oom-and-what-the-last-ten-commits-missed.md` §1 | 08-10 | Root-cause the Render OOM | **"✅ FIXED `0d9149b7`, and PROVEN IN PRODUCTION" — RSS delta +170.3 → +0.0 MB** | `0d9149b7` | **CONTRADICTED.** Three replicates at HEAD with verified-flat controls: **+156.7 / +201.6 / +812.8 MB**; peak delta up to **+800.2 MB**; `vectors_before_bound` still 450k–540k; size-scaling control attributes it to the request (small bbox +5.7 MB) | **Contradicted** |
| 7 | same, §2 | 08-10 | The 08-03 P0 env fix was never applied | None of `PREFETCH_*`/`MALLOC_*` set on the live box | none (owner action) | **Verified and still open** — no code path could change it and none did | **Verified** |
| 8 | same, §3 | 08-10 | The memory-safety guards were running nowhere | 340 of 482 backend test files selected by no lane; family added | `c7099d0a` → `6e5bf70a` | **Verified** — the widened 141-file lane caught a real regression hours later (`4cb9c3c6` → `c4d1c7f8`) | **Verified** |
| 9 | same, §4 | 08-10 | CI state of the last ten commits | E2E recovered; two of the author's own instrument reads retracted | — | **Verified** — CI green at HEAD by full SHA across all lanes | **Verified** |
| 10 | same, §5 | 08-10 | **"THE FORECAST IS LOSING TO PERSISTENCE"** — `raw_surf` 0.229 vs persistence 0.206, "negative skill" | — | `60f724d0` (paired head-to-head shipped one commit later) | **CONTRADICTED by the repo's own next commit.** Monitor run `31426692621` at HEAD: `vs persistence +24h n=530 ours=0.181 theirs=0.199 delta=−0.017 win=51% **we win**`. The §5 headline compared two **unpaired** columns over different populations — the exact sign-inversion `60f724d0` was written to fix, applied to Open-Meteo but never retracted for persistence | **Contradicted — and the doc still carries it** |
| 11 | same, §5 (residual) | 08-10 | We lose to Open-Meteo; ICON warm bias | — | none | **Verified and unchanged.** Paired at HEAD: Open-Meteo wins at +24/48/72 h (Δ +0.050/+0.079/+0.081, win 39/36/37 %); our blend loses to our own EURO lane (Δ +0.013/+0.040/+0.031); `raw_surf:ICON` bias +0.143→+0.191 m | **Verified** |
| 12 | same, §5b | 08-10 | 65 % of E2E runs never finish | `paths-ignore` shipped | `00dfba86` | **Verified live.** The fix's own run completed **SUCCESS** at 17:26:51Z — the first uncancelled run since 16:01Z — and the two subsequent docs-only commits fired **no** run | **Verified** (n = 1) |
| 13 | same, §6 | 08-10 | Still open: credentials, pixel oracle, the ~1.5 GB plateau | — | none | **All three verified still open.** `BRAIN_RULES.md:200` still carries the key; `weather-simulation.spec.js` = 5 live + 1 `test.fixme` + 6 `test.skip`; peak RSS 84.9 % of cap | **Verified (open)** |
| 14 | `docs/research/HANDOFF-2026-08-10-the-dark-shipped-fixes-and-an-audit-of-my-own-errors.md` | 08-10 | Four fixes shipped dark + 11 self-corrections | 1949 tests / 209 suites green; all four flags strict `=== true`, zero loose default-on | `4cb9c3c6..37654183` | **Verified independently.** Frontend suite reproduces **209/209 suites, 1949/1949 tests**. All four flags confirmed strict `=== true` at their read sites | **Verified** |
| 15 | same, "IF YOU DO ONE THING" | 08-10 | `__RAW_NEARSHORE_RENORM__` is the largest measured error (11.43×) | `106f113e` | Flag present and default-off (`forecastHelpers.js:204`); the 11.43× measurement was not independently re-derived | **Implemented but unvalidated** (by this audit) |
| 16 | `docs/research/HANDOFF-2026-08-09-phases-0-2-*.md` | 08-09 | The plan Report 11.0 was written against | — | `1e37b003..5ee77bcd` | Superseded by Report 11.0's own register | **Verified (superseded)** |
| 17 | Concurrent-session commits `8b3a0efb`, `518485cf` | 08-10 (during this audit) | E2E verdict + Render build filter | "0 failed / 1 flaky / 46 passed in 6.1 min vs 11 failed / 5 flaky / 32 passed in 23.1 min"; Render `ignoredPaths` set via API; `render.yaml` is decorative | pushed to `origin/dev` after this audit's baseline | **Not verified by this audit** — outside the audited tree. The two production restarts they caused **were** observed and are what refuted this audit's own OOM-reproduction reading | **Unable to verify / consequential** |

---

## What the handoff record shows about the team's own accuracy

**The self-correction discipline is real and is working.** Across these documents the authors
retracted their own claims eleven times in one session, each retraction naming the control that
caught it. That is the healthiest signal in the corpus.

**But two high-salience claims are live and wrong in the newest document**, and both are the same
shape — *a result accepted because its measurement could not have shown otherwise*:

1. **The OOM "+0.0 MB"** — measured on a box already at its own high-water mark, where a +157 MB
   transient is invisible by construction.
2. **"Losing to persistence"** — measured by comparing two unpaired columns over different
   populations, the exact error the very next commit fixed for a different row.

> ★★★ **THE RETRACTION HABIT IS NOT YET A RETRACTION *SWEEP*.** When a session discovers that a
> comparison method inverts a sign, the fix must be applied to **every** conclusion that used that
> method in the same document — not only to the row that exposed it. Both surviving errors sit in
> the same file as their own corrections.
