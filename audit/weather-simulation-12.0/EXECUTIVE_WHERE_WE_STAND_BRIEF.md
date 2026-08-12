# EXECUTIVE BRIEF — WHERE THE WEATHER SIMULATION PROGRAM STANDS

**2026-08-12 · `dev` @ `3ec3fd13` · no production code modified**

---

## The one-line answer

**The code is in better shape than the program's paperwork suggests, and the instruments are in
worse shape than its green dashboards suggest.**

---

## What the program actually produced

35 audit reports. 5 executed program audits. 6 commissioning prompts, one of which — **Audit
11.3** — was written, advised against, and never run. **56 canonical engineering tasks**, of which
**9 are verified complete at HEAD by evidence gathered in this audit**, 36 have not started, and
**0 have regressed in code.**

## The three things you need to know

### ① Your accuracy gate says OK while your own log says you are losing

Scheduled run `31606511901`, today at 14:23Z, ends **`verdict: OK`**. Eleven lines above that, in
the same log:

```
vs open_meteo_marine +24h  n=1770  ours=0.181  theirs=0.143  win=41%  WE LOSE
vs open_meteo_marine +48h  n=1796  ours=0.202  theirs=0.150  win=39%  WE LOSE
vs open_meteo_marine +72h  n=1678  ours=0.215  theirs=0.151  win=38%  WE LOSE
vs persistence      +24h  n=1790  ours=0.183  theirs=0.176  win=46%  WE LOSE
```

The gate grades absolute MAE (0.176 m) against a threshold (0.40 m) and passes. It does not grade
the paired comparison at all. **Audit 11.1 named the exact fix on 2026-08-10 — "adding a
persistence + Open-Meteo row to the RED criterion is still unstarted" — and it is still unstarted.**
The sample has since more than doubled and the direction has not changed.

*The fair counterweight:* the gap is narrowing (+0.050 → +0.038 at +24 h; 39% → 41% win rate), and
you beat naive persistence at +48 h and +72 h. There is real skill at longer leads. There is not
yet skill worth defending at +24 h.

### ② The most recent audit's blocking verdict does not hold

Audit 11.4 (yesterday) published **Gate C = FAIL**, **"NEXT ENGINEERING GATE NOT AUTHORIZED"**, and
authorized one mission: fix the verdict-cache test harness. **That harness was already fixed 22
minutes before the report was published** — and the audit's own `MUTATION_RESULTS_FINAL_10of10.json` (M1-M7) + `MUTATION_RESULTS_ROUND2_FINAL_10of10.json` (M8-M10),
committed in the same commit as the FAIL verdict, already recorded all ten mutants caught.

I did not take either document's word for it. I applied two content mutations at HEAD in an
isolated worktree:

```
hit returns all-ONE mask  → 2 failed, 52 passed   CAUGHT
hit returns all-ZERO mask → 2 failed, 52 passed   CAUGHT
control                   → 54 passed             clean
```

**The guardrail holds. Gate C is PASS.** One small piece of that packet is genuinely still open (a
non-vacuity guard) and is in the NOW list.

### ③ Five audits, zero recordings

Every prompt since 11.0 required screen recordings, React Scan, React Profiler, performance
profiles and heap snapshots. A file-type census of all four audit evidence directories returns
**0 videos, 0 screenshots on disk, 0 Playwright traces, 0 HAR files, 0 heap snapshots, 0 CPU
profiles.** Every audit disclosed this honestly. None closed it. Audit 11.0 wrote the fix itself and
called it *"this audit's single largest evidence gap"*: one Playwright config key.

At HEAD, `playwright.config.js` still has no `video` key.

---

## What is genuinely good, and should not be touched

- The **ONE FORECAST COMPOSITION** chain with exactly one write site for `surf_height_m` — verified
  again at HEAD.
- **All three of Audit 11.2's "Critical" truth-layer defects are closed** and independently
  re-verified today: the provenance class now has seven states including *cannot determine*; the
  parity gate now REFUSES on unsampled input; and the orphaned parity read that was blind for ~10
  weeks now points at the symbol something actually writes.
- **No code regression, second audit running.** 100+ commits moved not one served forecast number.
- The rendering, projection and GPU-lifecycle layers, which two audits independently called the
  best-engineered parts of the system.
- **This program under-claims.** The one claim that failed verification here was *pessimistic*.
  That is much the better failure mode.

---

## What is quietly not fine

| | Measured today |
|---|---|
| `GET /api/weather/grid_series` | p50 **5.0 s**, p99 **31.1 s**, **36.8%** of requests over 10 s |
| Process memory | peak RSS **1,781 MB of a 2,048 MB** cgroup limit = **87.0%** |
| `GET /api/health` | p99 **15.7 s** — the endpoint an uptime probe would watch |
| Production frontend | `BUILD_VERSION 3bd38a83` (2026-05-20) — **84 days behind HEAD** |
| `run_time` on a live point response | `12:59:41Z` on an `18:00Z`-cycle product — provably ingest time, not the model cycle |
| `resolution` on a live point response | `null`, on a fully-resolved authoritative native product |
| Stale git worktrees | **6** (Report 11.0 flagged 1 as a hazard) |

---

## Do these five things next

1. **WS-CAN-0026** — add the paired persistence + Open-Meteo rows to the accuracy RED criterion.
   *One file. The numbers are already computed and printed.* **This is the authorized mission.**
2. **WS-CAN-0027** — set Playwright `video: 'retain-on-failure'`. *One config key. Closes a
   four-audit evidence gap.*
3. **WS-CAN-0025** — an external uptime probe. *Ranked P0 by Audit 11.0; never started.*
4. **WS-CAN-0010** — the last fabricated status surface (`system.py:208`, `error_rate = 0.5  #
   Placeholder`). *Two of three already shipped.*
5. **WS-CAN-0045** — the non-vacuity guard. *One assertion. The only open stage of the 11.4 packet.*

## Five things only you can do

Unfreeze the production frontend · rotate the two committed credentials in `BRAIN_RULES.md` · read
the Render env-var screen · uninstall the Vercel GitHub App · decide the calibration bound (**never
widen it**).

## Do not start

Zarr, JAX, SWAN-class nearshore models (priced and rejected three times each) · WebGPU (frame rate
is currently unmeasurable) · AI bias correction (nothing validated to correct toward — see ①) ·
any flag flip · any canary · **any sixth broad audit**.

---

## The governance change that matters

> **`CANONICAL_TASK_REGISTER.csv` is now the program's source of truth. Future sessions update it in
> the same commit that publishes their report. The next review is gate-specific, not another broad
> audit.**

The failure mode was named in advance, on 2026-08-11, by the session that wrote both the 11.3 and
11.4 prompts:

> *"The next artifact should be a one-page gate ledger you **update**, not a new report you
> **author**."*
