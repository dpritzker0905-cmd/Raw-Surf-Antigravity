/**
 * ledger_audit.js — does the LEDGER still describe the REPO?
 *
 * The queue and the memory index are the documents this project treats as authoritative, and both
 * are hand-maintained. 2026-08-01 a single read found staleness in BOTH directions: two P1 items
 * marked OPEN were already shipped (#11 `7551d511`, #16 `2cf57d28`), and separately a code comment
 * asserted the exact opposite of the measured reality. The dangerous direction is the inverse of
 * what was found: an item marked ✅ CLOSED whose commit is NOT on the branch that ships is a LIVE
 * defect that nobody is looking at any more. Memory records exactly that happening once.
 *
 * Checks, all mechanical and falsifiable:
 *   1. SHA EXISTS        — every cited short SHA resolves in this repo
 *   2. SHA SHIPS         — and is an ancestor of `dev` (rule 10a)
 *   3. SYMBOL CONSUMED   — every cited function/guard is not just DEFINED but CALLED
 *   4. KILL SWITCH READ  — every cited `__RAW_*` / env flag is actually read somewhere in code
 *
 * Deliberately reports UNKNOWN separately from FAIL: a name this script cannot resolve is a gap in
 * the instrument, not evidence about the repo (rule 16 — build the refusal in).
 *
 * ⚠️⚠️ KNOWN LIMIT OF CHECK [3], AND IT IS THE IMPORTANT ONE.
 * "CONSUMED" here means the symbol is DEFINED and CALLED from non-test code. That is necessary and
 * **NOT sufficient**. Same day this was written, check [3] reported `shouldRejectMaskShrink` as
 * "ok (1 call site)" while a parallel session's kill-switch-injection A/B proved the very same guard
 * is **INERT** in the live app (`50c74e33`, `5627d799`). A call site is a STATIC fact; whether the
 * call changes the rendered outcome is a DYNAMIC one, and only an A/B through the guard's own kill
 * switch can answer it. ⇒ **Never read a green [3] row as "this guard works."** Read it as "this
 * guard is not obviously dead code." The stronger instrument is the kill-switch A/B; this script
 * exists to find the ledger's *bookkeeping* lies, not its *efficacy* lies.
 *
 * WHAT IT ALREADY CAUGHT (2026-08-01, first run):
 *   - 1 real orphan: `1a1134ec` (coastal/polar marine no-data holes) lives only on
 *     `prep/icon-coverage-valid-nn`; `build_regular_nn_valid` is ABSENT from dev and the defect has
 *     been live 35 days.
 *   - 12 flags cited in the ledger with ZERO reads in code ⇒ any A/B run through them is VOID.
 *   - 5 SHAs that resolve to nothing.
 *
 * ⚠️ AND IT LIED ON ITS OWN FIRST RUN: the first draft used `execSync` with `2>/dev/null`, `|` and
 * `head`. On Windows execSync runs cmd.exe, so every probe failed and it reported 0/626 SHAs
 * resolving — including commits pushed from this machine an hour earlier. Hence execFileSync (argv,
 * no shell) plus the HEAD self-check below, which VOIDS the run rather than reporting a confident 0.
 *
 * Usage:  node scripts/ledger_audit.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'C:/Users/dprit/Raw-Surf';
const MEM = 'C:/Users/dprit/.claude/projects/C--Users-dprit-Raw-Surf/memory';
const QUEUE = path.join(REPO, 'docs/runbooks/START-HERE-2026-08-01-THE-ONE-QUEUE.md');

// ⚠️ NO SHELL. execSync on Windows runs cmd.exe, where `2>/dev/null`, `|`, `head` and `wc` are all
// invalid — the first draft used them, every probe returned null, and the audit reported 0/626 SHAs
// resolving INCLUDING commits pushed from this machine an hour earlier. The instrument was broken,
// not the repo (3rd Windows shell-layer false green this session). execFileSync takes an argv array
// and spawns git directly: no shell, no quoting, no platform surprise.
const { execFileSync } = require('child_process');
const git = (args) => {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { return null; }
};
// exit-code-only probes (merge-base --is-ancestor): null means "false", not "unknown"
const gitOk = (args) => {
  try { execFileSync('git', args, { cwd: REPO, stdio: ['pipe','pipe','pipe'] }); return true; }
  catch { return false; }
};

// ---- gather ledger sources -------------------------------------------------
const sources = [];
if (fs.existsSync(QUEUE)) sources.push({ name: 'QUEUE', text: fs.readFileSync(QUEUE, 'utf8') });
for (const f of fs.readdirSync(MEM).filter((f) => f.endsWith('.md'))) {
  sources.push({ name: 'mem/' + f, text: fs.readFileSync(path.join(MEM, f), 'utf8') });
}

// ---- 1+2: SHAs -------------------------------------------------------------
// Only inside backticks — prose words like "deadbeef" are not claims.
const shaRe = /`([0-9a-f]{7,40})`/g;
const shas = new Map();   // sha -> Set(source)
for (const s of sources) {
  let m;
  while ((m = shaRe.exec(s.text))) {
    const v = m[1];
    if (/^[0-9]+$/.test(v)) continue;            // pure digits: a number, not a sha
    if (!shas.has(v)) shas.set(v, new Set());
    shas.get(v).add(s.name);
  }
}

const missing = [], notShipped = [], shipped = [];
for (const [sha, srcs] of shas) {
  const type = git(['cat-file', '-t', sha]);
  if (type !== 'commit') { missing.push({ sha, srcs: [...srcs] }); continue; }
  const isAnc = gitOk(['merge-base', '--is-ancestor', sha, 'dev']);
  const subj = git(['log', '-1', '--format=%s', sha]) || '';
  (isAnc ? shipped : notShipped).push({ sha, srcs: [...srcs], subj: subj.slice(0, 72) });
}

// SELF-CHECK (rule 16 — build the refusal in). This audit is only meaningful if the git probe
// works at all. A SHA created in this repo must resolve; if HEAD itself does not, the tool is
// broken and every "missing" row is noise. Refuse rather than report a confident 0/N.
const headSha = git(['rev-parse', '--short', 'HEAD']);
if (!headSha || git(['cat-file', '-t', headSha]) !== 'commit') {
  console.error('⛔ SELF-CHECK FAILED: cannot resolve HEAD. The git probe is broken — results VOID.');
  process.exit(2);
}

// ---- 3: symbols cited as shipped guards ------------------------------------
const SYMBOLS = [
  'shouldRejectMaskShrink', 'shouldRejectResolutionDowngrade', 'shouldKeepResidentOnNullEncode',
  'resolveCoarseCrestControls', 'resolveColdVeil', 'applySharpenOpacityEase',
  'shouldResetErrorBurst', 'computeMidZoomOverlayEngage', 'estimate_surf_at',
  'resolve_surf_geometry', 'compute_surf_rating', 'rate_one_spot', 'confirmation_for',
];
const symbolRows = SYMBOLS.map((sym) => {
  const hits = (git(['grep', '-n', sym, '--', '*.py', '*.js']) || '').split('\n').filter(Boolean);
  const defined = hits.some((l) => new RegExp(`(def|function|export function)\\s+${sym}\\b`).test(l));
  // A CALL is `sym(` on a line that is not a definition, an import/export, or a comment.
  const calls = hits
    .filter((l) => l.includes(`${sym}(`))
    .filter((l) => !new RegExp(`(def|function)\\s+${sym}\\b`).test(l))
    .filter((l) => !/^\S+:\d+:\s*(\/\/|#|\*)/.test(l))
    .filter((l) => !/import |from |export \{/.test(l));
  const prod = calls.filter((l) => !/\.test\.js|_test\.py|[/\\]tests?[/\\]|__tests__/.test(l));
  return { sym, defined, callSites: prod.length, testOnly: prod.length === 0 && calls.length > 0 };
});

// ---- 4: kill switches / flags cited in the ledger ---------------------------
// ⚠️ The first alternative used to be `__RAW_[A-Z0-9_]+__`, which special-cased ONE dunder family.
// A name like `__MARINE_BG_FILL__` therefore missed it, fell through to the generic branch — which
// cannot match a leading `_` — and was reported as `MARINE_BG_FILL__`: a name that exists nowhere
// in the repo or the docs. Check [4] listed two such phantoms among its 14, and an audit that
// reports names which do not exist teaches its reader to skim the section. Generalised to any
// dunder-wrapped flag, so `__RAW_*__` and `__MARINE_*__` are both captured whole.
const flagRe = /`?(__[A-Z][A-Z0-9_]*__|[A-Z][A-Z0-9_]{5,})`?/g;
const KNOWN_NOISE = new Set(['README', 'START', 'HANDOFF', 'MEMORY', 'CLOSED', 'CRITICAL', 'WARNING']);
const flags = new Map();
for (const s of sources) {
  let m;
  while ((m = flagRe.exec(s.text))) {
    const v = m[1];
    if (KNOWN_NOISE.has(v)) continue;
    if (!/^__RAW_|^(WAVES_|SURF_|MARINE_|RATING_|ERA5_)/.test(v)) continue;   // scope to real flag families
    if (!flags.has(v)) flags.set(v, new Set());
    flags.get(v).add(s.name);
  }
}
const flagRows = [...flags.keys()].map((f) => ({
  flag: f,
  // ⚠️⚠️ THE AUDITOR MUST EXCLUDE ITSELF, and this file is a `*.js`. Writing `__MARINE_BG_FILL__`
  // into a COMMENT here — while fixing the extractor above — gave that flag a "read in code" and
  // silently dropped a genuinely dead lever from check [4]. Caught only because the reported count
  // moved 14 -> 11 when the fix should have changed two NAMES and no COUNT.
  // ★ This is the trap this script's own header names: "unscoped, every flag came back recently
  // touched — by the queue file naming them, i.e. the instrument measuring the document it was
  // auditing". An audit that reads itself will always find its subject alive.
  reads: (git(['grep', '-l', f, '--', '*.py', '*.js', '*.yml', ':!scripts/ledger_audit.js'])
    || '').split('\n').filter(Boolean).length,
  srcs: [...flags.get(f)],
})).filter((r) => r.reads === 0);

// ---- report ----------------------------------------------------------------
const L = console.log;
L('='.repeat(78));
L(`LEDGER AUDIT — ${sources.length} sources, ${shas.size} distinct SHAs cited`);
L('='.repeat(78));
L(`\n[1] SHA RESOLVES        ok ${shipped.length + notShipped.length} / ${shas.size}`);
L(`[2] ANCESTOR OF dev     ok ${shipped.length}`);

L(`\n⛔ CITED BUT NOT IN THIS REPO (${missing.length}) — a claim pointing at nothing:`);
missing.forEach((r) => L(`   ${r.sha}  cited in: ${r.srcs.slice(0, 3).join(', ')}`));

L(`\n⛔⛔ CITED AS WORK BUT **NOT AN ANCESTOR OF dev** (${notShipped.length}) — believed done, not shipping:`);
notShipped.forEach((r) => L(`   ${r.sha}  ${r.subj}\n        cited in: ${r.srcs.slice(0, 3).join(', ')}`));

L(`\n[3] SYMBOL CONSUMED (defined AND called in non-test code):`);
symbolRows.forEach((r) => {
  const flag = !r.defined ? '⛔ NOT DEFINED' : r.callSites === 0 ? '⛔⛔ DEFINED BUT NEVER CALLED' : `ok (${r.callSites} call sites)`;
  L(`   ${r.sym.padEnd(34)} ${flag}`);
});

L(`\n[4] FLAGS CITED IN THE LEDGER WITH **ZERO** READS IN CODE (${flagRows.length}):`);
flagRows.forEach((r) => L(`   ⛔ ${r.flag}`));
L('');
