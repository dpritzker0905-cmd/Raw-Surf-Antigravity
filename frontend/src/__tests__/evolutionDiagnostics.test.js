/**
 * Phase 1.4 — getEvolutionDiagnostics must report the TRUE evolution mode, not
 * mere field existence. In normal forecast-authoritative map mode evolveField()
 * never runs, so the HUD must say "disabled_forecast_authoritative", not "Active".
 */
import { getEvolutionDiagnostics } from '../engine/FieldEvolutionEngine';

function makeField(cols = 2, rows = 2) {
  const size = cols * rows;
  return {
    cols, rows,
    grid: {
      windU: new Float32Array(size).fill(1),
      windV: new Float32Array(size).fill(1),
      waveHeight: new Float32Array(size).fill(2),
    },
  };
}

describe('getEvolutionDiagnostics — truthful evolution mode', () => {
  afterEach(() => { delete window.__IN_SIMULATION_SANDBOX__; });

  it('returns no_field for a null field', () => {
    expect(getEvolutionDiagnostics(null)).toEqual({ evolved: false, mode: 'no_field' });
  });

  it('reports disabled_forecast_authoritative + evolved:false in normal map mode', () => {
    delete window.__IN_SIMULATION_SANDBOX__;
    const d = getEvolutionDiagnostics(makeField(), { evolutionTicks: 999 });
    expect(d.mode).toBe('disabled_forecast_authoritative');
    expect(d.evolved).toBe(false); // even with tick count, evolution did not run
  });

  it('reports sandbox_active + evolved:true once evolution ticks have run in the sandbox', () => {
    window.__IN_SIMULATION_SANDBOX__ = true;
    const d = getEvolutionDiagnostics(makeField(), { evolutionTicks: 5 });
    expect(d.mode).toBe('sandbox_active');
    expect(d.evolved).toBe(true);
  });

  it('reports evolved:false in the sandbox before any evolution tick', () => {
    window.__IN_SIMULATION_SANDBOX__ = true;
    const d = getEvolutionDiagnostics(makeField(), { evolutionTicks: 0 });
    expect(d.mode).toBe('sandbox_active');
    expect(d.evolved).toBe(false);
  });
});
