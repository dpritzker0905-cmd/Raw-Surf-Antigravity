/**
 * The render backstop's no-progress cap and two residents taking turns (2026-10-24; the follow-up recorded 2026-10-23).
 * The cap compared the engine grid's signature with the LAST one only, so a 13 x 13 /grid tile and a 17 x 13 series frame (the
 * 2026-10-23 reload-loop samples), or a stale 5 x 3 preview and the 13 x 9 viewport grid (the 2026-10-24 Lake Michigan replay),
 * changed it on every pass and the cap never engaged. marineSettleWatchdogs.clampMadeProgress: progress is a resident this clamp
 * episode (one view) has not held before.
 */
import fs from 'fs';
import path from 'path';
import { clampMadeProgress, evaluateClampCapProbe } from './marineSettleWatchdogs';

const A = 'regional_too_coarse|-82.0,24.0,-76.0,30.0';   // the /grid tile
const B = 'regional_too_coarse|-81.0,24.5,-77.0,29.5';   // the series frame
const EP = 'ICON|waves|0|-79.5,25.5,-77.5,26.5';

// The backstop's own counting, pass by pass (useMarineScrubSettle.js): no progress -> count up; progress -> the new last signature.
function passes(sigs, { episode = () => EP, win = null } = {}) {
  const state = { episode: null, seen: null }; let last = null; let noProgress = 0; const out = [];
  sigs.forEach((sig, i) => {
    if (!clampMadeProgress(state, { sig, lastSig: last, episode: episode(i) }, win)) noProgress++;
    else { last = sig; noProgress = 0; }
    out.push(noProgress);
  });
  return out;
}

describe('clampMadeProgress: a return to an earlier resident is no progress', () => {
  it('two residents taking turns: the cap engages on the 5th pass (it never did)', () => {
    const counts = passes([A, B, A, B, A, B]);
    expect(counts).toEqual([0, 0, 1, 2, 3, 4]);
    expect(evaluateClampCapProbe({ noProgress: counts[4], sinceLastProbeMs: 0 }).capped).toBe(true);
  });

  it('an unchanged resident is no progress (as before); each NEW resident is progress, so a sharpening view is never capped', () => {
    expect(passes([A, A, A, A])).toEqual([0, 1, 2, 3]);
    expect(passes(['s1', 's2', 's3', 's4', 's5'])).toEqual([0, 0, 0, 0, 0]);
  });

  it('a new episode (another view, hour, model or layer) starts clean', () => {
    expect(passes([A, B, A, B], { episode: (i) => (i < 2 ? EP : 'ICON|waves|3|-79.5,25.5,-77.5,26.5') })).toEqual([0, 0, 0, 0]);
  });

  it('the seen set is bounded (16), and an episode reset (the clamp clearing) forgets it', () => {
    const state = { episode: null, seen: null };
    for (let i = 0; i < 40; i++) clampMadeProgress(state, { sig: `s${i}`, lastSig: null, episode: EP });
    expect(state.seen.size).toBe(16);
    state.episode = null;
    expect(clampMadeProgress(state, { sig: 's39', lastSig: null, episode: EP })).toBe(true);
  });

  it('positive control: with window.__RAW_DISABLE_CLAMP_SEEN_SIGS__ the last signature only, so turns never cap (as before)', () => {
    expect(passes([A, B, A, B, A, B], { win: { __RAW_DISABLE_CLAMP_SEEN_SIGS__: true } })).toEqual([0, 0, 0, 0, 0, 0]);
    expect(passes([A, A, A], { win: { __RAW_DISABLE_CLAMP_SEEN_SIGS__: true } })).toEqual([0, 1, 2]);
  });

  it('wiring: the backstop asks it per pass with the view as the episode, and the clamp clearing resets the episode', () => {
    const src = fs.readFileSync(path.join(__dirname, 'useMarineScrubSettle.js'), 'utf8');
    expect(src).toMatch(/if \(!clampMadeProgress\(clampSeen, \{ sig, lastSig: clampSig, episode \}, typeof window !== 'undefined' \? window : null\)\) \{\s+clampNoProgress\+\+;/);
    expect(src).toMatch(/const episode = `\$\{activeModelRef\.current\}\|\$\{activeMarineLayerRef\.current \|\| 'waves'\}\|\$\{timeOffsetRef\.current\}\|`/);
    expect(src).toMatch(/if \(!needsRefetch\) \{ blankStreak = 0; clampNoProgress = 0; clampSig = null; clampSeen\.episode = null; return; \}/);
  });
});
