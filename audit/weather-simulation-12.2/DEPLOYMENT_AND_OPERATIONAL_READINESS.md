# DEPLOYMENT AND OPERATIONAL READINESS — Audit 12.2

**Central question: can a repair that works locally be trusted in production?**

> **For the backend: yes for correctness, no for safety.** CI is thorough and green with content, but
> it runs *beside* the deploy rather than in front of it, on a branch with no protection object at
> all, into a single production backend, ~29 times a day.
>
> **For the frontend: the question does not arise.** Production has served a 2026-05-20 artifact for
> **85 days**. Nothing tested at HEAD reaches a production user.

---

## 1. Dev / staging / production parity

| Surface | Production | Dev | Parity |
|---|---|---|---|
| Backend | Render, `2.0.0-stage-6f-v1-`**`172f66aa`** | *(same service — there is no separate backend staging)* | **There is one backend.** dev and prod are the same box |
| Frontend | `rawsurf.netlify.app`, SW `3bd38a83` (2026-05-20) | `dev--rawsurf.netlify.app`, SW **`791fdf78` = HEAD exactly** | ⛔ **85 days apart** |
| Config | Render dashboard only | same | `render.yaml` is **not applied** — see §3 |

**There is no staging backend.** "Dev" and "production" name the same Render service. Every push to
`dev` that touches non-doc paths deploys the box that serves production users.

## 2. The deploy path, measured

```bash
git log --since="2026-07-31" --oneline dev | wc -l                 # 595 commits / 14 days
# commits touching anything outside docs/, audit/, *.md (past the live buildFilter):
#                                                                   401  (~29/day)
gh api repos/…/branches/dev/protection                             # HTTP 404 "Branch not protected"
```

| control | state |
|---|---|
| Branch protection on `dev` | **none — the protection object does not exist** |
| Required status checks before deploy | **none.** Render's `autoDeploy` watches the branch, not CI |
| Canary / phased rollout | **none.** Blocked anyway on `WS-CAN-0044` (`p2.py` precedence inversion) |
| Rollback runbook / named known-good point | **none found** |
| Health-gated promotion | **unknown** — `healthCheckPath` is not in git, and `render.yaml` is not applied |

**Compensating controls that genuinely exist**, recorded so this is not inflated:

- `buildFilter = {"ignoredPaths": ["docs/**","audit/**","**/*.md"]}` — set via the Render API on
  2026-08-10 after a **measured** incident: a single-markdown commit redeployed production and
  restarted the box under an in-flight E2E run (`bed6c08c` live 17:28:30, `8be9dd56` live 17:32:10).
- `e2e-tests.yml:79-82` waits for the deployed `BUILD_VERSION` to prefix the pushed SHA before
  testing — so the E2E lane at least grades the right artifact.
- CI is genuinely strong and green **with content**: backend `collected 1779 tests across 150 files →
  1712 passed, 67 skipped, 0 failed`; frontend `228 suites / 2138 tests passed`; E2E `Running 52
  tests` across four browser projects.
- **Zero code regressions across three consecutive audits.**

**The finding is therefore not "a bad deploy is likely."** It is that every gate in this program is
post-hoc: nothing exists to make a bad deploy *less* likely, and the blast radius is one production
backend serving every weather surface the program certifies.

## 3. Configuration lives where git cannot see it

`render.yaml:1-7`, verified three ways by a prior session on 2026-08-10:

> ⛔⛔ **THIS BLUEPRINT IS NOT APPLIED TO THE LIVE SERVICE** … it names `raw-surf-backend`; the live
> service is `Raw-Surf-Antigravity` … ⇒ **Every value in this file is DOCUMENTATION, not
> configuration.**

So the live service's ~27 env vars, `autoDeploy`, `buildFilter`, `rootDir` and `healthCheckPath`
exist **only in the Render dashboard**. `WS-CAN-0040` (owner, one screen) is the register's
acknowledgement.

⚠️ **One warning in that file is stale and I nearly filed it as a Critical.** Its header still reads
*"OWNER ACTION, OPEN"* for a `RATING_TIDE` lane divergence that
`backend/tests/test_flag_lane_parity.py:39` records as **CLOSED on 2026-08-10**. One line of
documentation, not a task. Full record: `evidence/runtime-paths/LV12-2-06`.

