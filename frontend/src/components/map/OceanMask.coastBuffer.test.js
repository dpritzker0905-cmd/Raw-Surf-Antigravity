/**
 * INV-buffer-opt-in — enforcement for LAYER_ORDER_PROOF_LOG.json#LOP-0001.
 *
 * ⛔ `ocean-mask-buffer` IS the marine coastal halo (attributed live 2026-08-16 on the authenticated
 * dev alias, owner-confirmed). It must be OPT-IN ONLY. If someone ever restores
 * "on whenever a marine layer is active", the halo comes straight back at z1-z9.5 on every coast.
 *
 * This suite is the reason that cannot happen silently. It also asserts the proof log itself stays
 * well-formed and keeps enforcing its own entries, so the log cannot rot into decoration.
 */
import fs from 'fs';
import path from 'path';
import { resolveCoastBufferOn } from './waterTempAnchor';

const LOG_PATH = path.join(__dirname, '..', '..', '..', '..',
  'program', 'weather-simulation', 'LAYER_ORDER_PROOF_LOG.json');

describe('INV-buffer-opt-in (LOP-0001): ocean-mask-buffer is opt-in only', () => {
  // The exact regression that produced the halo: enablement keyed off the active marine layer.
  const MARINE_LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves', 'water_temp', null, undefined, ''];

  it('is OFF for every marine layer when the opt-in flag is absent', () => {
    for (const layer of MARINE_LAYERS) {
      expect(resolveCoastBufferOn(layer, undefined)).toBe(false);
      expect(resolveCoastBufferOn(layer, false)).toBe(false);
    }
  });

  it('is ON only for the explicit boolean true opt-in', () => {
    for (const layer of MARINE_LAYERS) {
      expect(resolveCoastBufferOn(layer, true)).toBe(true);
    }
  });

  it('does not accept truthy-but-not-true values (a stray string must not re-enable the halo)', () => {
    for (const truthy of ['true', 1, {}, [], 'yes']) {
      expect(resolveCoastBufferOn('waves', truthy)).toBe(false);
    }
  });

  it('NON-VACUITY: the result is independent of the active marine layer', () => {
    // If this ever fails, someone has re-coupled enablement to the session type - the exact defect.
    for (const flag of [undefined, false, true]) {
      const results = MARINE_LAYERS.map((l) => resolveCoastBufferOn(l, flag));
      expect(new Set(results).size).toBe(1);
    }
  });

  it('the call site in OceanMask.js delegates and does not re-derive enablement', () => {
    const src = fs.readFileSync(path.join(__dirname, 'OceanMask.js'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('const bufferOn'));
    expect(line).toBeDefined();
    expect(line).toContain('resolveCoastBufferOn');
    // The regression shape: `bufferOn` computed from activeMarineLayer at the call site.
    expect(/const bufferOn\s*=\s*!!.*activeMarineLayer/.test(line)).toBe(false);
  });
});

describe('LAYER_ORDER_PROOF_LOG.json stays a proof log, not decoration', () => {
  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));

  it('is well-formed and append-only in shape', () => {
    expect(log.schema_version).toBe(1);
    expect(Array.isArray(log.entries)).toBe(true);
    expect(log.entries.length).toBeGreaterThan(0);
    const ids = log.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every PROVEN entry names an invariant AND a test file that actually exists', () => {
    for (const e of log.entries.filter((x) => x.status === 'PROVEN' && !x.refuted_by)) {
      expect(e.invariant && e.invariant.statement).toBeTruthy();
      expect(e.enforced_by).toBeTruthy();
      const enforcer = path.join(__dirname, '..', '..', '..', '..', e.enforced_by);
      expect(fs.existsSync(enforcer)).toBe(true);
    }
  });

  it('every PROVEN entry carries a paired experiment with a non-vacuity control', () => {
    for (const e of log.entries.filter((x) => x.status === 'PROVEN' && !x.refuted_by)) {
      const legs = (e.experiment && e.experiment.legs) || [];
      // At least one leg showing the symptom PRESENT and one showing it ABSENT - a one-way
      // observation is not proof, which is the rule this assertion exists to hold.
      expect(legs.some((l) => /PRESENT|SEVERE/i.test(l.halo))).toBe(true);
      expect(legs.some((l) => /ABSENT/i.test(l.halo))).toBe(true);
      expect((e.evidence || []).length).toBeGreaterThan(0);
    }
  });

  it('every zoom-interpolated correction ships a multi-stop zoom ladder', () => {
    for (const e of log.entries.filter((x) => x.status === 'PROVEN' && !x.refuted_by)) {
      const ladder = (e.experiment && e.experiment.zoom_ladder) || [];
      expect(ladder.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('LOP-0001 is present and still records that REORDERING was rejected', () => {
    const e = log.entries.find((x) => x.id === 'LOP-0001');
    expect(e).toBeDefined();
    expect(e.painter.layer_id).toBe('ocean-mask-buffer');
    expect(e.refuted_by).toBeNull();
    const reordering = (e.rejected_hypotheses || []).find((h) => /order/i.test(h.hypothesis));
    expect(reordering).toBeDefined();
  });
});
