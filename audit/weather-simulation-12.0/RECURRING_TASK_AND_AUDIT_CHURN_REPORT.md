# RECURRING TASK AND AUDIT-CHURN REPORT

`dev` @ `3ec3fd13` · 2026-08-12

---

## 1. Tasks appearing in three or more audits without closing

| Canonical ID | Task | Appearances | Status at HEAD |
|---|---|---|---|
| **WS-CAN-0027** | Runtime evidence capture (video / trace / profile) | **4** — 11.0 (B-01), 11.1 (G-02), 11.2, 11.4 | **Not Started** |
| **WS-CAN-0025** | External uptime probe on `/api/health` | **3** — 11.0 (P0), 11.1, 11.2 | **Not Started** |
| **WS-CAN-0017** | Pipeline integrity chain (checksums, byte-count validation) | **3** — MASTER-AUDIT-11.0, 11.0 R11-13, 11.0 §15 Phase 3 | **Not Started** |
| **WS-CAN-0009** | HTTP status honesty on `/conditions/*` | **3** | **Not Started** — 9 live sites |
| **WS-CAN-0033** | Non-monotonic z8/z9/z10 product selection | **3** — 11.0 Jacobian, 11.2 RC-03 ×2 | **Not Started** |
| **WS-CAN-0046** | Zarr / cloud-native data migration | **5** | **Rejected** (correctly — see §5) |
| **WS-CAN-0049** | AI bias correction / blending | **4** | **Deferred** (correctly) |
| **WS-CAN-0018/0019** | Executed-GL pixel assertion | **4** | **Implemented but Inactive** (`test.fixme`) |

---

## 2. The two zombies, examined

### WS-CAN-0027 — four audits, four disclosures, zero recordings

Every commissioning prompt from 11.0 onward required screen recording, React Scan, React Profiler,
Chrome performance tooling and heap snapshots. A file-type census across **all four** audit evidence
directories:

```
33 .md   27 .py   19 .js   12 .json   9 .txt   4 .csv   1 .sh   1 .patch
 0 .webm  0 .mp4   0 .png   0 .zip     0 .har   0 .heapsnapshot   0 .cpuprofile
```

**Why it never closed.** Each audit met the requirement with an *honest caveat* instead of a task:

| Audit | Its own words |
|---|---|
| 11.0 | *"Recordings reviewed: ZERO. No video capture tool was available in this pane — a genuine gap"* |
| 11.1 | *"Videos reviewed: 0 … no video taken in a hidden tab could support a claim"* |
| 11.2 | *"no mobile-viewport runs, no heap snapshots, no performance traces were produced"* |
| 11.4 | *"Live browser runs: 0. Recordings reviewed: 0"* |

Each caveat is defensible in isolation. Together they are a four-audit standing gap that nobody
owned, **because a caveat closes a paragraph and a task closes a gap.**

Audit 11.0 even wrote the remedy and priced it — *"ADOPT — Playwright 1.60 → 1.62 +
`video: 'retain-on-failure'` … This directly closes this audit's single largest evidence gap
(B-01)"*. At HEAD:

```
frontend/playwright.config.js:32   reporter: 'html',
frontend/playwright.config.js:35   trace: 'on-first-retry',
frontend/playwright.config.js:36   screenshot: 'only-on-failure',
                                   (no `video` key)
frontend/package.json:109          "@playwright/test": "^1.60.0",
```

**What will close it:** one key, one version bump. → **NOW list.**

⚠️ One directory materially overstates itself: `audit/weather-simulation-11.0/evidence/react-scan/`
contains exactly one file, a 70 KB state-of-the-art *research note*. **The directory name asserts a
tool that was never run.** An empty directory is honest; a directory named for an instrument and
filled with prose is not.

### WS-CAN-0026 — the newest zombie, and the most expensive

Introduced by 11.1 on 2026-08-10 in three places at once, including its Jacobian delta:

> *"A gate can be green about a different quantity than the one that matters. Adding a persistence +
> Open-Meteo row to the RED criterion is still unstarted."*

**11.2 and 11.4 do not mention it at all.** It did not fail — it stopped being carried.

Measured live today (run `31606511901`, verdict `OK`):

| | 11.1 (08-10, n=790) | HEAD (08-12, n=1,770) |
|---|---|---|
| vs Open-Meteo +24 h | Δ +0.050, win 39% | Δ +0.038, win **41%** |
| vs Open-Meteo +72 h | Δ +0.081, win 37% | Δ +0.063, win **38%** |
| vs persistence +24 h | (contested at the time) | Δ +0.007, win 46% — **WE LOSE** |

**The sample more than doubled and the sign did not change.** The lane is improving and still
losing at +24 h. → **NOW list, and the authorized mission.**

---

## 3. The most repeated unresolved *root cause*

> **A check that cannot distinguish "not sampled" from "broken" reports success.**

Instances found across the program:

