# LV12.2-01 — The workflow census, and the optical net the program lost

**Captured** 2026-08-13, HEAD `791fdf78` on `dev`. Read-only: `gh run list`, `gh api`, `git ls-files`,
`grep`. No dispatches fired, nothing modified.

---

## 1. The census 12.1 did not take

12.1's `CURRENT_BASELINE_MANIFEST.md` states: *"All green: CI, E2E Tests, LOC Governance Check,
Encoding Guard, Lighthouse CI, Data Health Monitor, Forecast Calibration Census, keep-serve-box-warm,
Forecast Accuracy Monitor."* — **nine** workflows.

`ls .github/workflows/` returns **27**. Last-run conclusion for every one, measured
`gh run list --workflow=<f> --limit 1`:

| workflow | last run | conclusion |
|---|---|---|
| artifact-interpreter-parity.yml | 2026-08-06T15:37:10Z | success |
| build-bathymetry.yml | 2026-06-29T22:05:37Z | success |
| build-shore-normals.yml | 2026-07-28T00:41:15Z | success |
| ci.yml | 2026-08-13T23:39:38Z | success |
| data-health-monitor.yml | 2026-08-14T00:04:05Z | success |
| discover-spot-candidates.yml | 2026-07-27T22:30:06Z | success |
| e2e-tests.yml | 2026-08-13T22:55:12Z | success |
| ecmwf-band-closure-probe.yml | 2026-08-02T14:33:58Z | success |
| ecmwf-ensemble-decode-verify.yml | 2026-08-07T02:06:47Z | success |
| ecmwf-ensemble-full-horizon-cost.yml | 2026-08-07T02:40:09Z | success |
| ecmwf-ensemble-key-probe.yml | 2026-08-07T00:22:38Z | success |
| ecmwf-ensemble-mean-vs-deterministic.yml | 2026-08-07T01:30:06Z | success |
| encoding-check.yml | 2026-08-13T23:39:38Z | success |
| forecast-accuracy-monitor.yml | 2026-08-13T19:58:03Z | success |
| forecast-calibration-census.yml | 2026-08-13T21:25:05Z | success |
| forecast-ingest-pilots.yml | 2026-08-13T20:21:42Z | success |
| forecast-ingest.yml | 2026-08-13T21:04:56Z | success |
| keep-warm.yml | 2026-08-13T23:56:24Z | success |
| l2-orphan-sweep.yml | 2026-07-08T04:51:53Z | success |
| lighthouse.yml | 2026-08-13T23:39:38Z | success |
| loc-check.yml | 2026-08-13T23:39:38Z | success |
| **marine-nightly.yml** | **2026-08-13T08:01:43Z** | **FAILURE** |
| precompute.yml | 2026-08-13T20:17:10Z | success |
| **python-upgrade-readiness.yml** | — | **NEVER RUN** |
| science-shadow-ab.yml | 2026-08-11T14:54:44Z | success |
| sim-parity-monitor.yml | 2026-08-14T00:01:44Z | success |
| vector-blockmean-parity.yml | 2026-08-07T00:06:40Z | success |

**18 of 27 workflows were outside the audit program's green census. One of the 18 is red. One has
never executed.**

---

## 2. What `marine-nightly.yml` actually is

`.github/workflows/marine-nightly.yml`, job `zoomlab-battery`, scheduled `cron: '30 6 * * *'`,
in place since 2026-07-18:

- installs Playwright chromium (`--with-deps`)
- boots the **real CRA dev server** on :3009 with mock auth against **production backend data**
- runs `node scripts/zoomlab.js staircase_full /tmp/zoomlab-out`
- grades with `frontend/scripts/zoomlab-verdict.js` against a budget: *≤2 render findings, 0
  `DEAD_BAND_PERSISTENT`, 0 `SETTLED_STEP`*
- uploads `/tmp/zoomlab-out` as an artifact, `retention-days: 14`

`frontend/scripts/zoomlab.js` (26,730 bytes, git-tracked) is described in its own header as a
*"real-gesture marine zoom/pan forensics harness (Playwright/CDP). Trusted wheel/drag input,
full-rate rAF, per-frame pixel+flag trace synchronized on map.on('render'), **video proof**."*

```js
// frontend/scripts/zoomlab.js:40
recordVideo: { dir: outdir, size: { width: 1280, height: 800 } },
// :493
const vids = fs.readdirSync(outdir).filter((f) => f.endsWith('.webm'));
```

It launches with `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`,
`--disable-backgrounding-occluded-windows` — i.e. it is a **compositing, full-rate-rAF frame
harness**, the exact capability 12.1 recorded as absent.

The verdict engine (`zoomlab-verdict.js`) classifies four optical defect types:
`DEAD_BAND_PERSISTENT`, `DEAD_BAND_TRANSIENT`, `SETTLED_STEP` (|ΔL| between consecutive same-zoom
frames), `MULT0_FRAME` (frame drawn with mult 0 — the blank-flash class), and separates
`renderFindings` from `instrumentFindings` so transport failures cannot be graded as rendering
defects.

---

## 3. It is red, and it has been red roughly half the time

`gh run list --workflow=marine-nightly.yml --limit 40` → **37 runs, 18 failure / 19 success
(48.6% failure)**. Failing at HEAD:

