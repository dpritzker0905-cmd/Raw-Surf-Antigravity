/**
 * ENCODING DEBRIS GUARD: no user-visible string may carry the ASCII remains of a lost glyph.
 *
 * da30f15d (2026-05-18, "fix 16K corrupted emoji bytes") deleted every non-ASCII byte from 306
 * files. Where a line held a real emoji the glyph vanished ("Request a " -- #204). Where it held
 * cp437/cp1252 MOJIBAKE of an emoji, only the non-ASCII half vanished and the ASCII half stayed:
 * box-drawing runs became "+-+-+" / "++-+G+-", U+2261 had already become "=", U+0393 "G", and an
 * earlier pass had turned other glyphs into "?". Census of that commit's frontend diff: 361
 * mojibake-origin code lines, 281 still present on dev at 0d8e587a, plus ~50 older "?" sites.
 * They reached users as toasts ("Photographer accepted! ++-+G+-++-+G-+G+G+-+"), separators
 * ("role G email"), icon slots ("="), and data: a reaction of '=' that the backend rejects, note
 * pickers that inserted "=", "$50/hr + 2 hrs" where the glyph had been a times sign.
 *
 * This walks every string literal, template chunk, JSX text node and JSX attribute string in
 * frontend/src (comments are not visited: they never render) and fails on the debris shapes.
 * Positive and negative controls run first, so a detector that stopped firing, or started firing
 * on legitimate code, fails loudly instead of passing vacuously.
 *
 * Fixing a hit: remove the debris; where the glyph carried meaning use a word, an HTML entity in
 * JSX (&middot; &times; &rarr;), or a lucide-react icon with aria-hidden plus a text equivalent.
 * Never paste a raw emoji (the v99 rule: raw multi-byte glyphs are what corrupted in the first
 * place); data that must be an emoji uses a \u{...} escape in a JS string. JSX text and JSX
 * attribute strings do NOT process \u escapes -- they render the six characters literally.
 */
import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';

const SRC = path.join(__dirname, '..');

// ── The detector ──────────────────────────────────────────────────────────────────────────────

// A whitespace-delimited token made only of the characters box-drawing / Greek mojibake decays
// into once its non-ASCII half is deleted.
const DEBRIS_TOKEN = /^[+\-=G|nP]+$/;
const isDebrisRun = (tok) => DEBRIS_TOKEN.test(tok) && tok.length >= 2 && /\+/.test(tok)
  && (/[-G=n]/.test(tok) || (tok.match(/\+/g) || []).length >= 2);
