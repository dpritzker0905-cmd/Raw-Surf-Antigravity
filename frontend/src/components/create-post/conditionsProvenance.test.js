// Check-in truth program P0 (2026-11-16): an edit after a forecast prefill is 'edited', never 'manual'.
import fs from 'fs';
import path from 'path';
import { sourceAfterEdit, withEditMark } from './conditionsProvenance';

describe('conditions provenance in the composer', () => {
  test('an edit after any prefill is edited', () => {
    expect(sourceAfterEdit('auto')).toBe('edited');
    expect(sourceAfterEdit('auto_current')).toBe('edited');
    expect(sourceAfterEdit('edited')).toBe('edited');
  });

  test('an edit with no prefill keeps its claim (the server stores it as unverified)', () => {
    expect(sourceAfterEdit('manual')).toBe('manual');
    expect(sourceAfterEdit('unavailable')).toBe('unavailable');
  });

  test('withEditMark sets the field, then marks the edit', () => {
    let field = null;
    let source = 'auto_current';
    const setSource = (fnOrValue) => { source = typeof fnOrValue === 'function' ? fnOrValue(source) : fnOrValue; };
    withEditMark((v) => { field = v; }, setSource)('4');
    expect(field).toBe('4');
    expect(source).toBe('edited');
  });

  // The mutant guard: the old handlers wrote setConditionsSource('manual') on ANY edit, laundering a prefill into a
  // surfer's own observation. No field handler in either composer may write a literal 'manual' again.
  test.each(['../CreatePostModal.js', '../CreatePost.js'])('%s has no edit handler that writes manual', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const handlers = src.split('\n').filter((l) => /on(Value)?Change=/.test(l) && /setConditionsSource\('manual'\)/.test(l));
    expect(handlers).toEqual([]);
  });

  test('the guard catches the old handler line', () => {
    const old = "onChange={(e) => { setWaveHeightFt(e.target.value); setConditionsSource('manual'); }}";
    expect(/on(Value)?Change=/.test(old) && /setConditionsSource\('manual'\)/.test(old)).toBe(true);
  });
});
