/**
 * Phase 3.1 — useSimulationField dedupes on content signature (which omits the
 * requested time offset). When two distinct hours have IDENTICAL grid content the
 * hook must still return a field whose temporal metadata (hourOffset/time) matches
 * the NEW requested hour — without re-running the expensive field build — so the
 * FCE dispatcher/diagnostics never read a stale hour.
 */
import { renderHook } from '@testing-library/react';

jest.mock('../engine/SimulationFieldBuilder');
jest.mock('../components/map/marineGridHash');
jest.mock('../engine/SimulationField');

import { useSimulationField } from '../engine/useSimulationField';
import { buildSimulationField } from '../engine/SimulationFieldBuilder';
import { computeGridContentHash } from '../components/map/marineGridHash';
import { getFieldDiagnostics, isFieldPopulated } from '../engine/SimulationField';

const marineData = {
  __renderable: true,
  __provider: 'open-meteo',
  grid: {
    vectors: [{}, {}, {}, {}],
    cols: 2,
    rows: 2,
    __sourceModel: 'GFS',
    __componentLayer: 'waves',
    __renderable: true,
    __provider: 'open-meteo',
    bounds: { west: -100, south: 20, east: -80, north: 40 },
  },
};

describe('useSimulationField — identical content at two offsets keeps correct time metadata', () => {
  beforeEach(() => {
    computeGridContentHash.mockReturnValue(42); // constant → identical content across hours
    getFieldDiagnostics.mockReturnValue({ populated: true });
    isFieldPopulated.mockReturnValue(true);
    buildSimulationField.mockImplementation(({ hourOffset }) => ({
      revision: 100,
      hourOffset,
      time: Date.now() + hourOffset * 3600000,
      grid: { vectors: [{}, {}, {}, {}], cols: 2, rows: 2 },
      cols: 2,
      rows: 2,
      sources: { marine: true },
    }));
  });

  afterEach(() => { delete window.isScrubbingTimeline; });

  it('refreshes hourOffset via a metadata-only revision (reuses grid, no rebuild)', () => {
    const { result, rerender } = renderHook(
      ({ to }) => useSimulationField({ marineData, activeMarineLayer: 'waves', timeOffsetHours: to }),
      { initialProps: { to: 0 } }
    );

    const first = result.current.field;
    expect(first.hourOffset).toBe(0);
    expect(buildSimulationField).toHaveBeenCalledTimes(1);

    // Same content, NEW requested hour.
    rerender({ to: 24 });
    const refreshed = result.current.field;

    expect(refreshed.hourOffset).toBe(24);               // metadata corrected to new hour
    expect(refreshed.revision).toBe(first.revision + 1); // metadata-only revision bump
    expect(refreshed.grid).toBe(first.grid);             // grid arrays REUSED (cheap, scrub-safe)
    expect(buildSimulationField).toHaveBeenCalledTimes(1); // NOT rebuilt
    expect(window.__SIM_BIND_REASON__.reason).toBe('metadata_only_time_refresh');
  });

  it('during active scrub corrects the hour in place WITHOUT a new revision/identity (scrub-safe)', () => {
    window.isScrubbingTimeline = true;
    const { result, rerender } = renderHook(
      ({ to }) => useSimulationField({ marineData, activeMarineLayer: 'waves', timeOffsetHours: to }),
      { initialProps: { to: 0 } }
    );

    const first = result.current.field;
    rerender({ to: 12 });
    const scrubbed = result.current.field;

    expect(scrubbed).toBe(first);                 // same object identity → no re-render churn
    expect(scrubbed.hourOffset).toBe(12);         // metadata still corrected in place
    expect(scrubbed.revision).toBe(first.revision); // no revision bump during scrub
    expect(buildSimulationField).toHaveBeenCalledTimes(1);
    expect(window.__SIM_BIND_REASON__.reason).toBe('metadata_time_refresh_scrub_inplace');
  });
});
