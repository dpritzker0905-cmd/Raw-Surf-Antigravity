# F1 RED-TEAM VERIFICATION — `backend-lint` is a required check whose verdict is discarded

**Verdict: CONFIRMED. survives = true. Severity corrected: High (finding claimed High).**
Verified 2026-08-09 at HEAD `edf91af920b707f238b925634b29705c63cc55d2` (branch `dev`).
Read-only: no workflow dispatched, no file outside this directory written.

---

## 1. Do the cited lines say what is claimed? YES — verbatim.

`.github/workflows/ci.yml:239` — job declaration:

```
239:  backend-lint:
```

`.github/workflows/ci.yml:267-270` — the job's only assertion, quoted exactly:

```
267:      - name: Lint backend
268:        working-directory: backend
269:        run: flake8 --max-line-length=150 --count --select=E9,F63,F7,F82 --show-source --statistics .
270:        continue-on-error: true  # Warn only, don't block
```

Line 271 is blank; line 272 begins the comment block for the next job
(`backend-file-size-check`, declared at :274). So the `continue-on-error` step IS the job's
last step, and the job conclusion is unconditionally `success`. **Structural claim: CONFIRMED.**

## 2. Is `backend-lint` a required status check? YES — measured.

```
$ gh api repos/dpritzker0905-cmd/Raw-Surf-Antigravity/branches/main/protection \
    --jq '.required_status_checks.contexts[]'
lint-and-build (18.x)
frontend-lint
frontend-marine-composition-guards
backend-lint                     <-- present
backend-file-size-check
backend-import-check
backend-bola-guard
backend-sim-composition-guards
backend-forecast-chain-guards
lighthouse
```

`enforce_admins: true`, `strict: false`.

**CAVEAT THE FINDING DID NOT STATE:** `dev` is **NOT protected at all** —
`gh api .../branches/dev/protection` returns `404 Branch not protected`. Per repo memory, every
push to `dev` is the production **backend** deploy. So this required check gates PRs into `main`
only, and `main` is the (frozen) frontend lane. The *gating* consequence is therefore weaker than
"required check" implies; the *reader-deception* consequence is undiminished, because the job
runs and reports green on every push to `dev` as well.

## 3. Is the control actually firing? YES — MEASURED, not hypothesised.

The finding said "NOT MEASURED: whether flake8 currently reports any E9/F82 violation." I measured
it, without running flake8 locally, by reading the CI log of the run at HEAD.

Run `31348107511` (workflow `ci.yml`, head SHA `edf91af920b707f238b925634b29705c63cc55d2`),
job `backend-lint`, step `Lint backend`. Tail of the step log:

```
23    F821 undefined name 'REPORT_DURATION_HOURS'
1     F824 `global _watermark_logo_cache` is unused: name is never assigned in scope
24
##[error]Process completed with exit code 1.
```

Full violation set extracted from that log (24 findings, 23 of them F821 undefined-name):

```
./routes/condition_reports/crud.py:61:63:  F821 undefined name 'REPORT_DURATION_HOURS'
./routes/condition_reports/crud.py:85:13:  F821 undefined name 'Story'
./routes/condition_reports/crud.py:126:11: F821 undefined name 'broadcast_new_condition_report'
./routes/condition_reports/crud.py:210:13: F821 undefined name 'cr_logger'
./routes/condition_reports/crud.py:214:18: F821 undefined name '_auto_heal_report_media'
./routes/condition_reports/crud.py:218:33: F821 undefined name 'ConditionReportResponse'
./routes/condition_reports/crud.py:240:22: F821 undefined name 'get_time_ago'
./routes/condition_reports/crud.py:248:13: F821 undefined name 'cr_logger'
./routes/condition_reports/crud.py:284:12: F821 undefined name 'ConditionReportResponse'
./routes/condition_reports/crud.py:305:18: F821 undefined name 'get_time_ago'
./routes/condition_reports/crud.py:401:5:  F821 undefined name 'cr_logger'
./routes/condition_reports/feed.py:16:24:  F821 undefined name 'SURF_REGIONS'
./routes/condition_reports/feed.py:141:13: F821 undefined name 'cr_logger'
./routes/condition_reports/feed.py:145:18: F821 undefined name '_auto_heal_report_media'
./routes/condition_reports/feed.py:168:23: F821 undefined name 'ConditionReportResponse'
./routes/condition_reports/feed.py:190:22: F821 undefined name 'get_time_ago'
./routes/condition_reports/feed.py:204:13: F821 undefined name 'cr_logger'
./scheduler/financial.py:240:38:           F821 undefined name 'os'
./scheduler/gallery.py:131:62:             F821 undefined name 'timedelta'
./server.py:556:21:                        F821 undefined name 'json'
./server.py:683:39:                        F821 undefined name 'json'
./services/watermark.py:56:5:              F824 (not in the --select set; emitted by --statistics)
./tests/test_debug_consciousness.py:231:17: F821 undefined name 'StringIO'
./tests/test_debug_consciousness.py:232:18: F821 undefined name 'StringIO'
```

22 of the 24 are outside `tests/`.

**And yet the check is green.** Same run, via the REST API:

```
$ gh run view 31348107511 --json jobs ...
{"conclusion":"success","name":"backend-lint","steps":[..., {"conclusion":"success","name":"Lint backend"}, ...]}

$ gh api .../commits/edf91af9.../check-runs --jq '.check_runs[] | select(.name=="backend-lint")'
{"annotations_count":null,"conclusion":"success","name":"backend-lint","status":"completed"}
```

