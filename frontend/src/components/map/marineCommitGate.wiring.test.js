import fs from 'fs';
import path from 'path';
import * as gate from './marineCommitGate';
import * as engine from './WebGLMarineEngine';

// COMMIT-GATE SEAM GUARD (2026-08-01, the extraction that took WebGLMarineEngine.js 3336 -> 3179).
//
// The zoom-out bridge, the sub-covering reject and `decideMarineCommit` moved to
// ./marineCommitGate. Two things about that seam are load-bearing and NOT covered by the six
// suites that already test the predicates themselves — because those suites would stay green
// through either failure:
//
//  1. THE RE-EXPORT. Every existing consumer does `import { decideMarineCommit } from
//     './WebGLMarineEngine'`. Dropping the `export ... from './marineCommitGate'` line breaks them
//     all at once, and identity (not just presence) is what proves the engine forwards the real
//     function instead of a stale copy someone left behind.
//
//  2. `_arbiterGraceState` IDENTITY. It is module-level MUTABLE state with TWO readers: the live
//     `decideMarineCommit` in the gate, and the Phase B shadow `arbiterDecide` call still sitting in
//     the engine's setWaveData choke, which passes this very object so the shadow "can't diverge on
//     it". The first cut of the extraction left that engine reader unbound and the scope-integrity
//     guard caught it. But the NEXT plausible edit — someone "tidying" the cross-module import into
//     a local `const _arbiterGraceState = {...}` in the engine — parses clean, resolves clean, and
//     passes every existing test, while the shadow silently reports the rating-grace rule as a
//     permanent divergence. No unit test executes setWaveData's ~1900-line render/commit path, so
//     the wiring has to be asserted in SOURCE. Same reasoning as WebGLMarineEngine.scopeIntegrity.
//
// ★ Each source assertion carries a negative control: a regex that matches nothing is
//   indistinguishable from a codebase that is clean (memory: "0 findings and 0 parsed are
//   indistinguishable in a summary line").

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');

describe('marineCommitGate — the extraction seam', () => {
  it('re-exports the moved surface from WebGLMarineEngine by IDENTITY, not by copy', () => {
    for (const name of ['decideMarineCommit', 'shouldBridgeToCoarseGlobal',
      'shouldRejectSubcoveringRegional', '__resetArbiterGraceForTests']) {
      expect(typeof engine[name]).toBe('function');
      expect(engine[name]).toBe(gate[name]);
    }
  });

  it('still re-exports shouldRejectResolutionDowngrade, whose local import the move retired', () => {
    // The engine no longer CALLS it, so it is re-export-only. That asymmetry is easy to "clean up"
    // into a deletion, which would break marineCommitArbiter.differential.test.js.
    expect(typeof engine.shouldRejectResolutionDowngrade).toBe('function');
  });

  it('shares ONE _arbiterGraceState — the engine reset must clear the gate object', () => {
    gate._arbiterGraceState.key = 'dirty';
    gate._arbiterGraceState.startedAt = 12345;
    gate._arbiterGraceState.expired = true;

    engine.__resetArbiterGraceForTests();

    expect(gate._arbiterGraceState.key).toBeNull();
    expect(gate._arbiterGraceState.startedAt).toBe(0);
    expect(gate._arbiterGraceState.expired).toBe(false);
  });

  it('WIRING: the engine imports _arbiterGraceState from the gate and declares no local copy', () => {
    const importsIt = /import\s*\{[^}]*\b_arbiterGraceState\b[^}]*\}\s*from\s*'\.\/marineCommitGate'/s;
    expect(ENGINE_SRC).toMatch(importsIt);

    // A local declaration would shadow the import and split the state in two.
    const declaresItsOwn = /^\s*(?:const|let|var)\s+_arbiterGraceState\b/m;
    expect(ENGINE_SRC).not.toMatch(declaresItsOwn);

    // NEGATIVE CONTROLS — both regexes must be capable of firing, or this test proves nothing.
    expect("import { a, _arbiterGraceState } from './marineCommitGate';").toMatch(importsIt);
    expect('  const _arbiterGraceState = { key: null };').toMatch(declaresItsOwn);
  });

  it('WIRING: the shadow reader that forced the export is still there', () => {
    // If this line ever goes away, `_arbiterGraceState` no longer needs to be exported at all and
    // this whole guard can be deleted with it. Until then, the cross-module share is required.
    expect(ENGINE_SRC).toMatch(/graceState:\s*_arbiterGraceState/);
  });
});
