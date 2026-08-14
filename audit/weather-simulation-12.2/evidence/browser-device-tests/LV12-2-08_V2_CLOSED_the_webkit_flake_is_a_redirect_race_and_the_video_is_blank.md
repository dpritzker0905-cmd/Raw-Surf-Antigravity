# LV12.2-08 — VERIFY ITEM V2, CLOSED. The WebKit flake is a redirect race, and the video is blank

**Captured** 2026-08-14 from `playwright-report` of E2E run **31771207733** (`886094ce`), 33.7 MB,
downloaded before its 2026-08-28 expiry. 11 videos, 11 traces, 11 error contexts.

This closes **V2** in `PATH_FORWARD_12.2.md`, which asked: *is the WebKit flake a timeout budget or a
real WebKit defect in the weather feature?*

---

## The answer: a redirect race in the test harness. Not the app, not the map, not weather.

### 1. The confinement is total

**11 of 11 flaky results are `[Desktop Safari]`.** Chrome 0, Firefox 0, Mobile Safari 0. Six are
`booking-flow.spec.js`, five are `weather-simulation.spec.js`.

### 2. Every one fails on the FIRST navigation

All 11 error contexts carry the identical error:

```
Error: page.goto: Operation was cancelled; maybe frame was detached?
Call log:
  - navigating to "https://dev--rawsurf.netlify.app/auth", waiting until "domcontentloaded"
```

Destination breakdown: **9 → `/auth`**, 1 → `/auth?tab=signup`, 1 → `/explore`. Not one of them
reaches the map, a layer toggle, a model switch or any weather assertion. **The failure is upstream
of everything the weather tests test.**

### 3. What the traces show

Of the 11 traces, **only 4 carry a recorded error, and all 4 are the same one**:

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  waiting for navigation until "load"
  navigated to "https://dev--rawsurf.netlify.app/auth"
```

at `weather-simulation.spec.js:182` and `:267`, each burning exactly ~10,004 ms.

⚠️ **That wait is `.catch(() => {})` — tolerant by design, and NOT the test failure.** Its own
comment says so:

```js
// :182  Tolerant by design: if a build stops redirecting there is nothing to await, and the wait
//       expiring changes nothing about what the test then asserts.
// :267  Same /auth -> /feed redirect race as the admin block above; settle it before the test's own
//       goto('/map') so an in-flight redirect cannot interrupt it.
await page.waitForURL(/\/(feed|explore)(\/|$|\?)/, { timeout: 10000 }).catch(() => {});
```

**The settle exists precisely to stop an in-flight redirect from cancelling the next navigation, and
on WebKit its 10 s ceiling is not enough — so the very race it was written to prevent still fires.**

### 4. The discriminator, answered as it was set in advance

`PATH_FORWARD_12.2.md` V2 committed to the reading **before** the artifact was opened:

| what the evidence shows at the deadline | conclusion | action |
|---|---|---|
| the page had already rendered | timeout budget, not the app | a per-project timeout, **not** a revert |
| the page was still spinning | a real WebKit defect in the weather feature | open a defect with the trace |

The trace log reads **`navigated to "https://dev--rawsurf.netlify.app/auth"`** — the navigation
*succeeded*; only the `load` event failed to arrive inside the tolerant 10 s window.

⇒ **It is the budget.** No revert. No weather defect. The fix is a longer or WebKit-aware settle.

### 5. The repo had already written the rule

`frontend/e2e/weather-simulation.spec.js:79-82`, landed `af0be9df` on **2026-08-12 23:37**:

> the failures were BROWSER-CONFINED (Desktop Safari 24 artifacts, Firefox 10, **Chrome 0, mobile
> 0**), which is what ruled out an application regression. The 36 `frame was detached`
> cancellations and 13 ninety-second `page.goto` timeouts were **CONSEQUENCES of the page tearing
> down mid-navigation; read the causation backwards from the timeouts, never forwards.**

Today's data is that rule reproducing exactly, with the confinement now even tighter (Safari 11,
everything else 0).

---

## ⛔ My own lead is REFUTED

`LV12-2-05` §5 raised — explicitly labelled *"a hypothesis with a mechanism, NOT a verified
outcome … n = 3 on each side"* — that `video: 'retain-on-failure'` might be causing the flakiness
through per-test recording overhead.

**It is not.** Two independent reasons:

1. **The error is not a timeout of the kind recording overhead produces.** It is a navigation
   *cancellation*, and the recorded `waitForURL` expiry is a deliberately-caught tolerant wait.
2. **The signature predates the video key by 17 hours.** `git log -S "frame was detached"` →
   `af0be9df`, 2026-08-12 23:37. `git log -S "retain-on-failure"` → `181b7ba7`, 2026-08-13 16:38.

The lead was correctly labelled and is now correctly dead. The config's own comment warned about
exactly this: a prior generated diagnosis of this lane was *"measured, all of it is wrong."*

---

## ⚠️ And the video — the thing this audit made its headline — is BLANK

Every one of the 11 retained `.webm` files is **1,924 bytes**. Decoded with ffmpeg and measured with
the repo's own `pngPixels.js` oracle:

```
duration   : 00:00:00.96      stream: vp8 800x450 25 fps      frames extracted: 24
frames/f001.png  centre_rgb=255,255,255  variance=0.00%
frames/f012.png  centre_rgb=255,255,255  variance=0.00%
frames/f024.png  centre_rgb=255,255,255  variance=0.00%
first vs last frame differ: 0.00% of pixels
```

**0.96 seconds of a pure white page, 24 identical frames, zero variance.** Because the failure
happens *during the first navigation*, there is nothing painted to record.

### What that means for WS-CAN-0027 and WS-OBJ-503

This is a **correction to this audit's own emphasis**, and it should be read alongside the finding it
qualifies rather than instead of it:

- WS-CAN-0027 **works**. The key is set, the mechanism fired on the first qualifying failure, and the
  artifact was retained and retrievable. That is not in doubt.
- But **for this failure class it captured nothing**, and **the trace is what diagnosed it** — the
  action timeline, the error owner, the stack line and the `navigated to` log. Not the video.
- So the claim that video *"closes the program's largest evidence gap"* is **narrower than 12.2
  stated it**. Video answers *"what did the screen do over time"*. It cannot answer *"why did a
  navigation get cancelled before first paint"*, and the failures actually occurring in this lane are
  the second kind.

★ The generalisation worth keeping: **an instrument that produces an artifact is not the same as an
instrument that answers the question.** 12.2 spent its headline on the existence of recordings; the
diagnostic work here was done entirely by `trace: 'on-first-retry'`, which the program already had
and never celebrated.

---

## Disposition

| item | disposition |
|---|---|
| Revert `video: 'retain-on-failure'` | **NO.** It is not the cause, and it costs ~2 KB per failure |
| Weather-feature defect | **NONE FOUND.** No flaky attempt reaches a weather assertion |
| The actual fix | Raise the tolerant settle for WebKit, or replace the fixed 10 s with a wait on the redirect's own completion. It is a **harness** change, in `beforeEach`, and it is not on the critical path |
| WS-OBJ-705 | Stays **PARTIAL** (reopened by 12.2). The lane's conclusion still cannot express `flaky`, and 3 of the last 7 runs carried it (12, 5, 11) |
| Trace retention | `trace: 'on-first-retry'` is the instrument that earned its keep here. Do not weaken it |
