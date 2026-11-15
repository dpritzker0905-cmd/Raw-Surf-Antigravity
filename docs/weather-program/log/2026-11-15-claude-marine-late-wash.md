# 2026-11-15: the marine picture corrects itself ~2.5 s after a multi-hour jump (claude, rating band lane, second finding)

Assigned by the director (local_d6b521eb) from the hour-blend lane's log (`fable/crest-hour-blend` 8029f7d3f, section 23.3): with the
hour blend KILLED, after a 6-hour jump at a coastal zoom on a regional 24 x 21 grid, the picture differs from the SAME hour at rest
by 4.08-4.11 luminance units (0-255) at 250 ms and 900 ms, and by 0.000 at 2.5 s and 5 s; the held picture's contrast is 4-10 %
low. Same grid, same valid time, no blend: something else the colour pass draws lags. Coordinated with Move 3 (local_05078d22,
which owns the 1.5 s coarse-to-fine upgrade delay): this lane does not touch `useMarineExactUpgrade` or `EXACT_UPGRADE_DELAY_MS`.

## 0. PRE-REGISTRATION (2026-11-15 ~17:05 EST, before any measurement of this finding)

Hypothesis H1 (from reading the code, not yet measured): the coarse WASH under and around a regional grid is refused for the new
hour (`marineStaleHour.washMatchesResident`: base valid time != resident valid time, so it is not drawn). For as long as the
selected hour's world grid takes to arrive (`askWashOnRefusal` -> `prewarmGlobalMarineGrid`), the sea around the regional grid has
no wash; when that grid lands, the picture becomes the at-rest picture exactly.

- **Instrument** (offline only: the synthetic store with regional tiles; new scenario `scn_hour_jump_wash.js`): at a coastal
  regional view, a +6 h step with the timeline wheel's keyboard. Canvas screenshots at 250, 900, 2500 and 5000 ms after the step,
  and of the same hour at rest (re-visited after 10 s). Measure: mean absolute luminance difference (Rec. 709, 0-255), step vs
  rest. At each sample, record the wash decision (`window.__MARINE_WASH_TIME__.last`) and the engine's coarse-base valid time
  against the resident's.
- **Cause gate**: H1 is CONFIRMED only if all three hold:
  - (a) the default arm reproduces a difference >= 1.0 luminance unit at 250 or 900 ms that falls under 0.1 by 5 s;
  - (b) the samples carrying that difference show the wash refused (`other_time`), and the samples at <= 0.1 show it drawn
    (`same`);
  - (c) a NULL control (a +0 h re-visit of the same hour) shows no difference.
  Otherwise H1 is REFUTED and the cause stays open.
- **Fix gate** (only if H1 is confirmed): a fix arm must cut the 250/900 ms difference by >= 75 % against its own kill arm in every
  view measured, never draw a wash of another hour (`other_time` drawn = 0), add no backend asks against the kill arm, and keep the
  at-rest picture identical (difference <= 0.05).
- **Scope**: reported per layer (waves, swell_1) and per zoom (a regional coastal view and a world view), dark theme, desktop.