```
render findings=22 settled_steps=1 persistent=0 (budget: ≤2 findings, 0 persistent, 0 settled steps)
OVER BUDGET — failing
##[error]Process completed with exit code 1.
```

The failing run's artifact still exists:

```
zoomlab-nightly-31680258907   59,558,824 bytes   expires 2026-08-27T08:12:03Z
```

### The red is graded, not flaky — the harness says so itself

Pulled from the run log (`gh run view 31680258907 --log`):

```
[zoomlab] videos: page@e7970e4ed413a5cfd3e1b1f1669c2fdb.webm
[verdict] FAIL — 22 render finding(s), 0 instrument finding(s), 387 anim frames,
                 156 water samples, 9 land band-frames excluded
```

Three things this settles:

1. **A `.webm` exists in a retained CI artifact** — governance condition 3, literally.
2. **387 animation frames were analysed.** Frames are being counted in CI, at full rate, today.
3. **`0 instrument finding(s)`.** The verdict engine's own REFUSE class did not trigger, which is
   its way of saying *the sea under test was delivered, so the renderer WAS graded.* The 22 findings
   are therefore **graded rendering defects, not consequences of missing data** — the exact
   distinction `zoomlab-verdict.js:154-158` exists to draw. This is not a red meaning "Render was
   asleep".

The 22 comprise 1 `SETTLED_STEP`, 0 `DEAD_BAND_PERSISTENT`, and 21 of the transient/`MULT0_FRAME`
(blank-flash) classes.

⏱ **Timeline caveat, stated because it changes what to do next.** The red run graded `7b74ae96`
(2026-08-13T01:30-04:00). `git merge-base --is-ancestor 7b74ae96 f3fe2c85` → **true**: it ran
**14 commits before** the WS-CAN-0061 ocean-mask layer-order fix (`f3fe2c85`, 16:05-04:00).
Whether that fix cleared the blank-flash findings is **unknown**. The next scheduled run
(2026-08-14T06:30Z) answers it — *if someone reads it*, which is the whole problem.

★ Note the shape: `MULT0_FRAME` is *"any frame drawn with mult 0 — the blank-flash class"* and
`SETTLED_STEP` is a luminance jump between consecutive same-zoom frames. WS-CAN-0061 was ultimately
diagnosed as a **mid-gesture** defect — the field rendered during the zoom and was erased on settle
— after nine hypotheses died to readings that all settled first. **zoomlab is precisely the
instrument that class of defect requires, it was already in CI, and it was already red.**

The workflow's own inline comment already conceded the situation:
*"a red meaning 'Render was asleep' is how the only optical net in the estate became a red nobody
read (most days since 08-03)."*

Measured against that claim: of the 20 runs dated 2026-08-03 or later, **13 failed**.

---

## 4. Where it is in the audit program: nowhere

Searches, each paired with a positive control so the miss is a measurement and not a typo:

```
grep -ric "zoomlab" audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv  →  0
grep -ric "zoomlab" audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv               →  0
grep -ril "zoomlab" audit/weather-simulation-12.1/                                          →  (no files)
POSITIVE CONTROL:
grep -ric "playwright" audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv → 3
grep -ric "playwright" audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv             → 3
```

**It is not a discovery — it is a loss.** Audit 11.0 knew it, and graded it:

> `audit/weather-simulation-11.0/evidence/console/S1-workflow-green-audit.md:92`
> `| **marine-nightly.yml** zoomlab-battery | the battery ran | **that the renderer was graded.**
> REFUSE (code 3) → exit 0 (:121-126); and if verdict.json is missing/unparseable the budget test
> silently prints "WITHIN BUDGET — PASS" (:135-145) | **YES ×2** |`

12.0 reduced it to one word inside a list of workflow names (line 46, no analysis). 12.1 dropped it
entirely.

---

## 5. The consequence for 12.1's headline claim

12.1 `OPEN_BLOCKERS_AND_EVIDENCE_GAPS.md` §6, *"The single largest remaining evidence gap in the
program"*:

> **"Nobody has ever seen this application render a weather field in a controlled, recorded way.
> Six audits, zero recordings."**

And `AUDIT_GOVERNANCE_AND_CLOSURE_RULES.md`, condition 3 for authorising a seventh broad audit:

> *"Runtime media evidence exists (WS-CAN-0027) — at least one `.webm` in a CI artifact. Six audits
> have now run without the ability to see a temporal defect."*

A `.webm`-producing, frame-synchronised, real-gesture harness has been running nightly in CI since
2026-07-18 and its artifacts are retained for 14 days. **Condition 3 was already satisfied when
12.1 declared it unsatisfied**, and WS-CAN-0027 — authorised as the mission that would close the
program's largest evidence gap — was closing the *second* such lane, not the first.

⚠️ **Scope discipline — what this does NOT say.** zoomlab grades the **WebGL marine field**
(luminance columns, mask ground truth, mult flags) via the `staircase_full` scenario. It is **not**
an `om://` weather-raster oracle, and it does **not** cover the `layers`/`alllayers` scenarios in
CI even though `zoomlab.js` implements them (:377, :395). So the correct claim is narrower than
12.1's is wrong:

- **12.1's claim as written** ("nobody has ever seen this application render … in a controlled,
  recorded way") is **refuted**.
- **A defensible restatement** — "the om:// weather-raster path has no optical oracle in CI" — is
  **still true**, and is the residue worth tracking.