1. `mismatches.length === 0` ⇒ `match: true` — absence encoded as agreement.
2. `undefined ⇒ falsy ⇒ "AUTHORITATIVE NATIVE"` — a total load failure rendered green.
3. `forecastDiagnostics.js` reading `renderedVectorCount`, which **nothing has ever written** —
   blind for ~10 weeks, cited as PASS by Reports 11.0 *and* 11.1.
4. Three backend status surfaces serving hardcoded numbers as measured.
5. A calibration census bound authored at p80 grading a p50 population for ten days.
6. `test.fixme` on the executed-GL oracle — a test that **cannot** red CI.
7. **The accuracy gate passing while its own log prints `WE LOSE` eight times.**

Instances **1, 2 and 3 are now closed and re-verified at HEAD** (`forecastDiagnostics.js:48`,
`:288-354`; `TruthOverlay.js:274-286`). Instance 4 is two-thirds closed. Instance 5 is fixed as an
instrument. **Instances 6 and 7 are open, and 7 is the most consequential defect in the program.**

⭐ The pattern is not carelessness. It is that **the null-ish success path is always the shortest
code path**, so it is what gets written when the author is thinking about the happy case.

---

## 4. Why closure fails — ranked by frequency, not by blame

**① Sequencing: the next packet is authored before the current window's evidence is folded back in.**
Three consecutive implementation packets were superseded before use:

- 11.0's `FIRST_IMPLEMENTATION_PACKET.md` — **rewritten** at `8f1fcf41`, because it *"specified
  building something that already exists."*
- 11.1's `NEXT_IMPLEMENTATION_PACKET.md` — superseded inside its own audit by
  `MISSION_2_REFUTATION_AND_CORRECTED_PACKET.md`.
- 11.4's `AUTHORIZED_NEXT_GATE_PACKET.md` — **Stages 1, 2 and 4 already complete at publication**,
  refuted by `MUTATION_RESULTS_FINAL_10of10.json` (M1-M7) + `MUTATION_RESULTS_ROUND2_FINAL_10of10.json` (M8-M10) in the very same commit.

**② The blocker is evidence, not code.** The two oldest zombies are both instrument gaps costing
under a day each. Neither is technically hard. Neither had an owner, because neither was ever
written down as a task.

**③ Version identity.** Three documents numbered 11.0, two numbered 11.2, none numbered 11.3. A
carried-forward finding cannot be tracked when its source citation is ambiguous.

**④ Taxonomy discontinuity.** 11.2 publishes gates **1–8 by domain** (Data Truth, Projection Truth,
State and Concurrency, …). 11.4 publishes gates **A–I by audit dimension** (Mission Compliance,
Causal Closure, Test Integrity, …). They are different frames. **11.2's Gate 1 "Data Truth: FAIL"
has no successor row anywhere in 11.4**, so it neither closed nor stayed open — it left the record.

**⑤ A new report is easier to author than an old ledger is to update.** Named in advance, correctly,
by the session that wrote both the 11.3 and 11.4 prompts:

> *"Both would produce a fifth document about a system whose problems are now specifically named.
> You have four failing gates with corrective actions already written. The next artifact should be a
> one-page gate ledger you **update**, not a new report you **author**."*

---

## 5. Audits that did *not* materially change the program

**None — and this deserves to be said plainly, because the churn framing invites the opposite
conclusion.**

Even Audit 11.4, which the prior session advised against, produced a finding nothing else had: that
a 32-test suite could not observe the content of a cache hit, and that **three passing mutation arms
had made the harness look sound while covering assertions the tautology never touched.** Mutation
testing did not catch it; an auditor reading the harness did.

The churn is real, but it is **churn in the paperwork layer, not in the analysis layer.** Each audit
found something true. What they failed to do was *close* what the previous one found.

⚠️ The one exception worth naming is the *duplicate-numbering* churn: the repo-root 11.0 and the
`audit/` 11.0 are two full audits of adjacent commits, produced the same day, neither of which
consumed the other's task list.

---

## 6. What must stop being broadly re-audited

| Subject | Why it should stop | Reopen only if |
|---|---|---|
| Zarr / JAX / SWAN-class technology | Priced against what they'd replace by 3 independent audits; all lose | A measured bottleneck appears in the thing they'd replace |
| Whether the forecast composition chain is single-authority | Verified 4× consecutively, AST-guarded, one write site | The AST guard goes red |
| Projection / antimeridian / Web Mercator correctness | Certified by 11.2 including a self-refuted false positive | A synthetic canonical field (WS-CAN-0028) disagrees |
| Gate 4 animation lifecycle | 11.2: *"good — don't refactor it"* | — |
| Whether the OOM is closed | Attributed and closed with a control (26 kills, all pre-fix, zero in 10.9 h) | Kills resume. *Headroom* stays watched — that is a different number, at 87.0% today |

---

## 7. The rule that prevents this recurring

> **A required procedure that is not run opens a task, not a caveat.**

Four audits disclosed the recording gap in their front matter. Zero opened a task for it. Under the
12.0 governance rules it becomes `WS-CAN-0027` with an owner, an acceptance criterion and a gate —
and it stops being something each audit rediscovers and re-apologizes for.
