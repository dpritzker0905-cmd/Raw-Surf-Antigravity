# 2026-10-28 (claude, side session of the lead): D6, the Surf Rating button reads OFF after a phone rotation while the band is ON

Branch `claude/d6-band-button` from dev c1ffa46be. Client only, ON. Kill: `window.__RAW_DISABLE_BAND_BUTTON_SYNC__ = true`.

## Ask

The lead's offline erratic fuzzer (fc033f5c1, at 4bd90d0d9): after a phone rotation, the now-visible desktop panel's Surf Rating
button read OFF while `window.__SURF_MODE__` was true and the band was painting (`min-bandui.json`).

## Cause

- MapPage mounts two `MapWeatherControls`: the desktop panel and the phone sheet.
- Each panel kept the band toggle in its own `useState(() => getSurfModeFlag())`, read once at mount and set only by its own click.
- The click already broadcasts `rawsurf:surf-toggle` (MapWebGL and the marine fetcher listen); the panels did not.
- Only `MapWeatherControls` writes the flag (`setSurfModeFlag`), so the event is the one change signal.

## Fix

- `useSurfModeFlagState()`: the panel's state re-reads the flag on `rawsurf:surf-toggle` and once at mount (a toggle between first
  render and the effect). The clicked panel's own setter still runs first, so the click paints at once.
- `MapWeatherControls`: one line (the line count stays at its 957 cap); `aria-pressed` follows the state.

## Tests

- New: `useSurfModeFlagState.test.js` (7). Both panels rendered as MapPage mounts them (desktop panel + expanded phone sheet),
  in light, dark and beach:
  - the band turned ON from the phone sheet reads ON (and `aria-pressed`) in the desktop panel, and OFF again from the desktop;
  - a panel mounted after the toggle reads the flag, and a toggle event with no click re-reads it;
  - the kill leaves the other panel stale (the positive control).
- Red first: dev's panel fails 4 of 7 (the 3 kill controls pass).
- Neighbouring suites (the panel, legend, theme chrome, readouts): 10 suites, 152 tests, all pass.

## Offline before/after (the fuzzer's REPLAY of `min-bandui.json`: phone, GFS Waves at Florida z5.2, band ON, rotate to 844 x 390)

Same store and CDN (`serve_synthetic_selector.py`, filled world sets published), the fuzzer at fc033f5c1 with its probe unchanged.

| arm | `inv4_band_button_disagrees_with_flag` |
|---|---|
| dev ea9608095 (main.953ceb74) | 3/3 |
| fix (main.90608c40) | 0/3 |

- `inv1_alpha0` appears in both arms (2/3 dev, 2/3 fix): the cold veil at boot (D3), not this change.
- Not replayed: a real device rotation (the fuzzer resizes the viewport; MapPage keeps both panels mounted either way).

