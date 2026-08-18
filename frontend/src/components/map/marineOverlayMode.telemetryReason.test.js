import { overlayTelemetryReason } from './marineOverlayMode';

/**
 * The overlay telemetry `reason` — precedence, and the bug it had (2026-08-17).
 *
 * THE BUG. The inline expression tested `_overlayReplace` BEFORE `overlayOn`, so an overlay that was
 * NOT APPLIED still reported a mode name. Observed live at Madeira during the island-halo work:
 * `{on:false, replace:true, reason:'coverage_gap', bounds:null}` — a string that reads "active in
 * coverage-gap mode" while nothing was applied. It misled this session's diagnosis in BOTH
 * directions, and "is viewport truth reaching this coast?" is precisely the question the halo
 * investigation turns on: LOP-0002 proved that when the overlay does not run, the field's coastline
 * falls back to generalized land geometry and produces the band.
 *
 * ★ `on` is the ground truth. A reason may DESCRIBE that state, never contradict it.
 */
describe('overlayTelemetryReason', () => {
  const base = { overlayOn: true, overlayReplace: false, nonCoveringDrop: false, degradedDrop: false,
    midCarveReplace: false, overlayReplaceWide: false, gwSpan: 2.4, baseGlobalDense: false };

  describe('THE REGRESSION — a reason must never claim a mode while the overlay is off', () => {
    it('reports off when not applied, even though replace is true (the live Madeira state)', () => {
      expect(overlayTelemetryReason({ ...base, overlayOn: false, overlayReplace: true })).toBe('off');
    });

    it('reports off when not applied, whatever replace flavour is set', () => {
      for (const extra of [
        { overlayReplaceWide: true },
        { midCarveReplace: true },
        { gwSpan: 400 },                       // would have said 'world_grid'
        { midCarveReplace: true, gwSpan: 400 },
      ]) {
        expect(overlayTelemetryReason({ ...base, ...extra, overlayOn: false, overlayReplace: true })).toBe('off');
      }
    });

    it('never returns an applied-mode label for an unapplied overlay', () => {
      const applied = ['midcarve_replace', 'world_grid', 'coverage_gap', 'min_combine', 'dense_base_min_combine'];
      for (const replace of [true, false]) {
        for (const dense of [true, false]) {
          const r = overlayTelemetryReason({ ...base, overlayOn: false, overlayReplace: replace, baseGlobalDense: dense });
          expect(applied).not.toContain(r);
        }
      }
    });
  });

  describe('drop reasons outrank everything — they explain WHY it is off', () => {
    it('noncovering_drop wins over every other state', () => {
      expect(overlayTelemetryReason({ ...base, nonCoveringDrop: true, overlayOn: false })).toBe('noncovering_drop');
      expect(overlayTelemetryReason({ ...base, nonCoveringDrop: true, degradedDrop: true })).toBe('noncovering_drop');
    });
    it('degradedDrop wins over the mode labels', () => {
      expect(overlayTelemetryReason({ ...base, degradedDrop: true, overlayReplace: true })).toBe('degraded_drop');
    });
  });

  describe('every applied-mode label is preserved verbatim', () => {
    it('midcarve_replace: the carve replacing, and not the wide path', () => {
      expect(overlayTelemetryReason({ ...base, overlayReplace: true, midCarveReplace: true, overlayReplaceWide: false }))
        .toBe('midcarve_replace');
    });
    it('world_grid at a world-sized base span, coverage_gap below it', () => {
      expect(overlayTelemetryReason({ ...base, overlayReplace: true, overlayReplaceWide: true, gwSpan: 340 })).toBe('world_grid');
      expect(overlayTelemetryReason({ ...base, overlayReplace: true, overlayReplaceWide: true, gwSpan: 339.9 })).toBe('coverage_gap');
    });
    it('the wide path outranks the carve when both are set', () => {
      expect(overlayTelemetryReason({ ...base, overlayReplace: true, midCarveReplace: true, overlayReplaceWide: true, gwSpan: 2.4 }))
        .toBe('coverage_gap');
    });
    it('min_combine, and dense_base_min_combine when the base is globally dense', () => {
      expect(overlayTelemetryReason({ ...base })).toBe('min_combine');
      expect(overlayTelemetryReason({ ...base, baseGlobalDense: true })).toBe('dense_base_min_combine');
    });
  });

  it('fails safe on no argument rather than throwing (telemetry must not break a render)', () => {
    expect(overlayTelemetryReason()).toBe('off');
    expect(overlayTelemetryReason({})).toBe('off');
  });
});
