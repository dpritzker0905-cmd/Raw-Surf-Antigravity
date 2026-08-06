# HANDOFF — 2026-08-05 (B) · production is a static shell, and the cause is now isolated
**For a fresh session. Everything here was measured at the artifact. Read §0 and §1 before acting.**

Evidence: `docs/research/MASTER-AUDIT-6.0-2026-08-05-state-of-truth-at-handoff.md`

---

## §0 THE FOUR THINGS THAT WILL BITE YOU FIRST

1. ⛔⛔ **EVERY PUSH TO `dev` IS A PRODUCTION BACKEND DEPLOY**, 5 to 30+ min, unbounded.
   **Batch your pushes.** `/api/health` embeds the deployed SHA — use it, never assume.
2. ⛔⛔ **A MERGE IS NOT A DEPLOY AND A DEPLOY IS NOT AN ARTIFACT.** Date the frontend with
   `curl -s https://<site>/service-worker.js | grep BUILD_VERSION`. Three separate handoffs claimed
   "one fast-forward ships it"; it has now been disproved three times by promotion.
3. ⛔ **`main` is protected** — 10 required checks, `enforce_admins: true`. A fast-forward works
   *only* when the target commit is green: `git push origin origin/dev:main`.
4. ⛔ **The map/forecast code lives in LAZY chunks.** Grepping only `main.*.js` finds 0 and lies.
   Enumerate the chunk manifest, and always carry a known-present control needle.

---

## §1 ⛔⛔⛔ THE TOP ITEM: PRODUCTION HAS ZERO WORKING API

```
rawsurf.netlify.app        BUILD_VERSION=3bd38a83   (2026-05-20)   /api/health=404
dev--rawsurf.netlify.app   BUILD_VERSION=4829da3c   (HEAD)         /api/health=200
git: main @ 4829da3c == dev @ 4829da3c
```

**6 of 6 `/api/*` paths 404 in production; all work on dev.** No forecasts, no login, no posts. The
landing page renders only because it is static.

**Why:** Netlify compiles `/api/*` proxy rules from `netlify.toml` **at build time**, and that file
**did not exist** at `3bd38a83` — the proxy landed 2026-06-04.

★★★ **THE CAUSE OF THE FREEZE IS ISOLATED, AND IT IS NOT THIS REPO.** `main` and `dev` are the same
commit, so the same tree builds in one Netlify context and not the other. That rules out the ignore
rule, a code-caused build failure, and `main` being behind — all at once.

⇒ **ACTION (owner, dashboard only — nothing in the repo can do this):** check, in this order —
1. the site's **production branch** is not `main`;
2. **auto-publish disabled**, or the production deploy is **locked/pinned** to a build;
3. the **production context build fails** while branch deploys succeed.

⛔ **Do not "fix" this with another promotion.** That experiment has been run three times.

---

## §2 STATE AT HANDOFF

* `main` = `dev` = **`4829da3c`**, backend deployed and healthy, 10/10 required checks green.
* Backend suite **2,337 passed / 2,928 skipped / 0 failed**. LOC ratchet exit 0.
* **E2E 40 passed / 8 failed** — it was 12/32 this morning, and before today it had never run at all.
* ERA5 campaign **dead at 141/150** (banked 140), task result `0x41306 TERMINATED`, auto-resume
  hourly. **Verify it advanced past 141.**
* Residual accrual healthy: 5,928 rows / 60 buoys, newest segment 18.9 h old.
* Memory: 305 files; index 18.6 KB against a 17.1 KB target — over, and the next reduction must
  retire a whole topic, not shave prose.
* Working tree carries another session's untracked `backend/scripts/geometry_backfill.{json,sql}` —
  **stage by path, never `git add -A`.**

---

## §3 THE QUEUE, IN JACOBIAN ORDER

1. ⛔⛔⛔ **Unfreeze the production frontend** (§1). Everything user-facing is behind this, and it is
   a dashboard change. **[OWNER]**