The step printed `##[error]Process completed with exit code 1`, and the API reports the step's
conclusion as `success`, the job's as `success`, the check-run's as `success`, with
`annotations_count: null`.

## 4. Is the code REACHABLE? YES — traced from real entry points.

**Entry point.** `render.yaml:5-7`:
```
5:    rootDir: backend
7:    startCommand: uvicorn server:app --host 0.0.0.0 --port $PORT
```
So `backend/server.py` is the production ASGI app.

**`backend/server.py:683` — live paid path.** Inside the registered handler
`@app.post("/api/webhook/stripe")` (declared `server.py:540-541`), in the mainline
"Standard credit purchase / subscription" branch (`server.py:671-683`):
```
683:  tx_metadata = json.loads(transaction.transaction_metadata) if transaction.transaction_metadata else {}
```
`import json` appears **nowhere** in `server.py` (Grep for `import json` over the file: no matches),
and there are **no star imports** in the file (`grep -n "import \*" server.py` → empty). The name is
genuinely unbound. The enclosing `try:` (`server.py:552`) ends in a broad
`except Exception as e:` (`server.py:709-712`) that re-raises as `HTTPException(status_code=500, ...)`.
Consequence by code trace: every `checkout.session.completed` event on the credit-purchase branch
raises `NameError` → HTTP 500 → the credit grant at `server.py:685-691` never executes.
**NOT MEASURED:** I did not fire a real or test webhook at production; this is a code trace, not a
live observation.

**`backend/server.py:556`** — same handler, the unsigned-webhook fallback branch.

**`backend/routes/condition_reports/feed.py:16`** — inside the handler body of
`@router.get("/condition-reports/regions")` (declared :13-14):
```
16:      return {"regions": SURF_REGIONS}
```
Because the reference is inside a function body, module import succeeds and the app boots; the
route raises `NameError` only when called. The router is registered:
`routes/condition_reports/__init__.py:8-13` includes `feed_router` and `crud_router`, and
`routes/__init__.py:32` imports it with `:85` `api_router.include_router(condition_reports_router, ...)`.
`server.py:528` does `app.include_router(api_router)`.

None of this is dead code or docstring matches.

## 5. Does some OTHER channel carry the detail? PARTIALLY — and this is where I correct the finding.

- **The raw job log carries it in full**, including the `##[error]Process completed with exit code 1`
  line. Anyone who opens the green job's log sees all 24 violations with source lines.
- **No annotation is produced** (`annotations_count: null`), so nothing surfaces on the PR diff.
- **No status consumer sees it**: step conclusion, job conclusion, and check-run conclusion are all
  `success`.

**No other control covers this gap.** `flake8`/`ruff`/`pylint`/`pyflakes` appear in `.github/`
only at `ci.yml:264` and `:269` — nowhere else. There is no `.pre-commit-config.yaml`, no `.husky`,
no `backend/.flake8`/`setup.cfg`/`tox.ini`. `backend-import-check` runs
`scripts/check_imports.py`, which is an AST **cycle** detector
(`scripts/check_imports.py:5-6, 21-38`) and cannot see undefined names. Importing a module whose
`F821` sits inside a function body does not raise, so the pytest lanes do not catch it either.

## 6. Deliberate and documented? NO — it is scaffolding residue, and the repo has been removing its siblings.

`git blame -L 267,271 -- .github/workflows/ci.yml` attributes all four lines to `3550406f`
("feat: Sprint 2+3 — tests, CI pipeline, Web Vitals monitoring", 2026-05-03) — the original CI
scaffold. `git log -S "Warn only, don't block" -- .github/workflows/ci.yml` returns that single
commit: the line has never been revisited.

`ci.yml:270` is now the **only** `continue-on-error: true` left in `ci.yml`. Its frontend twin was
removed on 2026-08-01, and `ci.yml:42-50` documents that removal at length. The same file argues
the principle against itself three times — `:158` ("NO continue-on-error, deliberately. `no-undef`
in a render path is not advisory"), `:200`, and `:160-169` ("A guard that runs nowhere is
indistinguishable from a guard that passes"). The comment `# Warn only, don't block` documents the
step's behaviour, but **nothing anywhere documents that a warn-only step is simultaneously a
required status check.** That combination is undocumented, and the only other write-up of it is
the audit note under review (`evidence/console/S1-workflow-green-audit.md:41,74,118`).

## 7. Class fit — an honest correction

The seed class is *"a refusal you cannot READ is indistinguishable from a pass."* This finding is a
**sibling, not an instance**. In the Playwright case the skip reasons reached **no** channel. Here
the detail reaches the log completely; what is discarded is the **verdict**, before it reaches any
status consumer. Proposed name:

> **A control whose finding is fully written but whose verdict is discarded.** The detail is
> readable, but only in the log of a job that reports green — and nobody opens the log of a green job.

This variant is *easier* to prove than the seed class, because the guard is currently firing: you do
not have to argue about what a green might be hiding, you can read the 24 things it is hiding today.

## Severity: High, not Critical

- The control defect is **CONFIRMED and measured at HEAD**, not inferred.
- Two production-path consequences are **code-traced but not live-measured** (no request fired at
  production; forbidden and unnecessary here).
- The required-check gate applies to `main` only; `dev` — the branch whose pushes deploy the
  backend — has no protection at all, so the tick misleads a *reader* rather than blocking a *merge*
  on the deploy path.

Critical would require a live production observation I did not and should not make.