// Whole-literal glyph remains: '=' (U+2261...), '=+', 'Gn+' (U+0393 ... U+2229 U+2555), 'GP' (U+221E).
const WHOLE_GLYPH = /^(=|==|=\+|==\+|=n\+|=\+n\+|=GGn\+|Gn\+|=P|GP|-\+|\+-\+)$/;
const LEAD_GLYPH = /^(=|==\+?|=\+|=n\+|Gn\+|G|\?{1,3}|-\?)\s+[A-Z0-9$`{(]/;
const TRAIL_GLYPH = /[A-Za-z0-9!.?)]\s(=|=\+|==\+?|=n\+|Gn\+|G|\?\?+)$/;
const JS_ESCAPE = /\\u\{?[0-9A-Fa-f]{4}/;
const GLSL = /\b(gl_Position|gl_FragColor|uniform\s|precision\s(high|medium|low)p)/;

function checkText(value, ctx) {
  const hits = [];
  if (!value || !value.trim() || GLSL.test(value)) return hits;
  const t = value.trim();
  const add = (rule) => hits.push(rule);

  for (const tok of t.split(/\s+/)) if (isDebrisRun(tok)) { add(`box-drawing run "${tok}"`); break; }

  if (WHOLE_GLYPH.test(t) && ctx.wholeMayBeGlyph) add(`glyph-only literal "${t}"`);
  if (t === 'G' && ctx.kind === 'jsx') add('glyph-only JSX text "G"');
  if (ctx.isStart && LEAD_GLYPH.test(t)) add('leading glyph debris');
  // A trailing '=' is only debris in prose; "a = b = " debug strings carry more than one.
  if (ctx.isEnd && TRAIL_GLYPH.test(t) && (t.match(/=/g) || []).length <= 1) add('trailing glyph debris');
  if (/(^|\s)G(\s|$)/.test(t) && t !== 'G' && /\s/.test(value)) add('"G" used as a separator');
  if (/\?\?\?/.test(t)) add('"???" glyph debris');
  // '?' as a separator between words ("Price: Low ? High", "1 strike ? Warning"); a ternary in a
  // code-like string ("a ? b : c") has a colon after it and is left alone.
  if (/[A-Za-z0-9)}+]\s\?+\s[A-Za-z0-9({"]/.test(t) && !/\?[^:]*:/.test(t)) add('"?" used as a separator');
  if (ctx.jsxRaw && JS_ESCAPE.test(value)) add('JS \\u escape in JSX text/attribute (renders literally)');
  return hits;
}

function* walk(node, parent) {
  if (!node || typeof node.type !== 'string') return;
  yield [node, parent];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c === 'object') yield* walk(c, node); }
    else if (v && typeof v === 'object' && typeof v.type === 'string') yield* walk(v, node);
  }
}

function meaningfulJsxSiblings(parent) {
  return (parent.children || []).filter((c) => !(c.type === 'JSXText' && !c.value.trim()));
}

export function findDebris(source, filename = 'snippet.js') {
  const plugins = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'];
  if (/\.tsx?$/.test(filename)) plugins.push('typescript');
  const ast = parse(source, { sourceType: 'module', plugins });
  const out = [];
  for (const [node, parent] of walk(ast.program, null)) {
    let value = null;
    let ctx = null;
    if (node.type === 'StringLiteral') {
      value = node.value;
      const inJsxAttr = parent && parent.type === 'JSXAttribute';
      // A lone '=' is an operator or key name in comparisons, `'='.repeat`, and similar code.
      const codeContext = parent && (parent.type === 'BinaryExpression' || parent.type === 'SwitchCase'
        || (parent.type === 'MemberExpression' && parent.object === node));
      ctx = { kind: inJsxAttr ? 'attr' : 'str', isStart: true, isEnd: true, wholeMayBeGlyph: !codeContext, jsxRaw: inJsxAttr };
      if (inJsxAttr) value = (node.extra && node.extra.rawValue) || value;
    } else if (node.type === 'TemplateElement') {
      value = node.value.cooked == null ? node.value.raw : node.value.cooked;
      const quasis = parent ? parent.quasis : [node];
      // Chunks between expressions (`${k}=${v}`) are formatting, not glyph slots.
      ctx = { kind: 'tpl', isStart: quasis[0] === node, isEnd: quasis[quasis.length - 1] === node,
        wholeMayBeGlyph: quasis.length === 1, jsxRaw: false };
    } else if (node.type === 'JSXText') {
      value = node.value;
      const sibs = parent ? meaningfulJsxSiblings(parent) : [node];
      ctx = { kind: 'jsx', isStart: sibs[0] === node, isEnd: sibs[sibs.length - 1] === node,
        wholeMayBeGlyph: true, jsxRaw: true };
    }
    if (value === null) continue;
    for (const rule of checkText(value, ctx)) {
      out.push({ line: node.loc.start.line, rule, text: value.trim().slice(0, 100) });
    }
  }
  return out;
}

// ── Controls: the detector must fire on real debris and stay quiet on real code ───────────────

const POSITIVE = [
  ["toast.success('Photographer accepted! They\\'re on their way. ++-+G+-++-+G-+G+G+-+');", 'box-drawing run'],
  ["const x = { icon: '=' };", 'glyph-only literal'],
  ["const x = { icon: 'Gn+' };", 'glyph-only literal'],
  ["const m = p.max_uses || 'GP';", 'glyph-only literal'],
  ["const s = `${n} surfers +-+-+ Live`;", 'box-drawing run'],
  ["const s = ` -+ ${name}`;", 'box-drawing run'],
  // JSX splits this into a lone " G " text node between two expressions.
  ["const a = <p>{role} G {email}</p>;", 'glyph-only JSX text "G"'],
  ["const a = <p>Tag & Assign G {title}</p>;", 'separator'],
  ["const a = <span>= {n} sent</span>;", 'glyph-only literal "="'],
  ["const a = <span>= Surfer Identification</span>;", 'leading glyph'],
  ["const a = <div>G Done</div>;", 'leading glyph'],
  ["toast.success('Session logged! =');", 'trailing glyph'],
  ["const l = 'Gn+ Warning';", 'leading glyph'],
  ["const l = { label: '? Pending' };", 'leading glyph'],
  ["const a = <h3>Checked In! ??</h3>;", 'trailing glyph'],
  ["const a = <span>??? {n} credits left</span>;", '"???"'],
  ["const s = 'Price: Low ? High';", 'separator'],
  ["const a = <span>1 strike ? Warning</span>;", 'separator'],
  ["const a = <p>Version {v} \\u00B7 Effective {d}</p>;", 'renders literally'],
  ['const a = <Step title="Open Settings \\u2192 Location" />;', 'renders literally'],
];

const NEGATIVE = [
  "const pad = '='.repeat((4 - s.length % 4) % 4);",
  "if (e.key === '+' || e.key === '=') zoomIn();",
  "switch (op) { case '=': break; default: }",
  "const a = <span><strong>Today</strong> = Current Conditions - <strong>Forecast:</strong> 3 days</span>;",
  "const s = `${k}=${v}`;",
  "const i = name?.[0] || 'G';",
  "const st = stance === 'goofy' ? 'G' : 'R';",
  "ctx.fillText('RED = renders WATER on true land (bleed) = ' + n, 14, 40);",
  "const glsl = `precision highp float;\\nuniform float u_x;\\nvoid main() { x += y; gl_FragColor = c; }`;",
  "const q = 'Are you sure?';",
  "const a = <p>Delete <strong>{n}</strong>?\n  This action cannot be undone.</p>;",
  "const expr = 'modelPeriod > 0.5 ? modelPeriod : (6 + h*2)';",
  "const a = <p>${rate}/hr &times; {h} hrs = ${total}</p>;",
  "const a = <p>Version {v} &middot; Effective {d}</p>;",
  "const t = { title: 'Open Settings \\u2192 Location' };",
  "const r = '\\u{1F919}';",
  "const sep = ' -- ';",
  "// toast.success('Session logged! =');  comments never render",
];

describe('encoding debris detector controls', () => {
  test.each(POSITIVE)('fires on %s', (src, expected) => {
    const hits = findDebris(src);
    expect(hits.map((h) => h.rule).join(' | ')).toContain(expected);
  });

  test.each(NEGATIVE.map((s) => [s]))('stays quiet on %s', (src) => {
    expect(findDebris(src)).toEqual([]);
  });
});

// ── The repo scan ─────────────────────────────────────────────────────────────────────────────

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'testMocks') continue;
      sourceFiles(p, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && !/\.test\.(js|jsx|ts|tsx)$/.test(e.name)
      && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('frontend/src carries no encoding debris in user-visible strings', () => {
  test('every string literal, template chunk, JSX text and JSX attribute is clean', () => {
    const files = sourceFiles(SRC);
    // Anti-vacuity: the walk must actually see the tree (815 .js files at 0d8e587a).
    expect(files.length).toBeGreaterThan(700);
    const failures = [];
    for (const f of files) {
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      for (const h of findDebris(fs.readFileSync(f, 'utf8'), f)) {
        failures.push(`${rel}:${h.line}  ${h.rule}  ${JSON.stringify(h.text)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
});
