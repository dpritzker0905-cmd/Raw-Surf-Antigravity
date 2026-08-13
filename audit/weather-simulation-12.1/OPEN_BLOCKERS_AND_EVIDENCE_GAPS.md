# OPEN BLOCKERS AND EVIDENCE GAPS — Audit 12.1

What this audit **could not** establish, and what would close each gap. Stated plainly, because the
program's strongest property is that it does not claim evidence it does not have.

---

## 1. Evidence this audit could not produce

| Gap | Why | What would close it |
|---|---|---|
| **Screen recordings, screenshots, Playwright traces, HAR captures, heap snapshots, CPU profiles** | The agent browser pane **does not composite frames while hidden** — two screenshot attempts, one after explicitly fronting the tab, both returned *"the page is not compositing frames"* (LV-08). This is the same physical fact 11.2 found from the other side (RAF ~1 frame/5 s unfocused) | `WS-CAN-0027` — Playwright runs its own compositing browser and is not subject to this at all |
| **Any frame-rate measurement** | Same cause. Every FPS reading in the program remains correctly retracted | `WS-CAN-0037`, after 0027 |
| **The `blockedDetail` value at the zoom floor** | Requires interactive map manipulation at z2 with a weather layer active; the pane's non-compositing state makes layer activation unverifiable in the same session | The authorized mission's Step 0 |
| **A sustained-load capacity or memory profile** | Both health readings are short windows (31 min at 12.0, 44 min here) on uncontrolled traffic | One deliberate load run against a known request mix |
| **Whether `grid_series` latency genuinely improved** | n fell 133 → 22 between the two readings. Different populations. 12.0's own CON-08 warns against exactly this comparison | A same-n, same-window comparison |

⚠️ **Do not read the memory figure as progress.** Peak RSS 60.7% here vs 87.0% at 12.0 is a
*different reading*, not an improvement. The honest claim is **"the 87% figure is not reproduced in
this window."**

---

## 2. Claims carried forward from 12.0 that 12.1 did **not** independently re-verify

Recorded so no reader mistakes silence for confirmation:

- **WS-CAN-0013** GPU hygiene item (c), the encoder error-rollback — unverified for a second audit.
- **WS-CAN-0033** z-tier non-determinism — **not measured since 11.2**. It may have closed by
  accident. Cheapest item in the VERIFY NOW lane.
- **WS-CAN-0043** arbiter shadow-divergence rate — `arb_shadow_diverge` never read.
- **WS-CAN-0012** the two unported wind-engine invariants (OOB cull, in-place reseed).
- **WS-CAN-0017** the pipeline integrity chain — 12.0's `hashlib` census accepted, not re-run.
- **WS-CAN-0021** the committed credentials — pattern match accepted from 12.0; values deliberately
  not reproduced or re-read.
- The 551-source audit index and the 3 same-number collisions — accepted from 12.0.

---

## 3. Findings with a confirmed mechanism but an unconfirmed share of the blame

| Finding | Confirmed | Unconfirmed |
|---|---|---|
| **WS-CAN-0059** E2E handler | The substring bug was real, and five consecutive completed greens followed the fix | **Why Chrome passed pre-fix with the identical handler.** Now unanswerable — no failures remain to attribute. Closed **by repair**, not **by explanation** |
| **WS-CAN-0061** zoom floor | `blocked: model_lock` is the branch taken | Which side of the comparison is wrong |
| **WS-CAN-0064** `conditions/batch` | `over_10000ms` = n on both readings — unambiguous | The p50 figure sits in a bucket upper bound; the defensible claim is *"every sampled call exceeded 10 s, max observed 58.7 s"*, not *"the median is exactly 58.7 s"* |

---

## 4. Owner-gated — no engineering will move these

| Item | Task | Cost | Clock |
|---|---|---|---|
| **The accuracy-gate threshold decision** | `WS-CAN-0026` | one decision | ⏰ **due before 2026-08-22** — the gate arms and, on current data, **pages** |
| Unfreeze the production frontend | `WS-CAN-0039` | one decision | 85 days and counting |
| One heartbeat URL + a non-GitHub scheduler | `WS-CAN-0025` | minutes | the probe is built and running nowhere |
| Rotate the two committed credentials | `WS-CAN-0021` | minutes | history retains them regardless of any edit |
| Prune five stale worktrees | `WS-CAN-0055` | minutes | ⚠️ they may hold another session's work — **do not force-remove blind** |
| `SURF_TIDE_DEPTH` | `WS-CAN-0053` | one decision | evidence now exists (6 samples, 5 null, harness proven to see a 38.1-pt move) |
| Read the Render env-var screen | `WS-CAN-0040` | one screen | bounds several flag-state questions |

---

## 5. Structural constraints on this audit, disclosed

1. **Two concurrent sessions share `dev`.** Roughly 2 of every 3 commits in the post-12.0 window were
   another session's. `git commit -o <paths>` isolates a commit; **nothing isolates a push**, and a
   concurrent push can carry your commits and deploy them. This audit therefore **wrote nothing
   outside `audit/weather-simulation-12.1/` and pushed nothing.**
2. **Intermediate commits get no CI.** `e88be1af` has zero workflow runs — a concurrent push carried
   it, so GitHub started workflows only for the tip. **A per-commit reading of CI history asserts
   things that did not happen**, and this audit's E2E analysis was therefore done per-*run*, not
   per-commit.
3. **The E2E lane could not be dispatched to verify.** `github.ref` is `refs/heads/dev` for both push
   and `workflow_dispatch`, so a dispatch shares the concurrency group and cancels the run it was
   meant to replace. This audit waited for natural pushes instead — and five arrived.
4. **The map surface was read through an authenticated session already present in the environment.**
   No credentials were entered, no account created. `/map` is a `ProtectedRoute`; an audit without a
   pre-existing session cannot reach it at all — which is worth recording as a standing constraint on
   every future browser audit.

---

## 6. The single largest remaining evidence gap in the program

**Nobody has ever seen this application render a weather field in a controlled, recorded way.**

Six audits, zero recordings. Projection is certified by arithmetic and API probes; row reversal and
UV flip are unverified in **either** direction; frame rate is unmeasurable; and the two blank-render
defects found this cycle were both discovered by an *owner looking at the screen*, not by any
instrument the program owns.

**That is the gap `WS-CAN-0027` closes, it costs one config key, its blocker cleared on 2026-08-13,
and it has been named by five consecutive audits.**
