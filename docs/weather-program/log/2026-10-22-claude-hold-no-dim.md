# 2026-10-22 (claude, GPU-frames session): hold the heatmap without dimming

Written 2026-10-22T09:54Z. Branch `claude/hold-no-dim` from dev `eb3e4bcfb`. Evidence: `evidence/hold-no-dim-2026-10-22.json`.

## Ask
The owner, via the lead, 2026-10-22: "hold the heatmap without dimming". Hold the previous frame at full opacity until the new one
is drawn. The status line stays honest (it says loading, and which hour is drawn). For long loads (over 2-3 s), show a subtle
non-dimming indicator. Client only, ON, with a kill switch.

## What dims the heatmap today (mapped)
- **Stale-hour dim** (`marineStaleHour.resolveStaleWorldDim`, 0.4): a WORLD frame 3.5 h or more from the selected hour, once the
  hour has held 600 ms. **This is the loading dim. It is now a hold.**
- **Left on purpose:**
  - coarse fade (0.7 floor when only a 10° grid covers a close zoom: a resolution cue);
  - no-truth guard (0.3 at z8+ before the coast mask covers the view: it stops the wash painting land);
  - cold-activation veil (hides a coarse grid at a coastal zoom for up to 4 s: there is no previous frame to hold);
  - rating-band cross-fade;
  - the regional/coarse-bridge fades at far zoom (they hide a sub-viewport rectangle).
- **Lab baseline at normal speed** (`lab3_before`, current build): 0 dimmed frames in every flow. The dim only fires when a load
  outlasts the 600 ms hold.

## Change
- `resolveStaleWorldDim` returns mult 1, `held: true` for that frame. The judgment and the resident swap are unchanged.
- `ForecastTimeStatus` already reads "Loading <selected>… still showing <drawn>" (role=status, aria-live polite).
  - It now sets `aria-busy` while pending.
  - After `HOLD_INDICATOR_MS` (2500 ms) it adds a small pulsing dot: aria-hidden, `motion-reduce:animate-none`, `bg-current`, so
    the line's own theme tone is used. The status line renders once, under the timeline, in the desktop panel and both mobile
    layouts.
- Kill: `window.__RAW_DISABLE_HOLD_NO_DIM__ = true`. The 0.4 dim comes back exactly, with no dot.

## Measured (lab A/B)
Setup: frame store killed, backend slowed (series 4 s, /grid 1.5 s) so loads outlast the hold. Flows: icon_waves_scrub, erratic,
layer_switch_future, model_switch_future. One round each.

| | Before (hold killed) | After (default) |
|---|---|---|
| stale-hour dim | 1,035 ms at 0.4 (erratic +153h) | 0 ms |
| held at full strength | 0 ms | 34 ms |
| indicator | n/a | 10 steps, 12.4 s |
| silent mislabel frames (#267) | 35 | 32 |
| admitted frames | 3,427 | 3,176 |

- The before arm caught ONE dim event (n=1, recorded, not generalised).
- No silent mislabel frames were added: the drawn frame is always admitted by the status line.

## Gates
- Stale-hour + status suites 141/141; 2 mutants caught (no hold, immediate dot).
- Jest map + tests 361/361 suites (5325 tests). ESLint ratchet exit 0. LOC ratchet 0 regressed.