**What is genuinely uncovered is the flag-lane parity *class*.** `RATING_TIDE` = 0 occurrences in all
three registers (control: `SURF_TIDE_DEPTH` = 1). A guard exists for a defect that ran silently for
**eleven days** — an env flag set in the ingest lanes and not on the serve box, so the serve-time
fallback and the precomputed frames computed different physics — and by the test's own admission at
`:53`, *"Render's environment is not in git and CANNOT be checked here."*

The live env-var set is readable from the Render API. A scheduled diff against the ingest lanes'
flags would turn an eleven-day silent physics split into a red check, and would make `WS-CAN-0040` a
**repeating** control rather than a one-off screenshot.

## 4. Build and asset integrity

| | |
|---|---|
| Netlify build | `node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build`, `publish = "build"` |
| SW version stamping | `update-sw-version.js` injects the git short hash into `BUILD_VERSION`. It runs **first** in an `&&` chain, so a failure aborts the build — **fails closed** ✅ |
| SW cache invalidation | Cache names are keyed on `BUILD_VERSION`; `skipWaiting()` + `clients.claim()` activate immediately ✅ |
| Weather data in the SW cache | **none.** `grep -c "api/weather\|api/conditions"` → **0**; positive control `api/surf-spots` → **3**. **No stale-weather-via-service-worker hazard** ✅ |
| Worker asset paths under the production build | E2E runs against the built dev deployment and passes, which exercises this ✅ |
| `CI=false` in the build | deliberate — CRA treats warnings as errors under `CI=true`; the same choice is documented in `marine-nightly.yml:83` |
| Source maps | ⚠️ **published and anonymously served on both origins** (4.8 MB `main.js.map`, HTTP 200 on prod *and* on dev at HEAD). Owner decision — they are also what makes a production stack trace legible, and there is no other production error-reporting path |

## 5. The workflow estate

**27 workflow files.** 12.1's baseline manifest named 9 and reported "all green."

| | |
|---|---|
| success on last run | 25 |
| **failure on last run** | **1 — `marine-nightly.yml`**, red at HEAD, and failing **18 of its last 37 runs** |
| **never executed** | **1 — `python-upgrade-readiness.yml`**, which also carries **six** `continue-on-error: true` steps |

A readiness gate that has never run is not a control. And an optical regression net that is red half
the time, with nobody reading it, is worse than not having one — it consumes CI minutes and
manufactures the appearance of coverage.

## 6. Incident readiness

| Question | Answer |
|---|---|
| Is a production weather outage detectable? | **Yes** — `/api/health/data` returns 503 on a critical corpus and `data-health-monitor.yml` polls it every 30 min. It has already caught a real outage within one polling cycle (11.0 ledger `:77`). ⚠️ **Neither the endpoint nor the monitor appears in any register** (control: `uptime_probe` = 1) |
| Does anything **page**? | **No.** Everything surfaces as a workflow log or a warning. `WS-CAN-0025`'s dead-man's-switch is built, proven live, and scheduled **nowhere** — owner-gated on one heartbeat URL |
| Can a client-side incident be diagnosed? | **No** — see `OBSERVABILITY_AND_INCIDENT_READINESS.md` |
| Is there a known-good rollback point? | Backend: implicit (revert + push). Frontend: production is *frozen*, which is not the same as *rollback-capable* |
| Is failure evidence retained? | Accidentally well — `zoomlab-nightly` and `playwright-report`, 14 days each. Both currently expire **unread** |

## 7. Recommendations, in cost order

1. **Point the live Render `healthCheckPath` at `/api/health/data`** so a boot with an empty manifest
   fails promotion instead of being promoted. Owner, one screen, zero code. Append to `WS-CAN-0025`.
2. **Read the two expiring artifacts** (⏰ 2026-08-27) — see `PATH_FORWARD_12.2.md` V1/V2.
3. **Disposition the two anomalous workflows.** `marine-nightly` gets a register row and an owner;
   `python-upgrade-readiness` gets run once or deleted.
4. **Make `WS-CAN-0040` repeating** — a scheduled diff of the live env-var set against the ingest
   lanes closes the flag-lane parity class.
5. **A required status check on `dev`** before Render deploys. This is a governance change with a real
   cost (it slows a 29-deploys-a-day rhythm that is currently working), so it is an **owner
   decision**, not an engineering task — and it is honestly optional given three audits with zero
   code regressions. Recorded because *"no mechanism exists"* is a different statement from
   *"nothing has gone wrong."*
