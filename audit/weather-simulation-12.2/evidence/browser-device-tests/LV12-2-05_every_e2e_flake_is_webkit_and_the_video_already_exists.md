# LV12.2-05 — Every observed E2E flake is WebKit, and WS-CAN-0027 already filmed one

**Captured** 2026-08-13/14 from GitHub Actions logs and the artifacts API. Read-only.

---

## 1. First, the thing that is NOT a gap

Before claiming anything about browser coverage I checked what the lane actually runs.

`frontend/playwright.config.js:47-64` declares **four projects** — `Mobile Safari` (iPhone 13),
`Desktop Chrome`, `Desktop Firefox`, `Desktop Safari` — and `.github/workflows/e2e-tests.yml:116`
runs `npx playwright install --with-deps` (all browsers), `:173` `npx playwright test` with **no
`--project` filter**. Confirmed in the log of the last run:

```
13 [Desktop Chrome]   13 [Desktop Firefox]   13 [Mobile Safari]   28 [Desktop Safari]
```

**Cross-browser and mobile-viewport coverage EXISTS and runs on every push.** Chromium, Gecko and
WebKit, desktop and mobile. This should not become a task. It belongs in
`DO_NOT_CREATE_DUPLICATE_WORK.md`.

## 2. What the green is actually hiding

The workflow conclusion is `success`. The summary underneath it is not:

```
5 flaky
  [Desktop Safari] › e2e/booking-flow.spec.js:52:3  › explore is auth-gated …
  [Desktop Safari] › e2e/booking-flow.spec.js:101:3 › spot cards are visible on explore
  [Desktop Safari] › e2e/weather-simulation.spec.js:146:3 › non-admin surfer is locked out …
  [Desktop Safari] › e2e/weather-simulation.spec.js:185:3 › admin simulation engine executes
                                                            weather swell spike scenario
  [Desktop Safari] › e2e/weather-simulation.spec.js:270:3 › standard surfer map controls model
                                                            selection, layer toggle, and timeline scrubbing
5 skipped
42 passed (6.9m)
```

`retries: 2` (`playwright.config.js:30`) means a **flaky** test *failed on its first attempt* and
passed on a retry. `52 = 42 passed + 5 skipped + 5 flaky`.

### Measured across the last six E2E runs

| head sha | flaky | skipped | passed | conclusion |
|---|---|---|---|---|
| `06bf431f` | 0 | 5 | 47 | success |
| `3f83bbdb` | 0 | 5 | 47 | success |
| `f3fe2c85` | 0 | 5 | 47 | success |
| **`181b7ba7`** | **12** | 5 | 35 | success |
| `69ac3ddb` | 0 | 5 | 47 | success |
| **`172f66aa`** | **5** | 5 | 42 | success |

**All 17 flaky results across both runs are `[Desktop Safari]`. Not one is Chrome, Firefox or
Mobile Safari.** In the 12-flaky run, five are `weather-simulation.spec.js`, including the two
central weather interactions:

- `:270` *standard surfer map controls model selection, layer toggle, and timeline scrubbing*
- `:356` *surfer switches models GFS vs Copernicus and validates telemetry & wave animation canvas*

## 3. Consequence for WS-OBJ-705

**WS-OBJ-705 (CI and E2E lane integrity) is CERTIFIED COMPLETE** in the 12.1 register on evidence
LV-02: *"five consecutive completed runs, `Running 52 tests · 47 passed · 5 skipped · 0 failed`."*

Two things about that reading:

1. It was **accurate for the runs it read.** Those five were the 0-flaky runs. This is not a 12.1
   error of observation.
2. But `47 passed` is what Playwright prints when flaky results are folded in — and the certificate
   rests on a workflow **conclusion** plus a passed/skipped/failed triple, neither of which can
   express `flaky`. Governance rule 15 says *"a green check is read for content, never for colour"*
   and lists the known disguises: a cancelled run, a skipped suite, a `test.fixme`. **`flaky` is a
   fourth disguise the rule does not name**, and it is the one live at HEAD.

**Disposition: reopen WS-OBJ-705 as PARTIAL.** Not because the lane is broken — 42 of 52 genuinely
pass on the first attempt in every browser — but because the closure criterion cannot see a class of
failure that is currently occurring in the browser engine with the weakest coverage.

## 4. The video already exists

From the same run's log:

```
test-results/weather-simulation-Standar-dcaeb-ggle-and-timeline-scrubbing-Desktop-Safari/video.webm
```

and the artifact is retained:

```
playwright-report   7,665,646 B   expires 2026-08-27T23:05:40Z
```

**WS-CAN-0027 shipped at `181b7ba7` and within hours captured video of a weather test failing in
WebKit.** The program's stated purpose for that key — *"a temporal defect can be seen, not only
described"* — has been satisfied by the mechanism working exactly as designed, on the first
qualifying failure. **Nobody has downloaded it.**

This is the cheapest high-value action available in the program right now: the artifact exists, it
expires 2026-08-27, and it answers a question no static analysis can.

## 5. A hypothesis with a mechanism, explicitly NOT a verified outcome

The three runs before the video key landed had **0** flaky. Two of the three after had **12** and
**5**.

A plausible mechanism: `video: 'retain-on-failure'` makes Playwright record continuously and discard
on pass, so every test pays the capture cost. The per-test timeout is 90 s
(`playwright.config.js:27`) against a **live** deployment backed by a 1-CPU Render box, and that
timeout comment already records the lane as historically timeout-bound (*"6 pass / 28 fail"*).
WebKit is the slowest of the three engines under Playwright's recorder.

⚠️ **n = 3 on each side. This is not a finding, it is a lead**, and it is stated here precisely so
nobody converts it into one. The same config comment that establishes the lane's history also warns,
in this program's own words, that *"a generated diagnosis attributed these failures to … Measured,
all of it is wrong."*

**Two cheap discriminators, in order:**

1. Open the retained `video.webm` and `trace` for `weather-simulation.spec.js:270` on Desktop Safari.
   If the page had already rendered at the deadline, the cause is timeout budget, not the app. If it
   was still spinning, it is a real WebKit defect in the weather feature.
2. Re-run the lane once with `video: 'off'` and compare flaky counts at the same sha.

If (1) shows a rendered page, the fix is a per-project timeout, not a revert — and **the video key
must not be reverted**, because it is the only reason the question is answerable at all.
