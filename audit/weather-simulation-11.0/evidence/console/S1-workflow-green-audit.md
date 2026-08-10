# S1 — Workflow green audit: every reporting surface in `.github/workflows/`

**Date:** 2026-08-09 · **HEAD:** `edf91af9` · **Scope:** all 27 files in `.github/workflows/`
plus the scripts and config those workflows delegate their verdict to.
**Method:** read-only. Code read at `file:line`; live run conclusions read via `gh run list`;
three shell paths reproduced locally in `bash` to convert a code reading into an observed output.

## The class being generalised

> **A refusal you cannot READ is indistinguishable from a pass.** A guard that declines to run —
> or runs and cannot answer — and reports that decline only into a channel the reader does not
> consult (an aggregate reporter, a `::warning::` annotation, a step summary, a discarded exit
> code) returns a green that a reader will over-interpret. It costs CI time and buys nothing.

The seed defect (`e2e-tests.yml`, `--reporter=html`, fixed at `edf91af9`) is one member of a
family with **five distinct mechanisms** found in this directory:

| # | Mechanism | Instances |
|---|---|---|
| M1 | The verdict is a `warn`/annotation, the exit code is always 0 | `lighthouserc.json`, `ci.yml backend-lint`, `forecast-calibration-census` step 1, `ecmwf-ensemble-key-probe`, `data-health-monitor` writer check |
| M2 | An explicit REFUSE/INCONCLUSIVE branch exits 0 alongside a real PASS | `vector-blockmean-parity`, `marine-nightly`, `science-shadow-ab`, `verify_point_spot_reference` |
| M3 | An empty population is treated as a pass | `encoding-check`, `data-health-monitor` paging gate, `precompute_ci`, `ecmwf-ensemble-key-probe` |
| M4 | A swallowed error (`\|\| true`, `2>/dev/null`, `set +e`, `continue-on-error`) turns a broken instrument into a green | `encoding-check`, `data-health-monitor`, `python-upgrade-readiness`, `marine-nightly` |
| M5 | The step's NAME overstates what it asserts | `build-shore-normals` "Verify the asset against its own gate" |

**The repo already has the correct pattern** and applies it well in `ci.yml`: assert the COUNT of
what ran, not the colour (`ci.yml:65-98`, `206-237`, `430+`, `797+`). Every finding below is a
surface where that pattern is absent.

---

## Headline: two of the ten REQUIRED status checks on `main` cannot fail

Measured this session:

```
$ gh api repos/dpritzker0905-cmd/Raw-Surf-Antigravity/branches/main/protection --jq '.required_status_checks.contexts[]'
lint-and-build (18.x)
frontend-lint
frontend-marine-composition-guards
backend-lint                <-- structurally cannot go red (ci.yml:270)
backend-file-size-check
backend-import-check
backend-bola-guard
backend-sim-composition-guards
backend-forecast-chain-guards
lighthouse                  <-- structurally cannot go red (lighthouserc.json:14-17)

$ gh api .../branches/dev/protection
404 "Branch not protected"
```

Two corollaries a reader should carry:

* `backend-estate-coverage` — the ci.yml job with the **strongest** anti-vacuity gate (per-file
  "did this file produce results", `ci.yml:797-855`) — is the **only** ci.yml job *not* in the
  required list.
* The protection is on `main`. Per project memory `dev` is the branch that redeploys the Render
  backend on every push, and `dev` is unprotected. The required-check set gates the branch that
  ships the (frozen) frontend, not the branch that ships the backend.

---

## The table

`can pass vacuously?` = can this workflow report `success` while having asserted nothing about
the property its name claims?

