# THE PATH TO STATE OF THE ART — researched 2026-08-14

**Question asked:** what is the best path to state of the art?

**Answer, from the program's own primary sources:** *not a technology.* The state-of-the-art gap in
this system is that **instruments exist and go unread, degradations happen silently, and the one
validation gate that can page grades the wrong quantity.** No new dependency closes any of that.

---

## 1. The research method, and why it started inside the repo

§25 says research current guidance *when a mission depends on a technical contract or modernization
choice*. Before surveying anything external I checked whether the program had already answered this —
the session's most reliable finding has been "it already exists and nobody read it", three times over.

It had. `audit/weather-simulation-12.2/STATE_OF_THE_ART_OMISSION_MATRIX.csv` (14 rows) and
`audit/weather-simulation-12.1/STATE_OF_THE_ART_TARGET_CONTRACT.md` define state of the art **as
behaviour, before any technology is named** — the matrix's own column heading.

## 2. What it explicitly rules OUT

> **`WebGPU / OffscreenCanvas / Zarr / SWAN / learned models` → classification: NOT NECESSARY**
> *(unchanged from 12.1, mapped to C5–C8)*

`PATH_FORWARD_12.2` is blunter still about the Tier-3 research tasks (`WS-CAN-0046`–`0051`):

> *"DO NOT START. Nothing in 12.2 changes their prerequisites, and 12.2 strengthens the case against
> them: the platform's problem is not capability, it is that existing capability is unread."*

⇒ A technology survey here would be answering a question the evidence says not to ask. §33 requires a
verified current problem and a measured limitation before any of those; neither exists.

## 3. What it rules IN — four HIGH-priority gaps

| # | capability | class | reachable? |
|---|---|---|---|
| **1** | **An instrument's output has a NAMED READER, and going unread is a failure state** | Missing **Core Requirement** | ✅ backend/CI |
| **2** | Runtime configuration is reportable (261 `window.__RAW_*` overrides, 197 untested) | Missing SOTA capability | ⛔ mostly frontend |
| **3** | Automated degradation is disclosed to the user (`useWebGLGuardrail` silently swaps renderers) | Missing **Core Requirement** | ⛔ frontend |
| **4** | **Validation covers the SERVED quantity, not only the model input** | Covered but Under-Specified | ✅ backend |

Rows 2 and 3 are HIGH but sit behind `WS-CAN-0039` (frozen frontend), so their delivered value is
~0 until the owner unfreezes. **Rows 1 and 4 are backend and reachable today.**

## 4. Row 1 is the root cause of this program's recurring failure mode

The matrix's evidence: *"Three chains are green through Runtime Evidence and worthless"* —
`marine-nightly` RED for 18 of 37 runs and unread; the WebKit failure video that worked on its first
qualifying failure and was never opened; a third.

**Measured today: 27 workflows, 9 of them scheduled, and no generated inventory has ever existed.**
The 27-workflow census (12.2's V5) was never taken.

And this session independently reproduced the same class **three times**, without knowing the row
existed:

- `/api/health` has carried per-route latency telemetry for 41 routes all along — I hand-rolled a
  scaling series before reading it, and it changed the ranking when I did.
- `geometryReadiness` was on the wire and consumed by nothing (Mission 1).
- `resolution` was stamped, measured and guarded — and the objective that needed it was still
  recorded as blocked (Mission 4 / the truth pass).

> ⇒ **This is not an observation about three artifacts. It is the system's dominant defect shape, and
> it is the one thing standing between the program and Finish Line B's terminal condition:
> *"maintenance no longer requires repeated forensic audits."***

**Acceptance criterion (the matrix's own words):** *every instrument in the estate has a named reader
and a cadence; a red or an empty result in any instrument appears in the next audit's baseline census
automatically rather than by hand-list.*
**Means:** *a generated instrument inventory; a digest that fails when an instrument is red or empty.*

⭐ That is the same shape as the guards I have been building all session — **census-discovered rather
than hard-coded** — which is exactly what `WS-CAN-0066`'s alert guard and today's fixture-census guard
do. The pattern is proven in this codebase.

Maps to **WS-OBJ-706** (*"the program registers the SYSTEM and not only the WORK"*) and **WS-CAN-0067**.

## 5. Row 4 is the sharpest *scientific* gap, and it is small

> *"The gate that can page grades offshore `hs_m` at the buoy — `buoy_calibration.py:410-413`
> resolves at the BUOY deliberately, to exclude nearshore shoaling."*

So the one instrument that can page grades the **offshore significant wave height** — the exact
quantity `CLAUDE.md`'s loudest landmine says must never be reported as the surf height — while every
user-facing surface serves the **nearshore breaking** height. The gate is not wrong; its **scope is
undeclared**, which lets it read as validating something it does not.

**Verified today:** `forecast_accuracy_monitor.py` carries **15** REFUSE/refused references;
`report_calibration.py` carries **0**. The matrix's prescribed means is exactly that asymmetry:
*"copy the sibling instrument's REFUSED state — `forecast_accuracy_monitor.py` already implements it."*

**Acceptance:** B7's scope statement says **in writing** that it grades the offshore input; a
successor row covers the served nearshore quantities; `report_calibration` **REFUSES** rather than
reporting a silent zero.

## 6. Also worth knowing

**Row 10 (schema validation of provider responses) was partially closed today.** Its evidence line
reads *"`_fetch_message_bytes` accepts a bare 200"* — which is precisely what `WS-CAN-0017` fixed this
session. The **NDBC header** half remains: the ground-truth parsers index fixed columns and discard a
header they could validate against.

## 7. The recommended path

1. **Row 1 — the instrument digest.** Generate the inventory of all 27 workflows, assign each a reader
   and a cadence, and make a digest **fail** when an instrument is red or empty. Backend/CI, so it is
   not gated by the frozen frontend. It attacks the program's dominant failure shape at the class
   level and is the single clearest step toward Finish Line B's terminal condition.
2. **Row 4 — make the gate declare its scope, and make `report_calibration` refuse.** Backend, small,
   and it closes a live gap between what the paging gate validates and what users are served.
3. **Row 10's NDBC half** — cheap, and it finishes what `WS-CAN-0017` started.

Rows 2 and 3 are HIGH and should be scheduled **the moment `WS-CAN-0039` unfreezes**, not before.

## 8. What this research does NOT claim

- I did not survey external best practice, because the primary source classifies the candidate
  technologies as Not Necessary and §33 forbids adopting them without a measured limitation. If you
  want that survey anyway, the honest framing is that it would be evaluating **Finish Line C**
  (advanced differentiation), which the program gates behind A and B.
- The four HIGH rows are the matrix's judgement, re-verified on two points (the 27-workflow inventory
  and the REFUSE asymmetry). I did not independently re-derive the other ten rows.
- "Not Necessary" is a judgement about *this* system at *this* scale — 107 req/h, 2,032 requests over
  19 h. It is not a claim that Zarr or WebGPU are wrong in general, and it should be revisited if the
  traffic or the data volume changes by an order of magnitude.