2. ⭐⭐ **The 8 remaining E2E failures** — `weather-simulation.spec.js:209` and `:272` × 4 browsers.
   Measured: `/map` loads with the stub and the awaited element **is** visible, so it is **not** the
   auth gate; they fail on the later assertions (model selection, layer toggle, timeline scrub,
   telemetry, canvas). **Undiagnosed — read the failing assertion, do not infer from adjacent logs.**
3. ⭐⭐ **Input compression** — the largest live height error (+0.387 m at 0-0.5 m, −0.409 at
   2.5-10 m). ⛔ **A global quantile map is a measured NO-GO** (2 of 5 bands regress on MAE; 57.7%
   of residual variance is between-buoy). The path is **per-site**, and it is gated on accrual: the
   bands with the largest bias have **3 buoys each**. Roughly six weeks out. **Watched, not blocked.**
4. ⭐ **Disconnect Vercel** — 8/8 production and 6/6 preview builds fail; it is the only source of
   GitHub `deployment_status` and nothing gates on it. **[OWNER]**
5. ⭐ **245 CI-orphan test files** — re-introduce with `timeout-minutes` FIRST, in batches small
   enough that a hang names its own file. 7 live failures are already known to be in there.
6. **`RATING_LOCAL_SIZE`** — go/no-go says **GO** (SANE, 1773/1773 coverage) but the A/B is **9.4×
   more DOWN than UP**, median −3.5. ⛔ It is a **category error** as a score multiplier (the
   literature rates surfability on absolute, skill-stratified thresholds; ours would rate 1.39 m
   `poor` and 0.42 m `fair_good`). Use it as a separate rarity axis. **[OWNER DECISION]**
7. **`RATING_BREAKER_TYPE`** — the 12.96 MB bed-slope asset is bundled and reaching 0 spots, but
   ⚠️ the Iribarren classifier it feeds is **contested** (Moragues 2020; Díaz-Carrasco 2020: "not a
   sufficient similarity parameter"), and the γ ceiling now neutralises the slope contamination
   anyway. **Lower priority than it looks.**

---

## §4 ⛔ WHAT NOT TO REDO — claims already killed, with the evidence

* **"One fast-forward ships the frontend."** Disproved three times by promotion.
* **"The `netlify.toml` ignore rule freezes the build."** Tested: empty `CACHED_COMMIT_REF` exits 1.
* **"`/api/site-access` 404s."** It returns **200**; CORS is correct on both origins.
* **"γ is `SURF_HEIGHT_H110`'s cancelling partner."** Disjoint sets — γ bites only where the depth
  cap binds. The partner is **refraction** (`REFRACTION_KR=0.797`), and both shipped together.
* **"The E2E flow needs an auth fixture."** The existing localStorage stub passes the route guard.
* **"`spot-card` is the spot selector."** It does not exist; spots are `trending-spot-<uuid>`, and
  clicking one **navigates** to `/spot-hub/<uuid>`.

---

## §5 THE HOUSE RULES THIS SESSION EARNED THE HARD WAY

* ★★★ **Verify at the artifact.** `/api/health` for the backend, `service-worker.js` for the
  frontend. Both existed the whole time; nobody used them.
* ★★★ **A citation is not a range check.** `GAMMA_MAX_STEEP=1.25` carried two real citations while
  sitting 54% above anything either source observed. Constants now declare a published range.
* ★★★ **When a gate ANDs several conditions, measure EVERY term before fixing one.** Correcting the
  E2E environment string alone would have run zero tests — the same `if` also required
  `state=='success'` from a provider that fails 100% of the time.
* ★★★ **A test's NAME can be its only spec.** Renaming `bottom nav is visible on mobile` deleted the
  constraint and broke it on 3 of 4 browsers.
* ★★ **A watcher whose subject you kill becomes immortal.** Two waiters polled for 17.5 h after the
  workflow they watched was stopped. Stop the watchers with the watched.
* ★★ **Always carry a control.** A bundle grep returning 0 for every needle *including the control*
  is a broken instrument, not a finding.
* ★★ **`"x" in src` is never a needle only the real thing produces.** The fix pattern is
  `ast.unparse` — comments are not AST nodes.
