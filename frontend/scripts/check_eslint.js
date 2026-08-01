#!/usr/bin/env node
/**
 * Raw Surf — frontend ESLint governance gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * No workflow in .github/workflows ran ESLint. That is the systemic reason a `no-undef`
 * ReferenceError survived 12 days in a hot WebGL render path: `_washOpacityEff` in
 * components/map/WebGLMarineEngine.js was referenced ~370 lines outside the block that declared
 * it (introduced 4da586aa 2026-07-19, declaration from 626c905f 2026-07-14).
 *
 * The blast radius of that class of bug is severe and SILENT. WebGLMarineCustomLayer.js wraps
 * engine.render() in a try/catch; `errorCount` is a closure variable that is NEVER reset, and the
 * layer hard-disables itself once it passes 3. So three throwing frames turn the GPU marine layer
 * off for the rest of the session, with only a console.warn to show for it. A crash that presents
 * as "the heatmap cleared" is a crash nobody reports as a crash.
 *
 * THE SHAPE OF THE GATE
 * ---------------------
 * The frontend carries pre-existing lint debt, so a flat `--max-warnings=0` would have to be
 * merged red — and a gate that is born red gets switched off. Instead this is a RATCHET, the same
 * control the repo already uses for BOLA routes (backend/scripts/check_bola_routes.py):
 *
 *   1. ALWAYS_ZERO — rules that are at zero TODAY and are never anything but a real defect.
 *      Any occurrence fails, and these can NEVER be absorbed into the baseline, even by
 *      --write-baseline. `no-undef` is the whole reason this file exists; it must not be
 *      possible to make it green by regenerating a file.
 *   2. Fatal parse errors — ALWAYS zero, never baselined. A file ESLint cannot parse is a file
 *      that is NOT LINTED: `no-undef` can never fire there. Before this gate, 21 .ts/.tsx files
 *      under src/admin failed to parse because no TS parser was wired in, so the config CLAIMED
 *      to cover them while silently linting none of them.
 *   3. Everything else — ratcheted per-rule against scripts/eslint_baseline.json. Shrink-only:
 *      counts may fall, never rise.
 *
 * Usage:
 *   node scripts/check_eslint.js                  # verify (CI)
 *   node scripts/check_eslint.js --write-baseline # re-record after reducing debt
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'eslint_baseline.json');
const TARGET = 'src';

/**
 * Rules that may NEVER be baselined. Every one of these is zero as of 2026-07-31 and every one of
 * them is a genuine defect rather than a style opinion — an undefined identifier, an assignment
 * that cannot take, a comparison that cannot be true. Adding a rule here is a promise that it is
 * currently at zero; the script verifies that promise when writing a baseline.
 */
const ALWAYS_ZERO = [
  'no-undef', // ← the _washOpacityEff class. The reason this gate exists.
  'no-const-assign',
  'no-class-assign',
  'no-func-assign',
  'no-import-assign',
  'no-setter-return',
  'no-dupe-args',
  'no-dupe-class-members',
  'no-dupe-else-if',
  'no-obj-calls',
  'no-unreachable',
  'no-unsafe-negation',
  'no-unsafe-optional-chaining',
  'no-self-assign',
  'no-compare-neg-zero',
  'no-async-promise-executor',
  'getter-return',
  'use-isnan',
  'valid-typeof',
];

const FATAL_KEY = '(fatal parse error)';
const UNUSED_DIRECTIVE_KEY = '(unused eslint-disable directive)';

function bucket(message) {
  if (message.fatal) return FATAL_KEY;
  if (!message.ruleId) return UNUSED_DIRECTIVE_KEY;
  return message.ruleId;
}

