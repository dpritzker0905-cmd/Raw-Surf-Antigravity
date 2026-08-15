# SELF-AUDIT — Program 13.0, session of 2026-08-14

Audited with the same instruments used on the codebase. Ten commits, seven missions, `1f4e5149 → HEAD`.

---

## 1. THE FINDING THAT MATTERS: I committed a red lane

**`a6e4339a` (WS-CAN-0017) broke five tests in `test_noaa_multi_resolution.py` — a file I never
opened, never ran, and did not know existed.**

The mechanism: my `_fetch_message_bytes` length check invalidated every test double that answered a
`bytes=0-999` request with a fixed 8-byte body. I found four such doubles by grepping one spelling,
fixed them, ran those four files, and committed. The **full guards lane** — which I did not run —
found a fifth. A sixth (`test_vector_blockmean_loop_shadow.py`) was latent.

**Why I missed it:** I modified **five guards-lane files** across Missions 5 and 7 and re-ran only
the **estate** lane, because that is where the *new* test files landed. I checked where my additions
went and never asked where my *modifications* went.

> ⇒ **THE LANE THAT OWNS YOUR NEW FILE IS NOT THE LANE THAT OWNS THE FILES YOU EDITED.**

This is the third instance of one class today (Mission 2's consumer census, Mission 7's fixture
census, this): **I enumerate by the spelling I happen to have used, not by the property.** The
standing guard `test_no_test_double_answers_a_RANGE_request_with_a_FIXED_body` now scans for the
property.

## 2. What the session actually produced

| bucket | lines added | share |
|---|---:|---:|
| docs / program control | 2,822 | **63.2%** |
| tests | 914 | 20.5% |
| production code | 697 | 15.6% |
| CI | 29 | 0.6% |

Of the 697 production lines, **499 are the `spot_ratings_precompute.py` file move**. So the session
produced **≈198 lines of genuinely new production code** against 2,822 lines of documentation — a
**14:1 ratio**.

Some of that is the program's own design (§6 mandates a living control system, and closure
certificates are deliverables). But 14:1 is worth stating plainly rather than filing under
"governance".

**Three of seven missions produced no code at all** — the latency forensics, the WS-CAN-0033
closure, and the Gate 1 truth pass. Two of those three *prevented* work: the concurrency fix was
refuted before being built, and the tier disclosure already existed. That is real value, but it is
value measured in work-not-done, which is easy to overstate.

## 3. Delivered value: zero

**Ten commits, none pushed.** Every "reaches production today" in this session describes a *property
of the change*, not a delivered outcome. The backend deploys from `dev` on push; nothing has been
pushed, so nothing is live.

⚠️ And §1 is exactly why that was correct: **one of those ten commits was red.** The batch was not
shippable at the moment I was describing it as production-ready.

## 4. Seven instrument errors of my own

Every one was caught, but the rate is the point — these were tools I built to judge the codebase.

| # | error | how it was caught |
|---|---|---|
| 1 | `'Complete' in state` treated **"Fully Delivered"** as incomplete | vocabulary dump |
| 2 | `startswith('Delivered')` never matches **"Fully Delivered"** — inflated the open-objective count | vocabulary dump |
| 3 | a CONTROL threshold calibrated to the **pre-fix** count, so it went red on success | it failed after the fix landed |
| 4 | `git grep 'model === "ICON"'` **false negative** from quoting — would have closed WS-OBJ-206 while the blend was live | searched a second way |
| 5 | a helper inserted at **column 0 inside a function body** — valid Python, silently truncated the fixture | isolating against a clean HEAD |
| 6 | `.replace()` with no assertion → **silent no-op**, twice | the failure persisted after "success" |
| 7 | the Jacobian scored **WS-CAN-0033 as backend** when its residual is frontend-gated | reading the row after scoring it |

★ Five of seven were found by **pairing a scan with a control or a second method**. None was found by
re-reading my own code.

## 5. What held up

- Every behavioural claim I measured survived re-measurement: the 0.380 s/spot linearity (variance
  checked, σ 0.19), the 2.4× tier disagreement, the 87/87 payload census, the byte-identical `why`
  strings on production.
- Every guard I shipped is **mutation-proven** in both directions.
- I retracted **three** of my own conclusions before they became actions: the concurrency fix, the
  WS-CAN-0064 "blocked on an admin read" claim, and the batch-omission design.
- No test was weakened. Two pre-existing tests were *changed* — both recorded, and both ended up
  stronger (the batch-bounds test now asserts the exception text is **absent**).

## 6. Audit of my own proposed plan

I have proposed an **owner decision packet** three times and built it zero times, choosing another
mission each time. Two problems with it:

1. **Its derivative belongs to someone else.** ∂(program)/∂(packet) = 0 until an owner acts. A plan
   whose rate of change I do not control is a request, not a plan — and I kept ranking it first while
   doing something else, which is the behaviour of a recommendation I did not actually believe.
2. **It was aimed at the wrong decision.** The abstract packet (WS-CAN-0005's staged plan,
   WS-CAN-0039) is real but not urgent. The decision actually on the table is concrete and mine to
   surface: **ten commits are sitting unpushed, and every push to `dev` is a production deploy.**

## 7. What the Jacobian says now

With today's changes applied, the backend + Gate 1 + open surface is:

| task | score | severity | disposition |
|---|---:|---|---|
| WS-CAN-0058 | 4.00 | HIGH | **DEFER** (audit-blocked: needs a cadence + bytes-per-model-run figure) |
| WS-CAN-0024 | 3.00 | Medium | **Investigate** — not yet a defined repair |
| WS-CAN-0029 | 2.00 | Medium | Repair |
| WS-CAN-0017 | 1.00 | Medium | Repair — remaining links (checksum, re-validation) |

*(WS-CAN-0033 still scores 12.00 in the raw ranking; that is instrument error #7 — its residual is
client-side and should carry the frontend multiplier. Corrected, it drops out.)*

> **The Critical and High backend work on Gate 1 is done, owner-gated, or audit-deferred. What
> remains is Medium-severity, and two of the four are investigations rather than repairs.**

That is a real inflection: the marginal value of another mission has dropped sharply, while the
value of *delivering* what exists has not.
