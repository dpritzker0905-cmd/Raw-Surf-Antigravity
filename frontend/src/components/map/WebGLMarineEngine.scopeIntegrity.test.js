import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverseMod from '@babel/traverse';

const traverse = traverseMod.default || traverseMod;

// SCOPE-INTEGRITY GUARD (2026-07-31, the `_washOpacityEff is not defined` ReferenceError).
//
// WHY A STRUCTURAL TEST AND NOT A BEHAVIOURAL ONE: renderHeatmapAndParticles is a ~1900-line
// single function driving five GL passes. No unit test in this repo executes it (the one file that
// greps as if it does — nullEncodeGuard.test.js — only exercises a pure helper), so an identifier
// that resolves to NOTHING is invisible to the 790-test marine suite. It is also invisible in
// production: WebGLMarineCustomLayer wraps engine.render() in a try/catch that swallows the throw,
// and `errorCount` there is a closure variable that is NEVER reset — at 3 accumulated frames it
// fires onErrorRef and disables the GPU marine layer for the rest of the session. So the failure
// mode of a typo in this file is not a red test or a stack trace; it is the marine heatmap quietly
// switching itself off. This guard is the only thing standing between the two.
//
// THE ORIGINAL DEFECT: 626c905f (07-14) declared `let _washOpacityEff` INSIDE the
// `if (blendEngaged) { ... }` wash block. 4da586aa (07-19) added the TINY-TILE VIVIDNESS PARITY
// reader ~370 lines further down, reaching for that name after the block had closed. The reader's
// own gate is `blendEngaged` — the SAME condition that fills the value in — so the line was never
// dead: it threw on the first frame a regional tile covered <45% of the viewport area.
//
// NOTE this is not merely "run ESLint in a test": no workflow in .github/workflows runs ESLint at
// all, which is why a no-undef in a hot render path survived 12 days. Until lint gates CI, this
// test is the enforcement point.

const ENGINE = path.join(__dirname, 'WebGLMarineEngine.js');

// Identifiers that legitimately resolve to a runtime global rather than a lexical binding.
const ALLOWED_GLOBALS = new Set([
  'window', 'document', 'globalThis', 'self', 'console', 'performance', 'navigator',
  'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean', 'Object', 'Array', 'Set', 'Map',
  'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array',
  'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'ArrayBuffer', 'DataView',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Image', 'ImageData', 'HTMLCanvasElement', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'TextDecoder', 'TextEncoder', 'URL', 'Blob', 'fetch', 'process', 'require', 'module', 'exports',
  '__dirname', '__filename', 'undefined', 'NaN', 'Infinity',
]);

function parseEngine() {
  const src = fs.readFileSync(ENGINE, 'utf8');
  return { src, ast: parse(src, { sourceType: 'module', plugins: ['jsx', 'classProperties'] }) };
}

function collectUnresolved(ast) {
  const unresolved = [];
  traverse(ast, {
    ReferencedIdentifier(p) {
      const { name } = p.node;
      if (ALLOWED_GLOBALS.has(name)) return;
      if (p.scope.hasBinding(name, /* noGlobals */ true)) return;
      unresolved.push({ name, line: p.node.loc.start.line });
    },
  });
  return unresolved;
}

describe('WebGLMarineEngine — scope integrity (latent ReferenceError guard)', () => {
  it('every referenced identifier resolves to a binding or a known global', () => {
    const { ast } = parseEngine();
    const unresolved = collectUnresolved(ast);
    const detail = unresolved.map((u) => `  ${u.name} @ line ${u.line}`).join('\n');
    expect(unresolved.length === 0 ? '' : `unresolved identifiers:\n${detail}`).toBe('');
  });

  // NEGATIVE CONTROL — a green guard is not evidence (memory: the #14 post-step guard is pinned by
  // a negative control). Re-narrowing the declaration back into the wash block must make the guard
  // FAIL, or the guard is not actually watching this defect. We reproduce the exact 07-19 shape by
  // converting the function-scoped declaration back to a block-scoped one.
  it('DETECTS the original defect when the declaration is re-narrowed into the wash block', () => {
    const { src } = parseEngine();

    // LINE-ENDING AGNOSTIC ON PURPOSE: this file is committed CRLF, and the first draft of this
    // mutation anchored its removal on '...;\n'. That never matched, so the function-scoped
    // declaration survived, the reader still resolved, and the control reported "no defect
    // detected" — the instrument was broken, not the code. Match \r?\n, and assert EACH
    // replacement independently rather than trusting a single `!== src`.
    const dropDecl = /[^\S\r\n]*let _washOpacityEff = 0;\r?\n/;
    const narrow = '_washOpacityEff = baseWashOpacity;';
    expect(src).toMatch(dropDecl);
    expect(src).toContain(narrow);

    const withoutDecl = src.replace(dropDecl, '');
    expect(withoutDecl).not.toMatch(dropDecl);          // removal actually applied

    const reintroduced = withoutDecl.replace(narrow, `let ${narrow}`);
    expect(reintroduced).toContain(`let ${narrow}`);    // re-narrowing actually applied
    expect(reintroduced).not.toBe(withoutDecl);

    const mutAst = parse(reintroduced, { sourceType: 'module', plugins: ['jsx', 'classProperties'] });
    const unresolved = collectUnresolved(mutAst);
    expect(unresolved.map((u) => u.name)).toContain('_washOpacityEff');
  });

  it('the tiny-tile peer reader binds to the SAME declaration the wash block assigns', () => {
    const { ast } = parseEngine();
    let declScopeUid = null;
    let readerScopeUid = null;
    let readerLine = null;

    traverse(ast, {
      // The assignment inside `if (blendEngaged)` — the drawn wash opacity.
      AssignmentExpression(p) {
        if (p.node.left.type === 'Identifier' && p.node.left.name === '_washOpacityEff'
            && p.node.right.type === 'Identifier' && p.node.right.name === 'baseWashOpacity') {
          const b = p.scope.getBinding('_washOpacityEff');
          if (b) declScopeUid = b.scope.uid;
        }
      },
      // The TINY-TILE VIVIDNESS PARITY reader.
      Identifier(p) {
        if (p.node.name !== '_washOpacityEff' || !p.isReferencedIdentifier()) return;
        if (!p.parentPath.isLogicalExpression({ operator: '||' })) return;
        const b = p.scope.getBinding('_washOpacityEff');
        if (b) { readerScopeUid = b.scope.uid; readerLine = p.node.loc.start.line; }
      },
    });

    expect(declScopeUid).not.toBeNull();
    expect(readerScopeUid).not.toBeNull();
    // Same binding ⇒ the tile fades toward the DAMPED, actually-drawn wash opacity
    // (__RAW_GPU__.washEff), not the pre-damp baseWashOpacity. Peer parity must be measured
    // against what is on screen.
    expect({ reader: readerScopeUid, line: readerLine })
      .toEqual({ reader: declScopeUid, line: readerLine });
  });
});
