# RV-10 — Pooled census verdict, and a standing rule that turned out to be wrong

| Field | Value |
|---|---|
| Evidence ID | RV-10 |
| Pool | 9 runs, ~7 distinct hours, 2026-08-12T21:00Z → 2026-08-13T03:00Z, 45-min spacing |
| Artifacts | `RV-09_model_skill_census.jsonl`, `RV-10_pool_progress.log`, `RV-10_pool_analysis_output.txt` |
| Reproduce | `python RV-10_pool_analysis.py` |
| ⚠️ Provenance | The artifacts landed in commit `14750962` — **a concurrent session's commit, about something else.** See §4 |

---

## 1. STRUCTURAL — what 9 runs genuinely settle

Provider routing is not weather, so a handful of runs does settle it. **The decomposition holds:**

| EURO served by | n range | EURO MAE | GFS same sites | better by |
|---|---|---|---|---|
| **`ecmwf`** | 33–39 | 0.1676 | 0.1780 | **5.9%** |
| `copernicus` | 12–23 | 0.1751 | **0.3291** | 46.9% |
| `gfs_estimated_fallback` | 3–12 | 0.1463 | **0.4410** | 68.2% |

Sites routed **away** from ECMWF: **20–26 of 60, in every run.**

Pooled headline: EURO 0.1658 vs GFS 0.2493 = **33.5% better**. Like-for-like on comparable
coverage: **5.9%**. The single-run figure was 2.9%; pooled it is 5.9%. **Both remain an order of
magnitude below the headline** — which is the finding WS-CAN-0058 rests on, and why WS-CAN-0057
stays *do not flip*, now on nine runs rather than one.

## 2. WEATHER — real, and not what it looks like

EURO was `best_model` **9/9**, closest at 28–37 buoys of 60 (GFS 15–21, ICON 4–13), and won every
sampled band **9/9**.

⛔ That reads as overwhelming and is not. **9 runs over 7 hours sample ONE synoptic situation**, and
at r > 0.95 hourly autocorrelation the effective independent sample is closer to **1–2**. Nine
consistent readings of the same weather is one reading. The analysis script prints this above its
own numbers so the caveat cannot be separated from the result.

## 3. Two checks run before trusting any of it

**Sampler homogeneity.** The pool invokes the census from the **working tree**, and the branch moved
seven times underneath it while a concurrent session worked. `model_skill_census.py` was untouched
throughout, so the nine runs are **one instrument**. Had it changed mid-pool I would have averaged
two yardsticks and called it a trend.

**The empty tail is real.** `big >3m` came back NOT SAMPLED in all 9 runs. The concurrent session's
`b5632fc7` — *"the uniform draw could never reach the tail"* — is about `spot_ratings.py`, a
different sampler, but it raised the obvious question about mine, so I tested rather than assumed:

```
fresh NDBC stations with a usable WVHT : 204
stations reporting >3.0 m right now    : 0
census stride picks 60 of 204, of which >3 m: 0
sampled Hs  max 2.80  p90 1.60  median 0.60
ALL     Hs  max 2.80  p90 1.60  median 0.60
```

**The sampled distribution is identical to the full one.** The stride is not hiding a tail; there is
no tail. The empty band is an honest absence — right for the right reason, but only because it was
checked.

⇒ **The tail question is not closed, it is rescheduled.** The band that decides EURO's bias trade
and the tail's value in WS-CAN-0058 needs a **storm**, not more runs. A calendar dependency, not an
engineering one, and no amount of pooling substitutes for it.

---

## 4. ⛔ A standing rule was refuted tonight, and the correction matters

Project memory carries this, and I followed it all session:

> *"concurrent sessions share this tree AND `dev`. **Stage BY PATH** — but that isolates a COMMIT
> and ⛔NOTHING ISOLATES A PUSH: theirs ships yours."*

**The first half is wrong.** I staged five files by path and wrote a commit message carrying this
analysis. Before I could commit, a concurrent session ran its own commit — which picked up **the
whole index, including my staged files** — and shipped them under
`14750962 fix(handoff): "ALONE against 1 nulls" …`, a message about an unrelated finding.

**Staging by path protects *their* work from *my* commit. It does not protect *my* staged work from
*their* commit.** The index is shared state, and staging is the act of putting your work into it.

| What I believed | What is true |
|---|---|
| Stage by path ⇒ my commit contains only my files | ✅ still true |
| Stage by path ⇒ my files end up in *my* commit | ⛔ **false** |
| Only a *push* is unisolatable | ⛔ **false — the index is too** |

**Consequence, and it is not cosmetic:** the artifacts survived intact and the register carries the
pooled evidence, so nothing was lost. But the *reasoning* — §1–§3 above — would have existed only
in a commit message that was never written. **This document exists because the commit that was
supposed to carry it was taken.**

⭐ **The durable lesson: put the reasoning in a file, not only in a commit message.** A commit
message is single-writer state on a shared branch. In a two-agent tree it can be lost between
`git add` and `git commit` — a window I did not know existed until it closed on me.

*(Practical mitigation for a future session: `git commit -o <paths>` commits only the named paths
regardless of index state, or stage-and-commit as one step. Neither was used here.)*
