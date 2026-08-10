# F2 red-team: "Every Lighthouse assertion is warn, so the required check has never been able to go red"

Verified at HEAD `edf91af9`, 2026-08-09/10. READ-ONLY sweep.

## 1. Cited locations — do they say what is claimed?

`lighthouserc.json:12-19` — CONFIRMED verbatim:

```
12      "assert": {
13        "assertions": {
14          "categories:performance": ["warn", { "minScore": 0.6 }],
15          "categories:accessibility": ["warn", { "minScore": 0.7 }],
16          "categories:best-practices": ["warn", { "minScore": 0.8 }],
17          "categories:seo": ["warn", { "minScore": 0.7 }]
18        }
19      },
```

`.github/workflows/lighthouse.yml:7-9` — CONFIRMED verbatim:

```
7    # `main` added 2026-08-05 with ci.yml -- the promotion is a fast-forward push, so it ran no checks.
8    # No `paths:` filter here either, so this job always runs and is safe as a required check
9    # (measured: 20 of the last 20 runs succeeded).
```

Job id is `lighthouse` (lighthouse.yml:16), matching the required-check context string.

## 2. Reachable?  YES

`on: push: branches: [dev, main]` + `pull_request` (lighthouse.yml:10-13). No `paths:` filter.
2,919 total runs all-time (`actions/workflows/lighthouse.yml/runs .total_count`).

## 3. Required check — CONFIRMED

`gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'`:
```
["lint-and-build (18.x)","frontend-lint","frontend-marine-composition-guards","backend-lint",
 "backend-file-size-check","backend-import-check","backend-bola-guard",
 "backend-sim-composition-guards","backend-forecast-chain-guards","lighthouse"]
```

## 4. Green history — REPRODUCED, then WIDENED

- Claimed sample reproduced exactly: `--limit 100` => 100 success, 0 failure.
  ⚠️ That sample spans only 2026-08-09T16:56Z -> 2026-08-10T01:49Z (under 9 hours).
- Widened to ~1,000 runs (pages 1-10, 100/page): **4 failures**, 996 success, 1 null (in-flight).
- Every failure inspected at step granularity:

| run | date | job/step outcome |
|---|---|---|
| 29210299135 | 2026-07-12 | `Build frontend => failure`; **`Run Lighthouse CI => skipped`** |
| 29209380545 | 2026-07-12 | `Build frontend => failure`; **`Run Lighthouse CI => skipped`** |
| 29018403868 | 2026-07-09 | job `cancelled` |
| 31122261670 | 2026-08-06 | job `cancelled` |

**Zero of ~1,000 runs ever failed at the `Run Lighthouse CI` step.** The only red this job can
produce is a build/infra red -- and `Build frontend` is already gated by the separate required
check `lint-and-build (18.x)` (`ci.yml:100-105`). So `lighthouse` contributes **no independent
gating signal** to main.

## 5. The consequence the finding left NOT MEASURED — now MEASURED

Newest run 31348107505 (`edf91af9`) step log, lines 1373-1382:

```
Checking assertions against 3 URL(s), 3 total run(s)

1 result(s) for http://localhost:37751/ :

  WARN  categories.performance warning for minScore assertion
        expected: >=0.6
           found: 0.42
      all values: 0.42

All results processed!
```

**Performance is 0.42 against its own 0.6 threshold — a live, currently-breached assertion, and
the job is green.** This is a direct measurement of the load-bearing mechanism: a breached `warn`
assertion does not fail the job. (I did NOT run a counterfactual with `error`; that would require
editing the config, which this sweep forbids. The `warn`-does-not-fail half is what matters and it
is measured.)

## 6. REFUTATION — the green is NOT unreadable

The finding's "why-unreadable" rationale does not hold. **Three independent channels carry the full
detail**, all present in the same run:

1. **Step log** — prints category, threshold and measured value (`expected: >=0.6 / found: 0.42`),
   lines 1377-1380.
2. **GitHub annotation** — `##[warning]` at line 1404, surfaced on the run summary page and the PR,
   not buried in the log:
   ```
   ##[warning]1 result for http://localhost:37751/
   Report: https://storage.googleapis.com/.../1786326795245-60860.report.html
   WARN `categories.performance` warning for `minScore` assertion
   Expected >= 0.6, but found 0.42
   ```
3. **Artifact + hosted reports** — `uploadArtifacts: true` / `temporaryPublicStorage: true`
   (lighthouse.yml:42-43). Measured: artifact `lighthouse-results`, id 9048071006, 1,055,301 bytes,
   `expired=false`, retained to 2026-11-08; plus three public HTML reports with URLs printed
   (lines 1394-1399).

This is the **opposite** of the `e2e-tests.yml` defect being generalised. There, the string
"weather-simulation" appeared ZERO times across 2,393 log lines. Here the category name, the
threshold, the measured value, an annotation and a 1 MB archived artifact are all present.
**F2 is a NON-GATING CHECK, not an UNREADABLE REFUSAL.** Different class.

## 7. REFUTATION — the accessibility framing is overstated

Counts over the full run log:

```
accessibility          0
best-practices         0
seo                    0
performance            4
result(s) for          1
All results processed  1
```

LHCI reports only assertions that warn or error. Across 3 URLs, exactly **one** result was emitted
and it was `performance`. Therefore **accessibility >= 0.7, best-practices >= 0.8 and seo >= 0.7
all PASSED on all three URLs at HEAD.**

The finding states a reader "seeing 'lighthouse OK' concludes the accessibility score cleared 0.7;
nothing was ever gated." The second clause is true; the first conclusion happens to be **factually
correct at HEAD**. The category that is actually breached is performance, which the finding does
not mention. (Caveat retained: a Lighthouse a11y *score* is automated-only and is not a WCAG
conformance claim, so it is weak evidence for the CLAUDE.md mandate either way.)

## 8. Deliberate / documented?  NOT deliberate, but not concealed either

`git log --follow -- lighthouserc.json` returns only two commits:
- `5fbff329` "feat: v15 — wire Explore decomposition + Lighthouse CI + PWA offline support"
- `e8eebd46` "fix: add isSinglePageApplication to Lighthouse CI config"

`git log -S'"warn"' -- lighthouserc.json` returns only `5fbff329`. The assertions were **born
`warn`** in the commit that introduced Lighthouse CI (2026-05-03); nothing was ever downgraded from
`error`. The commit message says only "score thresholds", with no rationale for the severity level.
No doc anywhere states the assertions are advisory.

## 9. The over-reading IS documented in the estate (supports the finding)

Handoffs repeatedly cite Lighthouse green as a quality signal:
- `docs/research/HANDOFF-2026-08-09-B-...md:30` — "final pushed SHA fully green (CI/E2E/Lighthouse/LOC/Encoding...)"
- `docs/research/MASTER-AUDIT-3.0-2026-08-05-...md:180` — "CI OK · Lighthouse OK"
- `docs/runbooks/HANDOFF-2026-07-16-...md:40` — "CI / Lighthouse | success on `b21cf29d`"
- plus 9 more occurrences.

So the *over-interpretation* half of the finding is real and evidenced. The *unreadability* half is not.

## Verdict

The defect survives as a **non-gating required check**, and is stronger than filed on one axis
(a live 0.42 breach is being suppressed, which the finding had marked NOT MEASURED). It fails as an
instance of the "refusal you cannot read" class: the refusal is fully readable in three channels.
Severity corrected High -> **Medium**: no independent gating signal is lost that `lint-and-build`
does not already provide, the currently-breached category is performance rather than accessibility,
and every channel needed to correct the misreading is present and archived.
