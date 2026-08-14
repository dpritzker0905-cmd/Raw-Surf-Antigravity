# LV12.2-06 — The deploy path, the unprotected branch, and a stale blocker I nearly reported as live

**Captured** 2026-08-13, HEAD `791fdf78`. Read-only: `git log`, `gh api`, file reads. No dispatches.

---

## 1. Measured deploy exposure

```bash
git log --since="2026-07-31" --oneline dev | wc -l                    # 595 commits in 14 days
git log --since="2026-07-31" --oneline dev -- backend/ | wc -l        # 246 touch backend/
# commits touching ANYTHING outside docs/, audit/ and *.md — i.e. past the live buildFilter:
#                                                                      401
gh api repos/…/branches/dev/protection
#   → HTTP 404  "Branch not protected"
```

| fact | value |
|---|---|
| Commits to `dev` in 14 days | **595** |
| …that would trigger a production backend deploy | **401** (~29/day) |
| Branch protection on `dev` | **none — the protection object does not exist** |
| Required status checks before deploy | **none** — Render's `autoDeploy` watches the branch, not CI |
| Production backends | **one** |

⚠️ **"No branch protection" is stronger than the program's prior note.** A memory landmine in this
repo records *"`enforce_admins:false` IS NOT PROTECTION"*. The measurement at HEAD is that there is
no protection **object** at all: GitHub returns 404, not a permissive config.

**Compensating controls that genuinely exist** (recorded so the finding is not inflated):
`buildFilter.ignoredPaths` suppresses docs-only deploys (set via the Render API 2026-08-10);
`e2e-tests.yml:79-82` waits for the deployed `BUILD_VERSION` to match before testing; the program has
**zero code regressions across three consecutive audits**; and `B12` kill-switch discipline is the
strongest habit in the codebase.

The finding is not *"a bad deploy is likely"*. It is that **CI runs beside the deploy rather than in
front of it**, so no mechanism exists to make a bad deploy less likely — every gate in this program
is post-hoc.

## 2. `render.yaml` is documentation, not configuration

Its own header, verified three ways by a prior session on 2026-08-10:

> ⛔⛔ **THIS BLUEPRINT IS NOT APPLIED TO THE LIVE SERVICE.** … it names `raw-surf-backend`; the live
> service is `Raw-Surf-Antigravity` … ⇒ Every value in this file is DOCUMENTATION, not configuration.

So the live backend's configuration — 27 env vars, `autoDeploy`, `buildFilter`, `rootDir` — exists
**only in the Render dashboard**, in no version-controlled artifact. `WS-CAN-0040` ("read the
production Render environment variable screen") is the register's acknowledgement of this, and it is
owner-gated.

## 3. The stale blocker — recorded because I nearly filed it

`render.yaml:8-12` reads as an open, live scientific divergence:

> ⚠️ **WHY THAT IS NOT HARMLESS:** … the serve box needs the flag so its LIVE spot-ratings fallback
> computes the same tide factor as the precompute lanes. **It does not have it.** So the serve-time
> fallback and the precomputed frames can disagree … **OWNER ACTION, OPEN.**

That is a serious claim — a live lane divergence on a served forecast quantity. I was one edit away
from writing it up as a Critical finding.

**It is stale.** `backend/tests/test_flag_lane_parity.py`, the more specific and more recently
reasoned source, says:

```
:29   Confirmed live: after Render's `RATING_TIDE` was set to '1' on 2026-08-10, a 40-spot Florida …
:39   ✅ The Render lane in this example is CLOSED (RATING_TIDE='1' on the live service, 2026-08-10);
```

**The divergence closed on the same day the `render.yaml` header was written, and the header was
never updated.** Do not open a task for `RATING_TIDE`.

★ This is the program's own *"a stale blocker is invisible"* class, caught by its own prescribed
check — *"this code says it waits for X: has X already happened?"* — run against a comment rather
than code. The residue worth acting on is one line: **`render.yaml:8-12` should say CLOSED.**

## 4. What has no objective: the flag-lane parity class itself

```
grep -ic "RATING_TIDE" audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv   → 0
grep -ic "RATING_TIDE" audit/weather-simulation-12.1/PROGRAM_OBJECTIVE_REGISTER.csv             → 0
grep -ic "RATING_TIDE" audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv                → 0
grep -ril "RATING_TIDE" audit/weather-simulation-12.1/                                          → 0 files
POSITIVE CONTROL: grep -ic "SURF_TIDE_DEPTH" (same register)                                    → 1
```

`backend/tests/test_flag_lane_parity.py` exists to catch a specific, historically-realised defect —
in its own words, *"what happened with `RATING_TIDE` for eleven days"*: an env flag set in the ingest
lanes and not on the serve box, so the serve-time fallback and the precomputed frames computed
different physics for eleven days.

The **guard exists**. What does not exist is:

1. any objective or task naming the class, and
2. — by the test file's own admission at `:53` — **coverage of the lane where the defect actually
   lives**:

   > ⚠️ *Render's environment is not in git and **CANNOT be checked here**. That is precisely why the
   > flip …*

So the program has a test for a defect class it cannot observe, no objective owning that class, and
the only lane that could observe it (`WS-CAN-0040`) is an owner action to *look at a screen once*
rather than a standing check.

**This is a genuine coverage gap and it is narrow enough to fix cheaply:** the live service's env-var
set is readable from the Render API, so a scheduled job could diff the serve box's flags against the
ingest lanes' and fail on divergence — turning an eleven-day silent physics split into a red check.
It attaches to **WS-OBJ-402** (dual-path governance) or **WS-OBJ-205**, not to a new objective, and
it makes `WS-CAN-0040` a *repeating* check rather than a one-off screenshot.
