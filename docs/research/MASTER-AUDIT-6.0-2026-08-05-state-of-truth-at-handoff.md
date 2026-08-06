# MASTER AUDIT 6.0 — STATE OF TRUTH AT HANDOFF
**2026-08-05 · every claim below re-measured at the artifact, at the time of writing**

> **THE ONE LINE:** `main` and `dev` are now the same commit and the backend serves it — but
> **production's frontend has not rebuilt across THREE separate promotions**, and a paired control
> proves the cause is Netlify site configuration, not this repository. Everything else shipped and
> is verified; that one item gates every user-visible thing in the product.

---

## §0 METHOD

This is not a summary of what was done. It is a re-measurement of what is **true right now**, taken
so a fresh session inherits evidence rather than assertions. Where a number could not be measured
cleanly it says so. Where a claim of mine died today, §4 records it rather than quietly dropping it.

---

## §1 DEPLOYED ARTIFACTS — measured, not inferred

```
git         main @ 4829da3c    dev @ 4829da3c    main behind: 0
backend     /api/health -> 4829da3c   healthy   db connected   (matches HEAD)

frontend    rawsurf.netlify.app        BUILD_VERSION=3bd38a83   /api/health=404
            dev--rawsurf.netlify.app   BUILD_VERSION=4829da3c   /api/health=200
```

### ⛔⛔⛔ PRODUCTION IS A STATIC SHELL — AND THE CAUSE IS NOW ISOLATED

Production serves a build of **2026-05-20**. It has now been promoted to **three times today**
(`431631e6` → `f8ab1ee4` → `4829da3c`) and has **not rebuilt once**.

★★★ **THE PAIRED CONTROL THAT SETTLES IT:** `main` and `dev` are the **same commit**. Same repo,
same `netlify.toml`, two Netlify contexts — **one builds, one does not.** That eliminates every
repo-side explanation simultaneously:

* **not** the `[context.production] ignore` rule — the dev context builds from the identical file;
* **not** a code-caused build failure — dev compiles the identical tree;
* **not** `main` being behind — it is not, and production still did not move.

⇒ **The cause is in the Netlify SITE SETTINGS.** Only three things produce this shape, in the order
worth checking: (1) the site's production branch is not `main`; (2) auto-publish is disabled or the
production deploy is **locked/pinned**; (3) the production context build fails while branch deploys
succeed. **Nothing in this repository can fix it and no further promotion will help.**

Consequence, measured: **6 of 6 `/api/*` paths 404 in production, all 200 on dev.** Netlify compiles
`/api/*` proxy rules from `netlify.toml` at build time, and that file **did not exist** at
`3bd38a83`; the proxy landed 2026-06-04. So production has no forecasts, no login, no posts — the
landing page renders only because it is static.

---

## §2 TEST + GUARD STATE

| instrument | state |
|---|---|
| backend suite | **2,337 passed / 2,928 skipped / 0 failed** (22:07) |
| E2E | **40 passed / 8 failed** — was 12/32 this morning |
| required checks on `4829da3c` | **10 / 10 success** |
| LOC ratchet | exit 0, 12 grandfathered, 0 new, 0 regressed |
| science-registry out-of-range ratchet | **empty** — created and paid off the same day |

**The 8 remaining E2E failures** are `weather-simulation.spec.js:209` and `:272` × 4 browsers.
Measured: with the localStorage stub, `/map` loads and `featured-photographers-btn` **is** visible,
so they are **not** the auth gate. They fail on the later assertions (model selection, layer toggle,
timeline scrub, telemetry, wave-animation canvas). **Undiagnosed, deliberately not guessed at.**

⚠️ **2,928 skips are one gate, not many.** `tests/conftest.py::pytest_collection_modifyitems` skips
every module defining a module-level `BASE_URL` when `REACT_APP_BACKEND_URL` is unset. Deliberate —
but closing that gate and running the estate against production gave **21 passed / 7 FAILED**, at
least 2 confirmed real. **The skip hides live defects, not legacy noise.**

---

## §3 SERVED PAYLOAD — n=95, US-West viewport, ONE frame `2026-08-06T01:00:00Z`, GFS, `precomputed`

| field | live |
|---|---|
| `directional_conflict` | 19/95 = **20.0%** |
| `breaker_xi` | **0/95** — `RATING_BREAKER_TYPE=0`, as expected |
| `confirmed` | **0/95** — obs gate off, as expected |
| `geometry_readiness` present | 95/95 |
| geometry **degraded** | 17/95 = **17.9%** |
| height ft | p10 2.6 · median 3.4 · p90 5.9 · max 6.4 |