| Workflow | What a green PROVES | What a green does NOT prove | Vacuous? |
|---|---|---|---|
| **ci.yml** `lint-and-build` | jest ran, ≥185 suites / ≥1686 tests passed, 0 failed, build succeeded | nothing about lint | **No** — `--passWithNoTests` (:54) is neutralised by the count floor at :88 |
| **ci.yml** `frontend-lint` | `check_eslint.js` ratchet held | — | **No** (:158 "NO continue-on-error, deliberately") |
| **ci.yml** `frontend-marine-composition-guards` | exactly ≥2 suites / ≥48 tests ran and passed | — | **No** (:206-237) |
| **ci.yml** `backend-lint` | **that the runner installed flake8** | **that flake8 found nothing.** `--select=E9,F63,F7,F82` (syntax errors, undefined names) under `continue-on-error: true` (:270); it is the job's last step, so the job conclusion is unconditionally `success` | **YES — required check** |
| **ci.yml** `backend-file-size-check` | no backend .py > 800 LOC | frontend LOC (that rides on the path-filtered `loc-check`) | No |
| **ci.yml** `backend-import-check` | no circular imports under `routes/` | anything outside `routes/` | No |
| **ci.yml** `backend-bola-guard` | no NEW bare-`user_id` route | the 226 baselined offenders | No |
| **ci.yml** `backend-sim-composition-guards` | the file list matched, N modules / M tests passed | — | **No** (:430+ asserts the count; :398-405 records the miss it was written for) |
| **ci.yml** `backend-forecast-chain-guards` | same, for the chain lane | — | **No** (:658+) |
| **ci.yml** `backend-estate-coverage` | the lanes partition the estate; every selected file produced results except 2 named exemptions | — | **No** (:783, :797-855) — and **not** a required check |
| **lighthouse.yml** | the frontend built and Lighthouse produced a report | **any score threshold.** All four assertions are `["warn", …]` (`lighthouserc.json:14-17`) — including `categories:accessibility` minScore 0.7 | **YES — required check** |
| **e2e-tests.yml** | (post-`edf91af9`) both deploys served the commit under test, and every test name + status is on stdout | that any specific test asserted — the six `test.skip(cond, reason)` gates still exit 0 | Mitigated at HEAD; the *reason* is now readable |
| **loc-check.yml** | the ratchet held on a change that TOUCHED a scoped path | anything about a change that touched none (`paths:` :22-51) | Yes — **correctly documented as never-required** (:16-21) |
| **encoding-check.yml** | grep produced no matches **or errored** | that anything was scanned. `GARBLED=$(grep -rlP … \|\| true)` (:33) collapses grep exit 2 into the "all clear" branch (:42) | **YES** |
| **keep-warm.yml** | the runner reached the `curl` loop | **that the serve box answered.** After 3 non-200 pings the loop falls through to `echo` (:37) and the step exits 0 | **YES** |
| **data-health-monitor.yml** | `/api/health/data` returned a parseable body whose `status` ≠ critical | that the per-lane paging gate evaluated. `stale_lanes=$(… python3 … 2>/dev/null \|\| echo "")` (:73-81) turns any exception into "no stale lanes". Writer-attribution (audit #28) is `::warning::` only (:50-59) | **YES (partial)** |
| **sim-parity-monitor.yml** | the probe compared ≥1 spot and no LEVEL differed | that paging was on (`SIM_PARITY_PAGING`, :236) | Low — the probe refuses on `not rows` (`sim_health_probe.py:531-534`) |
| **forecast-calibration-census.yml** | the drift + freshness gates passed | **that the climatology is shaped right.** `VERDICT: BOUNDS STALE` → `::warning::` + exit 0 (:118-134). Also: both scripts SKIP (exit 0) if the Supabase secrets are absent (:60-66); step 4 has no `--fail-on-mismatch` (:190-195) | **YES — measured live** |
| **forecast-accuracy-monitor.yml** | MAE ≤ threshold on n ≥ 30 buoys, report < 8 h old | — | **No** — exit 3 = REFUSE is red by design (:11-16) |
| **science-shadow-ab.yml** | the replay tool ran | that anything was compared — `NOT READY` exits 0 (:82-89) | Yes, but **self-declared in the step summary**; dispatch-only, never a gate |
| **marine-nightly.yml** `data-contract` | the ladder/edge contract held against prod | — | No |
| **marine-nightly.yml** `zoomlab-battery` | the battery ran | **that the renderer was graded.** REFUSE (code 3) → `exit 0` (:121-126); and if `verdict.json` is missing/unparseable the budget test silently prints "WITHIN BUDGET — PASS" (:135-145) | **YES ×2** |
| **precompute.yml** | L2 restore returned ≥1 product and the grid prewarm succeeded | **that any spot was rated.** `n_spots, n_frames` are logged, never asserted (`precompute_ci.py:75-76`); same for `n_buoys, mae` (:84-85) | **YES** |
| **forecast-ingest.yml** / **forecast-ingest-pilots.yml** | **at least one** L2 upload was recorded | that the cycle completed. Partial failure is `logger.warning` + `return 0` (`ingest_forecast_ci.py:153-158`) | **YES (partial)** |
| **build-shore-normals.yml** | the fit script exited 0, and the lookup CODE passes against synthetic fixtures | **anything about the asset it then commits and pushes.** `test_shore_normal_asset.py:20-30` monkeypatches `sna._ASSET` to a `tmp_path` file; the real `shore_normals.json` is never read by the "verify" step (:82-84) | **YES — and it `git push`es** |
| **build-bathymetry.yml** | the build script exited 0 | anything about the `.npy` it commits — there is **no** verification step at all (:42-59) | **YES — and it `git push`es** |
| **vector-blockmean-parity.yml** | either "IDENTICAL on real GRIB, safe to default on" (:136) **or** "INCONCLUSIVE, the cycle rolled" (:98-102) — **the same exit 0** | which of the two it was | **YES** |
| **ecmwf-band-closure-probe.yml** | BANDS_CLOSE | — | **No** — VOID = exit 2 = red (:112, :115). *Reference implementation.* |
| **ecmwf-ensemble-decode-verify.yml** | the decode + emission verified on real GRIB | — | **No** — ~20 explicit `sys.exit(1)` refusals |
| **ecmwf-ensemble-key-probe.yml** | pygrib decoded some messages | **that any member discriminator was found.** `if not varying: print("::warning::…")` then exit 0 (:98-102); 0 messages takes the same path | **YES** |
| **ecmwf-ensemble-mean-vs-deterministic.yml** | ≥1 cell compared, bias printed | that the **tail** table has any rows — every band can `continue` on `sel.sum() < 20` (:126-129) and the run still prints "Comparison complete" (:138) | Partial |
| **ecmwf-ensemble-full-horizon-cost.yml** | bytes + wall time measured | that all members arrived — missing members are `::warning::` (:128) | Partial |
| **artifact-interpreter-parity.yml** | two interpreters produced byte-identical artifacts, **and the harness was proved sensitive on both legs** | — | **No** — the `--mutate` CONTROL is the design (:74-85). *Reference implementation.* |
| **python-upgrade-readiness.yml** | the runner started | **nothing.** All six steps are `continue-on-error: true` (:56, 63, 71, 86, 112, 126); steps 2-5 are gated on `steps.install.outcome == 'success'`, so a candidate whose stack cannot install SKIPS every question and the job is green | **YES (by design, but the job is named "readiness")** |
| **discover-spot-candidates.yml** | the ranking script exited 0 | that the size climatology loaded — the header (:63-67) records the first run silently degrading to geometry-only, and the fix was an added `pip install`, **not** an assertion | **YES** |
| **l2-orphan-sweep.yml** | the sweep script ran (dry-run by default) | that anything was deleted | Info |

### Cron caveat, applying to all 9 scheduled workflows

A cron that never fires produces **no run at all** — neither red nor green. A green run history is
therefore consistent with "the schedule is dead". Project memory records measured delivery at
32.2% (data-health) and 4.9–5.4% (keep-warm) of nominal. **Absence of a red is not evidence.**

---

## Findings, ranked

### F1 — `backend-lint` is a REQUIRED check that reports success unconditionally · **High**

`ci.yml:267-270`

```yaml
      - name: Lint backend
        run: flake8 --max-line-length=150 --count --select=E9,F63,F7,F82 --show-source --statistics .
        continue-on-error: true  # Warn only, don't block
```

`--select=E9,F63,F7,F82` is the *undefined-name / syntax-error* set — the Python equivalent of the
`no-undef` bug that `ci.yml:110-130` documents at length as having lived 12 days in the WebGL
render path *because nothing was looking*. It is the job's only assertion and its last step, so the
job conclusion is always `success`, and it is one of the 10 required contexts on `main`.

**Cheapest fix:** delete line 270 and measure the current violation count first; if non-zero, ratchet
it the way `check_eslint.js` and `bola_baseline.json` already do in this repo.

### F2 — Every Lighthouse assertion is `warn`; it is a REQUIRED check with 100/100 green · **High**

`lighthouserc.json:12-19` — `["warn", { "minScore": … }]` on performance, **accessibility**,
best-practices and SEO. `treosh/lighthouse-ci-action` fails the job only on `error` assertions.

Measured: `gh run list --workflow lighthouse.yml --limit 100` → **100 of 100 `success`**.

`lighthouse.yml:8-9` cites that unbroken green as the reason the job is "safe as a required check
(measured: 20 of the last 20 runs succeeded)". **The green is a property of the config, not of the
site** — the workflow reasoned from an outcome it had made impossible.

Consequence for the CLAUDE.md ACCESSIBILITY mandate: the only automated a11y score in the estate
has never been able to go red, and the 2026-07-14 debt inventory it was meant to backstop is
therefore ungated.

**Cheapest fix:** flip `categories:accessibility` to `["error", {"minScore": <today's measured
score, floored}]` — a shrink-only ratchet, same idiom as the LOC and BOLA baselines.

### F3 — The calibration census went from red to green by changing the GATE, not the data · **High** · MEASURED

`forecast-calibration-census.yml:116-134`; `backend/scripts/local_size_gonogo.py:316-329`

The census's first and headline question is "IS IT SHAPED RIGHT?" (:16-21). At HEAD, the
`BOUNDS STALE` verdict takes an `elif` branch that emits `::warning::` and **falls out of the `if`,
so the step exits 0**. The script agrees: `local_size_gonogo.py` `return 0` at :329 for
`BOUNDS STALE`, `return 1` only for NO-GO at :333.

Measured live — run **31335894359** (2026-08-09T21:04:43Z), conclusion **`success`**:

```
VERDICT: BOUNDS STALE
BOUNDS STALE -- ordering is intact; the absolute envelope is in the wrong frame.
##[warning]Calibration census: ORDERING INTACT, ABSOLUTE BOUNDS STALE. … a p80 envelope is
being graded against a p50 population. Owner decision: … CENSUS_STRICT_ABSOLUTE_BOUNDS=1 makes
these page again.
```

Run-conclusion history across the change (`822a0785`, 2026-08-09 09:21):

```
2026-08-08T09:19Z failure   2026-08-08T15:00Z failure   2026-08-08T16:04Z failure
2026-08-08T21:01Z failure   2026-08-09T04:02Z failure   2026-08-09T09:20Z failure
--- 822a0785 ---
2026-08-09T13:32Z success   2026-08-09T15:03Z success   2026-08-09T21:04Z success
```

The downgrade is *argued* in the file (:126-128: "a gate that is always red cannot report the next
real inversion") and I do not dispute the reasoning. The finding is about the **reporting
surface**: the run conclusion no longer carries the distinction. Anyone reading `gh run list` — or
a future audit — sees three greens and concludes the shape gate passed. It refused.

**Cheapest fix:** make the two states distinguishable without re-reddening. Either promote the
step summary (`$GITHUB_STEP_SUMMARY`) so the run *page* leads with "SHAPE GATE: REFUSED — bounds in
the wrong frame", or emit a distinct conclusion by moving the shape check to its own job that is
`neutral`/skipped rather than `success` when it cannot answer.

### F4 — `marine-nightly` prints "WITHIN BUDGET — PASS" when the verdict engine produced nothing · **High** · code fact + local repro

`marine-nightly.yml:99` sets `set +e` for the rest of the step. Then `:135-141`:

```bash
FINDINGS=$(node -e '…require("/tmp/zoomlab-out/verdict.json")…')   # empty if the require throws
SETTLED=$(node -e '…')
PERSIST=$(node -e '…')
if [ "$SETTLED" -gt 0 ] || [ "$PERSIST" -gt 0 ] || [ "${FINDINGS:-0}" -gt 2 ]; then
  echo "OVER BUDGET — failing"; exit 1
fi
echo "WITHIN BUDGET — PASS …"
```

Reproduced in `bash` this session with all three variables empty:

```
/usr/bin/bash: line 3: [: : integer expected
/usr/bin/bash: line 3: [: : integer expected
WITHIN BUDGET -- PASS
exit code would be 0
```

`[ "" -gt 0 ]` errors (status 2), the `||` chain falls through, `${FINDINGS:-0}` defaults to 0, the
condition is false, and a crashed verdict engine reports PASS. The summary writer that would have
said otherwise is itself `|| true` (`:120`).

**NOT MEASURED in a live run.** The most recent green scheduled run (31246306909, 2026-08-08T07:30Z)
was a real grade — `[verdict] PASS — 0 finding(s), 390 anim frames, 163 water samples`.

Second, separate instance in the same step: `:121-126` `if [ "$CODE" = "3" ]; then … exit 0`. REFUSE
is green by design, with the reason written to `$GITHUB_STEP_SUMMARY` — exactly the channel a
run-list green discards. The file's own comment (:109-111) names this trap and then takes the
risk anyway. Note the inconsistency it creates: on 2026-08-09T07:34Z the *same* precondition (cold
Render box) produced a **failure** (30 findings, `ERR_FAILED`) rather than a refusal — so one
condition reaches the reader as red on one day and green on another.

**Cheapest fix:** assert the three extractions produced integers before comparing
(`[[ "$FINDINGS" =~ ^[0-9]+$ ]] || { echo "::error::verdict.json unreadable"; exit 1; }`).

### F5 — `vector-blockmean-parity`: INCONCLUSIVE and PASS share one exit 0 · **High**

`vector-blockmean-parity.yml:95-102` vs `:136`

```python
if ta != tb:
    print("::notice::INCONCLUSIVE — NOAA's cycle rolled between the two fetches …")
    sys.exit(0)
…
print("::notice::IDENTICAL on real GRIB. FETCH_VECTOR_BLOCKMEAN=1 is safe to default on.")
```

This is the sole cloud evidence gating a 17.4× flag flip on the heaviest lane in the system
(:3-8). Two contradictory conclusions — "safe to flip" and "nothing was compared" — are the same
green. The sibling probe in the same directory gets this right:
`ecmwf-band-closure-probe.yml:112` makes VOID **exit 2**, red, with the reasoning at :27-28
("A gate whose green is ambiguous is not a gate").

**Cheapest fix:** `sys.exit(2)` on INCONCLUSIVE and let the workflow's reporting step name it, the
way the band-closure probe already does.

### F6 — `data-health-monitor`'s paging gate silently no-ops on any parse error · **High**

`data-health-monitor.yml:73-81`

```bash
stale_lanes=$(PAGE_HOURS="$page_hours" python3 - <<'PY' 2>/dev/null || echo ""
…
bad = [… for n, i in (d.get('lanes') or {}).items() if isinstance(i.get('age_h'), (int, float)) and i['age_h'] > cap]
print(', '.join(bad))
PY
)
if [ -n "$stale_lanes" ]; then … exit 1; fi
```

`2>/dev/null` discards the traceback and `|| echo ""` makes any exception indistinguishable from
"no lane is stale". Reproduced locally with a missing input file:

```
RESULT: empty -> paging gate skipped, step continues to green
```

Three ways this fires without anyone noticing: `lanes` renamed upstream; `age_h` becoming a string;
`lanes` legitimately empty (M3 — empty population = pass). This is the *specific* gate added
because the 2026-07-13 outage "sat at 8-9h-old warn for 12h with green checks" (:5-6, :66-71) — the
mitigation for a silent-green incident is itself silently greenable.

Same file, lesser: the audit-#28 writer-attribution check (:50-59) only ever emits `::warning::`; a
non-designated L2 writer never reddens anything.

**Cheapest fix:** drop `2>/dev/null`, and make the python print a sentinel (`__ERROR__`) that the
shell treats as a page.

### F7 — `precompute` cannot fail on rating zero spots · **High**

`backend/scripts/precompute_ci.py:72-79`

```python
n_spots, n_frames = run_spot_ratings_precompute()
logger.info("Spot-ratings precompute complete: %d spots × %d frames → L2.", n_spots, n_frames)
```

The counts are logged and never asserted. `0 spots × 0 frames` returns `rc = 0` and
`precompute.yml` is green. Same shape for buoy calibration (`n_buoys, mae`, :84-85) — a `mae` of
`None` over 0 buoys is not distinguishable from a healthy run at the exit code.

The asymmetry is the tell: **the INPUT has a count floor and the OUTPUT does not.** The same file
guards the restore correctly at :53-55 (`if not restored: … return 1`).

This is the lane project memory names as the authoritative owner of the served glyphs. A zero-spot
cycle is exactly the "melt window" this workflow's 40-line cron comment exists to prevent.

**Cheapest fix:** `if n_spots == 0 or n_frames == 0: rc = 1` — one line, and it is the same
count-floor idiom `ci.yml` already uses five times.

### F8 — `build-shore-normals`'s "verify" step never reads the asset it commits · **High**

`build-shore-normals.yml:82-84` runs `tests/test_shore_normal_asset.py` and
`tests/test_shore_normal_fit.py`. But `backend/tests/test_shore_normal_asset.py:20-30`:

```python
@pytest.fixture
def asset(tmp_path, monkeypatch):
    def _write(entries, **extra):
        path = tmp_path / "shore_normals.json"
        path.write_text(json.dumps({… "entries": entries …}))
        monkeypatch.setattr(sna, "_ASSET", str(path))
```

Every test points the module at a throwaway synthetic file. The real
`backend/services/weather_pipeline/data/shore_normals.json` — the artifact the **next** step
`git commit`s and `git push`es to the branch (:86-100) — is never opened. The step's name,
"Verify the asset against its own gate", claims otherwise (M5).

Concretely: a fit run that produced an asset with 0 entries, or with `--limit 1` from a smoke test,
passes this step and is pushed. `build-bathymetry.yml` is worse — it has no verification step at
all between `build_bathymetry_asset.py --slope` (:44) and the commit+push (:46-59).

**Cheapest fix:** one assertion on the produced file — entry count ≥ a floor, and `count` field
consistent with `len(entries)` — before the commit step.

### F9 — `encoding-check` treats a grep ERROR as "all clear" · **Medium**

`encoding-check.yml:33-43`

```bash
GARBLED=$(grep -rlP 'Ã[ƒ†]|Ã¯Â¿|ÃƒÆ' frontend/src/ --include="*.js" --include="*.jsx" || true)
if [ -n "$GARBLED" ]; then … exit 1; else echo "✅ No garbled UTF-8 found - all clear!"; fi
```

`|| true` is needed for grep's exit 1 (no match) but also swallows exit 2 (real error). Reproduced:

```
$ grep -rlP 'Ã[ƒ†]' /nonexistent-dir/ --include="*.js" || true
grep: /nonexistent-dir/: No such file or directory
RESULT: 'No garbled UTF-8 found - all clear!' (step exits 0)
```

A moved/renamed `frontend/src`, or a runner without PCRE support, both report clean. The file's own
header records this guard already ran **0 times in its entire life** before the trigger fix — it has
a history of protecting nothing while looking like it does.

**Cheapest fix:** capture the status separately — `rc=$?` after the grep, `[ "$rc" -ge 2 ] &&
{ echo "::error::the scan itself failed"; exit 1; }` — and assert the scanned file count > 0.

### F10 — `keep-warm` cannot report that the serve box is down · **Medium**

`keep-warm.yml:31-37` — after 3 non-200 responses the loop exits and the step's last command is an
`echo`, so it returns 0. Measured: **98 of 100 recent runs `success`**; the 2 failures produce no
`--log-failed` output (infra/startup, not the ping).

This matters beyond uptime: `marine-nightly.yml:53-59` records a measured control pair showing that
a cold Render box turns the nightly optical net into 30 spurious findings, and keep-warm's own
header (:5-7) plus project memory put cron delivery at 4.9–5.4% of nominal. So the workflow whose
job is to prevent that condition is *also* the workflow that cannot report it occurring.

**Cheapest fix:** keep the run green (a disposable ping should not page) but write the outcome to
`$GITHUB_STEP_SUMMARY` and a `::warning::`, so a reader scanning the run list sees the annotation.

### F11 — `forecast-ingest` / `-pilots`: the floor is ONE upload · **Medium**

`backend/scripts/ingest_forecast_ci.py:153-158`

```python
if not diag.get("last_upload_time"):
    logger.error("No L2 upload was recorded this run …"); return 1
if diag.get("last_upload_errors"):
    logger.warning("Some L2 uploads failed: %s", diag.get("last_upload_errors"))
return 0
```

A cycle in which every lane but one failed is `success`. There is no per-lane count and no
comparison against the previous cycle. The data-health monitor is the compensating control — but
see F6 for how that one can go quiet.

### F12 — `python-upgrade-readiness` has six `continue-on-error: true` steps and a skip cascade · **Medium**

`python-upgrade-readiness.yml:56, 63, 71, 86, 112, 126`. Every step is non-blocking by design
(:5-8, and the rationale is sound: report the whole blocker set, not the first failure). But steps
2-5 are additionally `if: steps.install.outcome == 'success'` — so on a candidate interpreter whose
pinned stack *cannot install*, the four substantive questions are **skipped** and the job is green.
The workflow's conclusion carries zero bits, while its name is "readiness".

**Cheapest fix:** a final non-`continue-on-error` step that reads the recorded outcomes and fails if
the candidate leg answered fewer questions than the baseline leg.

### F13 — `ecmwf-ensemble-key-probe`: the failure it exists to detect is a warning · **Medium**

`ecmwf-ensemble-key-probe.yml:98-102`

```python
varying = [k for k, v in seen.items() if len(v) > 1]
if not varying:
    print("::warning::nothing varied — either only one member came back, or the "
          "discriminator is not among the candidates probed")
```

Exit 0. Zero decoded messages takes the same path (`seen` stays empty). The probe's entire purpose
(:22-23) is to name the member discriminator before the decode is written; "no discriminator found"
is the answer that must be loudest, and it is the quietest.

### F14 — `forecast-calibration-census` exits 0 when its credentials are absent · **Medium**

`forecast-calibration-census.yml:60-66` — the header states it plainly: "Both scripts SKIP (exit 0)
when they are absent rather than failing: a missing credential is an operator condition, not a
calibration finding". The reasoning is defensible; the consequence is that a rotated or unset
`SUPABASE_SERVICE_ROLE_KEY` makes the **only watcher on the size-climatology blob** measure nothing
and report green, indefinitely, with no distinguishing signal in the run list.

Related, same file: step 4 (`:190-195`) has no `--fail-on-mismatch`, and
`backend/scripts/verify_point_spot_reference.py` returns 0 on **every** VOID path (:85, :95, :106,
:144) *and* on MISMATCH (:152, `return 1 if args.fail_on_mismatch else 0`). Its docstring says "IT
VOIDS ITSELF RATHER THAN PASSING WHEN IT CANNOT KNOW (rule 16)" — but VOID, PASS and MISMATCH are
all exit 0; the distinction survives only in stdout, which `| tail -24` can truncate.

### F15 — `discover-spot-candidates` can silently re-degrade to geometry-only ranking · **Medium**

`discover-spot-candidates.yml:63-69` records that the workflow's **first run** produced a
geometry-only ranking (which saturates: "258 of 373 Portugal+Ireland candidates scored >= 500 km of
a 600 km fetch cap", :8) because `pydantic` was missing and the production L2 loader swallows
`ImportError` by design. The fix was to add `pydantic` to the `pip install` — **no step asserts the
climatology actually loaded.** A bucket permission change, a rotated key, or a schema change
reproduces the identical silent degradation with a green run and a plausible-looking CSV.

### F16 — Lesser instances · **Low / Info**

* `science-shadow-ab.yml:82-89` — `NOT READY` exits 0. **Best-in-class mitigation**: the step
  summary says verbatim "Green here means the tool ran and found nothing to compare -- NOT that the
  candidate is safe." Dispatch-only, never a gate. Listed for completeness, not as a defect.
* `ecmwf-ensemble-mean-vs-deterministic.yml:126-133` — every height band can be skipped on
  `sel.sum() < 20` and the run still prints "Comparison complete — read the band table before
  flipping the flag" (:138). The band table is the stated deliverable (:15-18).
* `ecmwf-ensemble-full-horizon-cost.yml:128` — valid-times missing members are `::warning::`; the
  cost figure is then an under-estimate on a green run.
* `sim-parity-monitor.yml:236, 252-258` and `data-health-monitor.yml:102, 112-115` — repo Actions
  variables (`SIM_PARITY_PAGING`, `REGION_HEALTH_PAGING`) downgrade a real finding to a warning.
  Both are deliberate, discoverable kill switches with the right rationale (:230-231). The residual
  risk is that a run list cannot show whether paging was on.
* `l2-orphan-sweep.yml` — dry-run by default; a green proves the script ran, not that orphans were
  removed.

---

## Checked and REFUTED (recorded because the wrong version is the tempting one)

* **"`sim-parity-monitor` passes on N=0"** — refuted. `backend/scripts/sim_health_probe.py:530-534`:
  `if args.fail_on_divergence: if not rows: print("FAIL: nothing was comparable — an empty probe is
  not a green one.", file=sys.stderr); return 1`. The workflow passes `--fail-on-divergence`
  (`sim-parity-monitor.yml:163`). *Residual, NOT MEASURED:* the Verdict step's discriminator
  (:246) is "did the probe write parseable JSON", which may not distinguish "diverged" from
  "nothing comparable" — if it does not, that is a **mislabeled red**, not a vacuous green.
* **"`ci.yml`'s `--passWithNoTests` (:54) makes the frontend suite vacuous"** — refuted. The
  count floor at :88 (`MIN_SUITES = 185, MIN_TESTS = 1686`) plus `if: always()` at :66 closes it.
  This is the house pattern the other findings should copy.
* **"`artifact-interpreter-parity` can pass with 0 artifacts"** — refuted.
  `artifact-interpreter-parity.yml:108-111`: `COUNT=$(echo "$FILES" | wc -l)` is 1 for an empty
  list, and `-ne 2` errors out. The `--mutate` control (:74-85) additionally proves the harness is
  sensitive on **both** legs before any match is believed.
* **"a `paths:` filter is hiding a required check"** — refuted. Only `encoding-check.yml` and
  `loc-check.yml` carry `paths:`, neither is in the required-contexts list, and both files document
  exactly why they must not become one.

---

## The two reference implementations to copy from

1. **`ci.yml`'s count floors** (`:65-98`, `:206-237`, `:430+`, `:797-855`) — assert *what ran*, with
   `if: always()` so a collapse in coverage is reported instead of hiding behind the first red test.
2. **`artifact-interpreter-parity.yml`'s `--mutate` control** (`:74-85`) — perturb one input and
   require the digest to change, on **every** leg, so "the two sides matched" cannot be confused
   with "the harness computed nothing".

And one exit-code convention worth standardising on, already used correctly in three files
(`ecmwf-band-closure-probe`, `forecast-accuracy-monitor`, `science-shadow-ab`):

```
0 = measured, and the answer is PASS
1 = measured, and the answer is FAIL
2/3 = NOT MEASURED — the instrument refused. Red, and named as an instrument failure.
```

`vector-blockmean-parity` (F5), `marine-nightly` (F4), `verify_point_spot_reference` (F14) and
`local_size_gonogo` (F3) each collapse state 2/3 into state 0.
