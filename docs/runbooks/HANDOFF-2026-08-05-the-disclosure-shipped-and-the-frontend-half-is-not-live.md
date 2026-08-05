# HANDOFF — 2026-08-05 · the disclosure shipped; the frontend half is not live
**For a fresh session. Everything below is measured. Read §0 and §1 before doing anything.**

---

## §0 THE THREE THINGS THAT WILL BITE YOU FIRST

1. ⛔⛔ **EVERY PUSH TO `dev` IS A PRODUCTION BACKEND DEPLOY.** Render deploys from `dev`, and the
   deploy takes **5 to 30+ minutes** — a docs-only push took production down for ~30 min on
   2026-08-05. **Batch your pushes.** `/api/health` embeds the deployed SHA; use it to see what is
   actually running. `keep-warm` fires at **4.9% of nominal** (median gap 90.5 min), so its green
   history proves nothing about deploys.

2. ⛔ **`main` IS NOW PROTECTED** — 10 required checks, `enforce_admins: true`, no force-push, no
   deletions, linear history. A promotion is still a plain fast-forward: required checks attach to
   the COMMIT, so `git push origin origin/dev:main` works when `dev` is green. **`enforce_admins:
   false` is not protection** — with it off the owner's push is merely logged as `Bypassed rule
   violations`. Verify by pushing, never by reading the config.

3. ⛔ **`loc-check` must never become a required check.** It has a `paths:` filter, and a required
   check that a filter skips is reported **MISSING**, which blocks the branch permanently. Backend
   LOC is still gated on every push by `ci.yml`'s `backend-file-size-check`, which has no filter.

---

## §1 ⛔ THE TOP ACTION: THE FRONTEND HALF IS NOT IN PRODUCTION

`dev` is **11 commits ahead of `main`**, and Netlify serves production from `main`.

```
production   rawsurf.netlify.app       → main.e1515b31.js
dev preview  dev--rawsurf.netlify.app  → main.be9571b6.js
```

Live in production (backend, via `dev`): `directional_conflict` on all four surfaces ·
`find_best_spot` ranking fix · alerts now state the quality.

**NOT live** (frontend, needs `main`):

* the spot glyph still shows the **best score within 111 km**, not the spot's;
* the fourth whitelist still **drops** `directional_conflict` before the glyph;
* 74 controls still announce as the literal word **"div"**.

⇒ **One fast-forward ships all three**, and `dev` is green on all 10 required checks:

```bash
git fetch origin && git push origin origin/dev:main
```

---

## §2 WHAT SHIPPED THIS SESSION (19 commits)

| area | what |
|---|---|
| **disclosure** | `directional_conflict` on all 4 surfaces + 2 Pydantic models + 3 point whitelists + the 4th (glyph) whitelist. **Verified live: 198/1005 on the API, 2,892/10,638 in the CDN blob.** |
| **governance** | `main` protected; CI/Lighthouse/LOC now run on `main`; the LOC gate went green (4 files, rationale moved to docs, not deleted) |
| **sim** | `find_best_spot` no longer flattens every ≥70 spot onto 69.9 (`""` is not `None`) |
| **alerts** | a blown-out 6 ft and a groomed 6 ft no longer send the identical "perfect conditions" push |
| **glyphs** | ±2-cell reducer: `max` → **nearest rated cell** (the window is 111 km) |
| **a11y** | 74 `aria-label="div"` deleted; 5 jsx-a11y rules armed as a **shrink-only ratchet at 775** |
| **guards** | behavioural three-surface parity (the existing one executes **zero lines** of the surfaces); the obs-gate asymmetry pinned as the DESIGN; the Weggel contamination pinned in both regimes |
| **CI** | the 5 ERA5 campaign guards (63 tests) now run — they ran nowhere before |

---

## §3 ⛔ WHAT I GOT WRONG (read this before trusting the commit messages)

**Two claims of mine shipped wrong and are corrected in the record, not quietly amended.**

1. **"The Weggel slope changes nothing."** Measured on 5 seas topping out at 8 m. On a wider range
   it moves the served height by **+75.4%** at Pipeline on 12–18 m swells — inert in the everyday
   regime, **not** inert on big-wave days. Corrected in `c0223a62`; the test file was **renamed**
   because its old name asserted the disproved claim.
2. **"My promotion caused the outage."** It did not — Render deploys from `dev`, and a *dev* push
   was the cause. I used an **hourly** probe to rule out a **5-minute** event, and the disproof
   (`uptime 898 s` ⇒ booted 4 min 56 s after a dev push) was already in my own evidence.

**And one thing I shipped broke CI:** the 243-file orphan lane hung every run (5 CI-only failures +
a 24-min hang). Local green was environment-specific. Reverted; the ERA5 half was kept because CI
itself confirmed it.

★★★ **The transferable lesson, three times over: `"x" in src` is almost never a needle only the real
thing produces.** An import line, a comment and a docstring all satisfy it. All three such guards
are now AST checks over live constructs.

★★ **A bound measured on a narrow range is a bound on that range only.** I wrote "no extra sea state
fixes it" as a property of the system; it was a property of my fixture.

---

## §4 THE QUEUE, IN JACOBIAN ORDER

1. ⛔ **Promote `dev` → `main`** (§1). Three user-visible frontend fixes are sitting undeployed.
2. ⭐⭐⭐ **The dual-floor reconciliation** — still the arc's #1. The height chain's exposure floor
   (0.595 → 0.354 energy) vs the quality chain's (0.100) is a 3.54× contradiction, now *disclosed*
   on every surface but not *fixed*. **Gated on ERA5** (76/150 in the current batch). ⛔ Do not
   patch either floor alone — the height is right by cancellation.
3. ⭐⭐ **The Weggel slope on big-wave days** (§3.1). Needs a real nearshore slope, an owner
   decision and a size A/B — it moves big-wave heights up to 75%.
4. ⭐⭐ **Re-introduce the orphan lane properly**: `timeout-minutes` first, identify the 5 CI-only
   failures, adopt in batches small enough that a hang names its own file. 244 real tests still run
   nowhere.
5. ⭐ **The 12 "2-of-3" whitelist fields** — pinned as a ratchet, never adjudicated. `surf_nearshore`,
   `valid_time`, `source` look the most suspicious.
6. ⭐ **19 unnamed interactive elements** (9 icon-only nav links, 10 inputs) — pre-existing, measured,
   now counted by the ratchet.
7. **`E2E Tests` has never run** — 5,102 of 5,102 skipped since May; the trigger filters on a
   Netlify environment name that never matches.

---

## §5 STATE AT HANDOFF

* `dev` @ `c0223a62`, **11 ahead of `main`**, all 10 required checks green.
* Production backend running `1cf2eb33`; frontend production running pre-session code (§1).
* ERA5 campaign healthy — 76/150 this batch, 70 banked, log fresh.
* `loc_ratchet` exit 0. ESLint gate green at baseline. `alerts.py` is at **784/800** — the next
  addition there needs its rationale moved to `docs/`, not deleted.
* ✅ **Full backend suite: 2,325 passed / 2,928 skipped / 0 FAILED (30:04).** The instrument that
  caught the undeclared flag last time now reports green. +30 passes over the previous run, matching
  the tests added this session exactly. Skip count unchanged at 2,928 — nothing was silenced.
* Memory index is **21.2 KB** against a 17 KB compaction mark. The next reduction has to retire a
  whole topic, not shave prose.
* Working tree carries another session's untracked `backend/scripts/geometry_backfill.{json,sql}` —
  **stage by path**, never `git add -A`.