⚠️ **Scope discipline:** this is a US-West sample. The 8-viewport census earlier today (n=779) gave
**34.0% degraded**; 17.9% here is regional variation, not a change. Quote the n and the frame.
⚠️ **The height pair is NOT confirmed by this table.** Median moved 3.2 → 3.4 ft vs this morning,
which is *consistent* with the shipped +1.2% — but the frame and the weather both changed, so it is
not a controlled comparison. A clean before/after needs the same sea state, which serving data
cannot provide.

---

## §4 ⛔ CLAIMS THAT DIED TODAY — seven, and five were mine

| claim | verdict |
|---|---|
| "one fast-forward ships the frontend fixes" — 3 handoffs | **FALSE.** Three promotions, no rebuild |
| the `netlify.toml` ignore rule is the cause | **REFUTED** — empty `CACHED_COMMIT_REF` exits 1, not 0 |
| "`/api/site-access` 404s on every page load" (mine) | **FALSE** — returns **200**; CORS correct. I conflated two adjacent console lines |
| γ is `SURF_HEIGHT_H110`'s cancelling partner (mine) | **FALSE** — disjoint sets. The partner is **refraction**, Kr 0.797 |
| a global quantile map fixes input compression | **NO-GO** by the repo's own fitter — 2 of 5 bands regress; 57.7% of variance is between-buoy |
| the E2E flow "needs an auth fixture" (mine) | **FALSE** — the existing localStorage stub passes the guard |
| "bottom nav is present for a signed-in user" (mine) | **FALSE** — mobile-only; failed 3 of 4 browsers |

★★★ **Every one fell to a measurement, a control, or a mutation. Not one fell to a suite going
green.** Two were caught only because I added a control that had to reproduce a known value
(Pipeline 45.52 ft) or re-ran an unmutated case at the end.

---

## §5 LONG-RUNNING WORK

**ERA5 climatology campaign — DEAD, and it self-heals.**
```
last log line   141/150 (Bull Bay) at 22:51:06Z; log untouched 65+ min
process         NONE alive (the 5 live pythons are uv cache builds + the WeatherSim MCP)
scheduled task  RawSurf ERA5 Climatology Campaign
                LastRun 19:00:01   LastResult 267014 = 0x41306 SCHED_S_TASK_TERMINATED
                NextRun 20:00
```
Terminated, not crashed — which is why the log holds no traceback. Banked **140**, and resume is
proven to shrink scope by exactly the banked count. **Verify after 20:00 that it advanced past 141.**

**Residual accrual — healthy, and it gates the largest open height error.**
5,928 rows / 60 buoys; newest segment 18.9 h old (bound is 48 h). Per-site fit readiness:
`0-0.5 m: 3/16 · 0.5-1.0: 37/46 · 1.0-1.5: 26/55 · 1.5-2.5: 15/43 · 2.5-10: 3/17`.
⚠️ **The two bands that are ready are the two that barely need correcting** (+0.132, −0.035); the
bands carrying ±0.4 m have three buoys each and fill slowest because those seas are rare.

---

## §6 WHAT SHIPPED TODAY — 14 commits, all on `main` and `dev`

**Science.** The height pair: γ ceiling 1.05/1.25 → **0.81** (Carini's field-observed envelope) +
new `REFRACTION_KR=0.797` + `SURF_HEIGHT_H110` default ON. Measured median **+1.2%**, p10 −17.8%,
**Pipeline 12 m/18 s 45.5 → 29.5 ft**. Legacy-restore control reproduces 45.52 ft exactly.

**Governance.** `science_registry.py` — every constant with provenance, method, sample and
**published validity range**, guarded by a mutation-tested ratchet. *A citation is not a range check.*

**Reach.** E2E trigger fixed (0 of 1,000 runs → running); Playwright installing 2 of its 4 declared
browsers; the encoding guard enabled after **0 runs in its entire life**; `booking-flow.spec.js`
rewritten against measured routes and selectors.

**Instruments.** Media-privacy contracts converted from substring to AST (they passed against
modules with zero executable nodes); the data-health tier misassignment fixed (21% false-page);
`residual_accrual_census.py` added to watch the resource the height fix is gated on.

**Memory.** Restructured into a router with two domain indexes; 305 files, index 18.6 KB.

---

## §7 THE STRUCTURAL LESSON

Every expensive defect found today was a **reach** defect, not a correctness defect:

* production 77 days stale · a job that ran 0 of 1,000 times · a guard with 0 runs ever ·
  a browser never installed · a security test passing on empty modules · a 12.96 MB asset bundled
  and unused · a monitor paging 21% until nobody reads it · two watchers that outlived their subject
  by 17.5 hours.

★★★ **Making a thing RUN is what turns its latent defects into visible ones.** The E2E suite had
been broken since the day it was written and nothing could tell anyone. The same is true of
production right now.
