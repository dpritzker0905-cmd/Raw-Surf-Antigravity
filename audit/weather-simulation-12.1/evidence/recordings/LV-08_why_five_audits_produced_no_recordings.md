# LV-08 — The recording gap has a mechanism, and it is not negligence

**Objective:** WS-OBJ-503 (runtime evidence capture) · **Task:** WS-CAN-0027
**Captured:** 2026-08-13, agent-driven browser pane against `dev--rawsurf.netlify.app` (`9febd970`).

## The count is now six audits, not five

Audit 12.0 §1.3 ③ established that across five audits the program produced *"zero recordings, zero
screenshots on disk, zero Playwright traces, zero HAR captures, zero heap snapshots and zero CPU
profiles."*

**Audit 12.1 also produced zero recordings and zero screenshots.** Two `computer{action:"screenshot"}`
attempts, one after explicitly fronting the tab, both returned:

```
Screenshot timed out after 5s: the Browser pane is not displayed, so the page is not
compositing frames. Display the pane and retry.
```

## The mechanism

An agent-driven browser pane **does not composite frames while hidden**. No compositing means:

1. **No screenshots.** The capture path has no frames to capture.
2. **No video.** Same reason.
3. **No valid frame-rate measurement.** This is the same physical fact Audit 11.2 discovered from
   the other side when it found `requestAnimationFrame` delivering ~1 frame per 5 s in an unfocused
   pane, and correctly **retracted every FPS reading in the program**.

So the program's single most-repeated evidence gap is not five successive lapses of diligence. It is
**one environmental property, hit six times**: the surface these audits run on cannot produce visual
evidence, and every audit that tried discovered this and disclosed it rather than faking it.

## Why this *raises* WS-CAN-0027's priority rather than excusing it

WS-CAN-0027 does not ask an agent to record its own pane. It asks for one key in
`frontend/playwright.config.js`:

```js
video: 'retain-on-failure'
```

Playwright launches **its own** browser with its own compositor, in CI, headless-but-compositing. It
is not subject to this constraint at all. **The fix has always been in the one place that can
actually produce frames, and the environment that cannot produce them is the environment that keeps
noticing.**

At HEAD the config still reads `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, and has
**no `video` key**; `@playwright/test` is still `^1.60.0`.

## The blocker on it just cleared

The register gated WS-CAN-0027 behind WS-CAN-0059 — *"video only has value on a lane whose failures
mean something; at the current 82% failure rate on a harness bug, this would produce a stream of
recordings of a manufactured problem."*

**LV-02 closes WS-CAN-0059**: five consecutive completed E2E runs green, 47 passed / 0 failed /
5 skipped of 52 collected. The lane's failures now mean something again, and there is nothing left
between this task and a config key.

## What 12.1 produced instead, and why it is not a substitute

This audit's runtime evidence is **instrument-based**: live `__RAW_GPU__` / `__WEATHER_TELEMETRY__`
reads (LV-04), four-geography API probes (LV-05), the composition payload (LV-06), production
telemetry (LV-07), and the CI log (LV-02, LV-03). That is stronger than a screenshot for every
question asked here — a screenshot cannot tell you `run_time` is a wall clock.

It is **not** a substitute for the questions that remain open precisely because nobody can see them:
frame-rate independence, animation continuity across a scrub, and whether a field paints or is
blank at a given moment. Those need WS-CAN-0027 and WS-CAN-0037, and they will stay open until a
compositing browser runs them.
