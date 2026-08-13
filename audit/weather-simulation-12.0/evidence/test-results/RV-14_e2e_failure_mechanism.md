# RV-14 — The E2E lane's chronic failure has a named mechanism: `.json` matches `.js`

| Field | Value |
|---|---|
| Evidence ID | RV-14 |
| Date | 2026-08-13 |
| Run analysed | `31652826600`, head `b5632fc7`, 35.8 min, **16 failed / 1 flaky / 31 passed** |
| Proposed task | **WS-CAN-0059** |
| Production code modified | **NONE** — log analysis + source inspection |

---

## Verdict

**Not an app regression.** The failures are confined to two browser projects, and the dominant error
string is produced by a **one-character substring bug in the spec's own global route handler**:
`url.includes('.js')` matches `.json`.

⚠️ **What is confirmed and what is not** — these are different claims and the difference matters:

| Claim | Status |
|---|---|
| Failures are Safari/Firefox only; Chrome and mobile clean | **Confirmed** from the run's artifacts |
| `.json` URLs are served `/* mocked */` as `application/javascript` | **Confirmed by inspection** — `'.js' in 'manifest.json'` is `True` |
| That produces the exact observed error string | **Confirmed** — the string matches byte-for-byte |
| That this *fully explains* the Safari/Firefox-only pattern | ⛔ **NOT established.** Chrome runs the same handler and passes |

---

## 1. The failures are browser-confined

| Project | failed-test artifacts (first attempt) |
|---|---|
| **Desktop Safari** | **24** |
| **Desktop Firefox** | **10** |
| Desktop Chrome | **0** |
| Mobile Safari | **0** |

A regression in the application would not spare Chrome *and* both mobile projects while hitting
WebKit and Gecko exclusively. **That split alone rules out the app**, and is why a re-run was not
worth 35 minutes.

## 2. The error signatures

```
36x  page.goto: Operation was cancelled; maybe frame was detached?
14x  The string did not match the expected pattern.
14x  Unexpected token '/', "/* mocked */" is not valid JSON
13x  page.goto: Test timeout of 90000ms exceeded.
12x  Request failed with status code 401
12x  Request failed with status code 404
```

⭐ **Read the order of causation backwards from the timeouts.** The 90-second `page.goto` timeouts
and the 36 "frame was detached" cancellations are what a test reports when the page tears down
mid-navigation. They are the *consequence*. The parse failure is upstream of them.

## 3. The mechanism

`weather-simulation.spec.js:74-99` installs a global handler over `**/*`:

```js
} else if (url.includes('.js') || route.request().resourceType() === 'script') {
  route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
```

`includes` is a **substring** test, and `.json` contains `.js`:

```
https://x.com/a.json         includes(".js") -> True
https://x.com/manifest.json  includes(".js") -> True
https://x.com/b.js           includes(".js") -> True
https://x.com/style.css      includes(".js") -> False
```

So **every `.json` URL off an allowed origin is answered with `/* mocked */` under a JavaScript
content type.** Any consumer calling `.json()` or `JSON.parse` on it raises precisely:

```
Unexpected token '/', "/* mocked */" is not valid JSON
```

The allow-list is the site origin, the backend origin, and localhost variants. Anything else — a
basemap style JSON, a font or PWA manifest, a third-party config — lands in this branch.

## 4. This handler has caused a false finding before

The file's own comment, twelve lines above the bug:

> *"With only the site listed, every backend call fell through to the terminal `else` and was
> fulfilled with a SYNTHETIC 404 by this very handler — which is the literal source of
> `renderDecision: "fallback_legacy", reason: "Backend grid returned HTTP 404"`. **The 404 was
> manufactured here; the backend never sent it.** Measured 2026-08-06: the identical click sequence
> run WITHOUT this handler returns 200 on 8 of 8 `/api/weather` requests."*

**This is the second defect in the same handler**, and the first one manufactured a backend failure
that was investigated as real. The 12 live `404` errors in §2 are that same terminal `else` firing
again — by design this time, but indistinguishable in a log from a genuine one.

⇒ **A test harness that fabricates responses is an instrument, and this one has now produced two
false signals.** It deserves the same scepticism the audit applies to production instruments.

## 5. What is still unexplained

**Why Chrome passes.** Chrome installs the identical handler and does not fail. Candidates, none
tested:

1. The engines request **different** third-party `.json` resources (font manifests, PWA manifest,
   basemap style variants), so only WebKit/Gecko hit the branch.
2. Timing — Chrome may complete the parse before teardown, converting a hard failure into a
   tolerated one.
3. Retry/caching differences that keep the malformed body out of the parsing path.

⛔ **Until one of those is measured, the substring bug is a confirmed defect with an unconfirmed
share of the blame.** Fixing it may close the lane, or may reveal a second cause underneath. Both
outcomes are informative; neither is predicted here.

## 6. The fix, and the risk of it

One line:

```js
} else if (/\.js(\?|$)/.test(url) || route.request().resourceType() === 'script') {
```

⚠️ **Do not ship it as an obvious win.** The lane's config carries an explicit warning that a
previous "obvious fix" was measured and found to be a no-op, and its stated failure history is
**6 pass / 28 fail across 34 runs**. The correct sequence is:

1. Fix the matcher.
2. Dispatch **one** run and count the browser split again.
3. If Safari/Firefox still fail, the substring bug was a contributor, not the cause — and §5 is the
   live question.

**Do not claim the lane is fixed on a single green run.** At a historical 18% pass rate, one green
is inside the noise of the existing behaviour.

## 7. Why this matters to the program

`WS-CAN-0027` (runtime evidence capture) is the program's most-repeated unclosed task — four audits,
zero recordings. The remedy is Playwright `video: 'retain-on-failure'`, and **video only has value
on a lane whose failures mean something.** A lane failing 82% of the time on a harness bug would
produce a stream of videos of a manufactured problem.

⇒ **WS-CAN-0059 should land before WS-CAN-0027**, which reorders the NOW list in
`PROGRAM_PATH_FORWARD.md`. That is a real change to the roadmap, produced by an incidental CI
failure rather than by a planned investigation.

---

## Appendix — how this was found, and the two errors on the way

1. I first reported the E2E runs as **failed**. They were **cancelled** — my check binned
   `cancelled` with `failure`. Six consecutive cancellations, cause: nine pushes in 42 minutes from
   two concurrent sessions against a 10–16 minute lane. The workflow diagnoses this itself and names
   the lever: *BATCH PUSHES*.
2. I then told the owner a manual dispatch would "sidesteps the cancel-on-push race entirely."
   **Wrong** — `github.ref` is `refs/heads/dev` for both push and dispatch, so a dispatch shares the
   concurrency group and would have killed the live run at 18 minutes. I did not dispatch.

The genuine failure that produced this finding only became visible once the branch went quiet and a
run was allowed to complete.