async function collect() {
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: FRONTEND_ROOT });
  const results = await eslint.lintFiles([TARGET]);

  const errors = {};
  const warnings = {};
  // Keep one example location per bucket so a failure is actionable without a second run.
  const examples = {};

  for (const result of results) {
    for (const message of result.messages) {
      const key = bucket(message);
      const table = message.severity === 2 ? errors : warnings;
      table[key] = (table[key] || 0) + 1;
      if (!examples[key]) {
        const rel = path.relative(FRONTEND_ROOT, result.filePath).replace(/\\/g, '/');
        examples[key] = `${rel}:${message.line || 0}  ${message.message}`;
      }
    }
  }

  return { filesLinted: results.length, errors, warnings, examples };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(snapshot) {
  // A baseline is a record of DEBT. It must never be able to record a defect that the gate is
  // meant to make impossible — otherwise "regenerate the baseline" becomes a way to launder a
  // real bug into a green build. The BOLA baseline drifted 221 -> 226 in five days; that is the
  // failure mode this refusal is here to prevent.
  const violations = [];
  for (const rule of ALWAYS_ZERO) {
    if (snapshot.errors[rule]) violations.push(`${rule} (${snapshot.errors[rule]})`);
  }
  if (snapshot.errors[FATAL_KEY]) {
    violations.push(`${FATAL_KEY} (${snapshot.errors[FATAL_KEY]})`);
  }
  if (violations.length) {
    console.error('\n✖ REFUSING to write a baseline that contains never-baselinable findings:');
    violations.forEach((v) => console.error(`    ${v}`));
    console.error('\n  Fix the code. These rules exist to be zero.\n');
    process.exit(1);
  }

  const payload = {
    _comment:
      'Pre-existing frontend lint debt. SHRINK-ONLY — counts may fall, never rise. Regenerate ' +
      'with `node scripts/check_eslint.js --write-baseline` after genuinely reducing debt. ' +
      'Rules in ALWAYS_ZERO (see check_eslint.js) can never appear here.',
    _filesLinted: snapshot.filesLinted,
    errors: sortedObject(snapshot.errors),
    warnings: sortedObject(snapshot.warnings),
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const totalE = sum(snapshot.errors);
  const totalW = sum(snapshot.warnings);
  console.log(`✅ Baseline written: ${totalE} errors, ${totalW} warnings across ` +
    `${snapshot.filesLinted} files.`);
}

const sum = (t) => Object.values(t).reduce((a, b) => a + b, 0);

function sortedObject(table) {
  return Object.fromEntries(Object.entries(table).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function report(snapshot, baseline) {
  const failures = [];

  // ---- Gate 1: never-baselinable rules -------------------------------------------------
  for (const rule of [...ALWAYS_ZERO, FATAL_KEY]) {
    const count = snapshot.errors[rule] || 0;
    if (count > 0) {
      failures.push({
        kind: 'ALWAYS_ZERO',
        rule,
        detail: `${count} occurrence(s) — this rule must be zero`,
        example: snapshot.examples[rule],
      });
    }
  }

  // ---- Gate 2: shrink-only ratchet on known debt ----------------------------------------
  if (baseline) {
    for (const [severity, table] of [['error', snapshot.errors], ['warning', snapshot.warnings]]) {
      const base = (severity === 'error' ? baseline.errors : baseline.warnings) || {};
      for (const [rule, count] of Object.entries(table)) {
        if (ALWAYS_ZERO.includes(rule) || rule === FATAL_KEY) continue; // already handled above
        const allowed = base[rule] || 0;
        if (count > allowed) {
          failures.push({
            kind: 'RATCHET',
            rule,
            detail: `${severity}s rose ${allowed} → ${count} (+${count - allowed})`,
            example: snapshot.examples[rule],
          });
        }
      }
    }
  }

  return failures;
}

function printImprovements(snapshot, baseline) {
  if (!baseline) return;
  const gains = [];
  for (const [severity, table] of [['error', baseline.errors || {}], ['warning', baseline.warnings || {}]]) {
    const now = severity === 'error' ? snapshot.errors : snapshot.warnings;
    for (const [rule, was] of Object.entries(table)) {
      const is = now[rule] || 0;
      if (is < was) gains.push(`    ${rule}: ${was} → ${is} (-${was - is}) [${severity}s]`);
    }
  }
  if (gains.length) {
    console.log('\n🎉 Debt reduced since the baseline was recorded:');
    gains.forEach((g) => console.log(g));
    console.log('\n    Lock it in:  node scripts/check_eslint.js --write-baseline');
  }
}

(async () => {
  const wantsWrite = process.argv.includes('--write-baseline');
  const snapshot = await collect();

  if (wantsWrite) {
    writeBaseline(snapshot);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`✖ No baseline at ${path.relative(FRONTEND_ROOT, BASELINE_PATH)}.`);
    console.error('  Create it with:  node scripts/check_eslint.js --write-baseline');
    process.exit(1);
  }

  const failures = report(snapshot, baseline);
  const totalE = sum(snapshot.errors);
  const totalW = sum(snapshot.warnings);

  console.log(`ESLint gate — ${snapshot.filesLinted} files linted, ` +
    `${totalE} errors, ${totalW} warnings.`);

  if (!failures.length) {
    console.log('✅ No never-zero rule fired and no rule exceeded its baseline.');
    printImprovements(snapshot, baseline);
    return;
  }

  const blocking = failures.filter((f) => f.kind === 'ALWAYS_ZERO');
  const ratchet = failures.filter((f) => f.kind === 'RATCHET');

  if (blocking.length) {
    console.error('\n✖ BLOCKING — a rule that must always be zero has fired.');
    console.error('  These are real defects. Fix the code; they cannot be baselined.\n');
    for (const f of blocking) {
      console.error(`    ${f.rule}: ${f.detail}`);
      if (f.example) console.error(`      e.g. ${f.example}`);
    }
    if (blocking.some((f) => f.rule === 'no-undef')) {
      console.error('\n  ⚠ `no-undef` in a render path is not cosmetic: WebGLMarineCustomLayer');
      console.error('    hard-disables the GPU marine layer after 3 throwing frames and never');
      console.error('    resets the counter. The symptom is a cleared heatmap, not a stack trace.');
    }
  }

  if (ratchet.length) {
    console.error('\n✖ RATCHET — pre-existing lint debt grew.');
    console.error('  The frontend has known debt, recorded in scripts/eslint_baseline.json.');
    console.error('  It is shrink-only. Fix what you added:\n');
    for (const f of ratchet) {
      console.error(`    ${f.rule}: ${f.detail}`);
    }
    // Deliberately NO example here. The baseline stores per-rule TOTALS, so this gate knows a
    // count rose but not WHICH occurrence is new — the first hit in the tree is almost always
    // pre-existing debt, and printing it would point the reader at code they did not touch.
    // Naming the real location needs a diff against the working tree, which is what this does:
    console.error('\n  Locate YOUR occurrences (only the files you changed):');
    console.error('    npx eslint $(git diff --name-only --diff-filter=ACM origin/dev...HEAD \\');
    console.error('      -- "frontend/src/**/*.js" "frontend/src/**/*.jsx" "frontend/src/**/*.ts" \\');
    console.error('      "frontend/src/**/*.tsx" | sed "s|^frontend/||")');
    console.error('\n  Most unused-import warnings auto-fix:  npm run lint:fix');
  }

  console.error('');
  process.exit(1);
})().catch((err) => {
  console.error('✖ ESLint gate crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
