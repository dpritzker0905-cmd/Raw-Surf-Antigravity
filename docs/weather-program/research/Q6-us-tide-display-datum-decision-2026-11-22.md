# Q6 — Should US spots display tide heights above MLLW rather than local MSL? (2026-11-22)

Owner decision. This note gives a recommendation and the evidence. **Nothing served changes here.** Any switch is a separate PR.

## 1. Recommendation

**Move US points to MLLW (NOAA chart datum) as the primary displayed datum, with MSL shown as a secondary figure during a transition, behind an owner decision and a kill switch.** Keep MSL for non-US points and for all internal and model references (the eta cap and the model arithmetic stay MSL-referenced).

Rollout rule: the older "served numbers ship dark" rule is superseded. D-065 ships fixes ON with guardrails (kill switch, `SCOREBOARD.md` row, the history filter, and the live guardrail). A staged dark rollout is a valid choice, but it is **the owner's choice**, not a repo requirement. Present it to the owner as one option. Do not change the display until the owner says so.

**Rollout caution (from the longcat review, 2026-11-22):** the shift is large at some points (Boston 1.586 m), so a single switch-over is too blunt. Stage it: show both values with units on every US point during transition, and roll out by region or as owner opt-in before making MLLW the default. Each point needs a prominent datum label. The note does not yet know whether any user relies on the displayed number for navigation or safety, so confirm that before the default flips.

## 2. Measured datum gap at US gauges (CO-OPS `get_datums`, read-only, 2026-11-22)

| Station | MSL (m) | MLLW (m) | MSL − MLLW (m) |
|---|---|---|---|
| Boston 8443970 | 2.660 | 1.074 | **1.586** |
| San Francisco 9414290 | 2.773 | 1.822 | **0.951** |
| Los Angeles 9410660 | 2.028 | 1.167 | **0.861** |
| Galveston 8771450 | 1.588 | 1.336 | **0.252** |
| Honolulu 1612340 | 1.412 | 1.161 | **0.251** |

The shift is site-dependent: 0.25 m to 1.59 m, or about 0.8 ft to 5.2 ft. A switch moves every US number up by the local offset.

## 3. What the sources say

- **NOAA Tides & Currents:** MLLW is "the reference datum for predictions, bench mark publication and nautical charting". Its tide predictions are MLLW-referenced by default (the `coops` tool's default is also MLLW).
- **NWS SLOSH:** displays MSL by default, with the datum user-selectable. That is flood and surge context.
- **Surfline, Magicseaweed (now Surfline):** the datum of their tide charts was **not found** in searches. Do not claim either way.
- Our current served label, "heights above local mean sea level", is accurate but differs from what a NOAA tide table shows, so a US surfer comparing the two sees a systematic mismatch.

## 4. Stress-test

- **SubQ (`subq-savant-1.4`, high effort):** recommended MLLW as the primary datum for US points, with MSL secondary during transition. Listed the risks (site-dependent jump, negative values that look like errors, mixed-datum screens, non-US coverage, old screenshots) and the labelling.
- **Reflection (`Beam-1.0`):** argued the strongest case against our earlier "keep MSL, propose separately" position. The mismatch against NOAA tables is a known user-facing inconsistency, and leaving it open creates two standards with unclear ownership. It would overturn a switch only with: user research showing no confusion or a preference for MSL, official guidance that surf forecasts should show MSL, conversion uncertainty as large as the offset, or evidence that MLLW does not reduce errors.

Both reviewers arrived at MLLW for US points. The earlier draft (keep MSL, propose separately) is withdrawn in favour of this recommendation.

## 5. How a switch would be labelled

- Primary: **"Tide height above MLLW (NOAA chart datum)"**.
- Tooltip: **"0 = mean lower low water. Negative values mean the tide is below that datum."**
- Transition secondary line: **"≈ X ft above local mean sea level"**.
- One-time notice on switch: the number will rise, by an amount that depends on the site.
- Never describe it as water depth unless the break bathymetry uses the same datum.
- Keep the label, the datum and the number consistent on every surface (spot hub, infobox, sim, alerts), per the one-composition rule.

## 6. Constraints the implementation must meet

- **EPOCH (advisor, 2026-11-22).** CO-OPS MSL and MLLW are on the **1983–2001 National Tidal Datum Epoch**. Our "local MSL" carries the **2016–2025 altimetry mean**. Adding the CO-OPS (MSL − MLLW) offset to our level therefore reads high by the sea-level rise since the epoch, about **5–15 cm, more on the Gulf**, unless corrected. The build must either apply an explicit epoch correction or state the mismatch in its label and its SCOREBOARD row. The offsets in §2 are epoch-1983–2001 values, not current ones.
- **NON-GAUGE POINTS (advisor, 2026-11-22).** Most spots are not at a gauge. MLLW at those points needs either a VDatum-style interpolation between gauges or our own 19-year constituent computation (the NTDE is 1983–2001). The build must **name the source for each point** (gauge table, interpolation, or constituent computation) and show it on the point's datum label.
- Per-spot MLLW offsets must come from station datum tables (or the offline constituents), labelled with their source. Non-US points keep MSL or LAT.
- Negative heights are valid and need copy that does not read as an error.
- Light, dark and beach themes, desktop and mobile, and ARIA labels on any control, per the repo rules.
- Kill switch: a runtime flag, registered in `_RATING_FLAGS`, default off until the owner turns it on.

## 7. What would change this recommendation

- User research or logs showing surfers mainly compare against MSL sources or misread the shifted number.
- Most users or points outside the US.
- The app's main use being storm surge or flood, which MSL serves better.
- Break bathymetry referenced to MSL, which would make a MLLW "depth" misleading.
- Evidence that Surfline and Magicseaweed use MSL and users follow them.

## 8. Open items

- Find Surfline's or Magicseaweed's tide datum from their own help pages (not reached by search).
- Confirm the app's current displayed datum, and whether any user relies on the number for navigation or safety (longcat review: missing context).
- Measure whether users compare the displayed value over time (longcat review: missing context).
- Confirm that the served A+M table can produce a per-spot MLLW offset.
- Owner decision: switch, keep MSL, or hybrid.

Sources: NOAA CO-OPS `get_datums` (stations above, read-only, 2026-11-22). NOAA Tidal Datums page (`tidesandcurrents.noaa.gov/datum_options.html`) and NOAA nautical-charts tutorial. NWS SLOSH datums page (`slosh.nws.noaa.gov/etss/datums.php`). SubQ and Reflection synthesis, 2026-11-22.
