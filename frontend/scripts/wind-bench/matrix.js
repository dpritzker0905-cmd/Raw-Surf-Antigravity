/**
 * Wind bench: WHAT is measured. Views, themes, variants and the positive control. Pure data plus
 * the control's verdict, shared by the page, the Node runner and the Jest test.
 *
 * ── ADDING A VARIANT ──────────────────────────────────────────────────────────────────────────────
 * A variant is a set of window levers applied before the engine is created. Add an entry to
 * VARIANTS, e.g.
 *     noWideTrails: { label: 'candidate without wide-zoom trails', levers: { __RAW_DISABLE_WIND_WIDE_TRAILS__: true } },
 * then run it with `--variants shipped,candidate,noWideTrails`. The page deletes EVERY window key
 * that starts with `__RAW_` between configurations, so a lever can never leak into the next one.
 * A lever the engine does not read is silently a no-op, so check the engine reads it
 * (`git grep <lever> frontend/src`) before trusting a "no difference" result.
 */

// Storm box centre used on 2026-10-08 (PR #281): the eye, its 34-44 kn rings and calm air all on screen.
const CENTER = Object.freeze({ lng: -89.2, lat: 25.8 });

const VIEWS = Object.freeze([
  ...[2, 3, 4, 5, 6].map((z) => ({ id: `world-z${z}`, z, grid: 'world' })),
  ...[6.5, 7, 8, 9, 10, 11].map((z) => ({ id: `fine-z${z}`, z, grid: 'fine' })),
  ...[7, 9].map((z) => ({ id: `clip2-z${z}`, z, grid: 'clip2' })),
]);

const THEMES = Object.freeze(['dark', 'light', 'beach']);

// Basemap colour under the wind layer, per theme (linear-ish RGB 0..1, cleared before each frame).
const BASEMAP = Object.freeze({ dark: [0.07, 0.08, 0.10], light: [0.86, 0.88, 0.90], beach: [0.62, 0.58, 0.50] });

const VARIANTS = Object.freeze({
  // The look before PR #281, rebuilt from #281's three kill switches. On a tree without those
  // switches this equals `candidate` (both are simply that tree's engine).
  shipped: {
    label: 'kill switches on (pre-#281 look)',
    levers: { __RAW_DISABLE_WIND_SPEED_KEEP__: true, __RAW_DISABLE_WIND_FIXED_CASING__: true, __RAW_DISABLE_WIND_WIDE_TRAILS__: true },
  },
  candidate: { label: 'engine as written', levers: {} },
});

/**
 * POSITIVE CONTROL: a bench that cannot see a known defect proves nothing when it sees none.
 * With the fixed-casing kill switch on, the per-pixel casing pole traces each top-speed contour:
 * a dark-cored HOLE inside it (about 44 kn here) and an over-inked BLOB ring outside it (about
 * 34 kn). Dark z8 on the 0.25 deg grid shows both. The shipped variant MUST show both (or the
 * scanner is blind and the run proves nothing); the candidate must show neither.
 */
const POSITIVE_CONTROL = Object.freeze({
  view: 'fine-z8',
  theme: 'dark',
  blindVariant: 'shipped',
  fixedVariant: 'candidate',
  expect: [{ kind: 'HOLE', kn: 44 }, { kind: 'BLOB', kn: 34 }],
  tolKn: 5,
});

/** Significant non-calm clusters matching each expected artifact (null where none matches). */
function controlHits(scan, control = POSITIVE_CONTROL) {
  const sig = (scan && scan.significant) || [];
  return control.expect.map((e) => sig.find((c) => !c.calm && c.kind === e.kind && Math.abs(c.kn - e.kn) <= control.tolKn) || null);
}

/**
 * Verdict:
 *   status 'BLIND' — the blind variant does not show every expected artifact: the run proves nothing.
 *   status 'FAIL'  — the scanner can see the defect and the fixed variant still has some of it.
 *   status 'PASS'  — the blind variant shows all of it and the fixed variant shows none.
 */
function evaluateControl(blindScan, fixedScan, control = POSITIVE_CONTROL) {
  const blindHits = controlHits(blindScan, control);
  const fixedHits = controlHits(fixedScan, control);
  let status = 'PASS';
  if (blindHits.some((h) => !h)) status = 'BLIND';
  else if (fixedHits.some(Boolean)) status = 'FAIL';
  return { status, blindHits, fixedHits };
}

/**
 * The run list, ordered view -> theme -> variant so each variant pair renders back to back.
 * `views`, `themes` and `variants` are id lists; unknown ids throw rather than run a smaller matrix.
 */
function buildMatrix(opts = {}) {
  const pick = (all, ids, what) => {
    if (!ids) return all;
    return ids.map((id) => {
      const hit = all.find((x) => (x.id || x) === id);
      if (!hit) throw new Error(`unknown ${what} "${id}" (have: ${all.map((x) => x.id || x).join(', ')})`);
      return hit;
    });
  };
  const views = pick(VIEWS, opts.views, 'view');
  const themes = pick(THEMES, opts.themes, 'theme');
  const variantIds = opts.variants || Object.keys(VARIANTS);
  variantIds.forEach((v) => { if (!VARIANTS[v]) throw new Error(`unknown variant "${v}" (have: ${Object.keys(VARIANTS).join(', ')})`); });
  const configs = [];
  views.forEach((view) => themes.forEach((theme) => variantIds.forEach((variant) => configs.push({
    view: view.id, z: view.z, grid: view.grid, theme, variant, lng: CENTER.lng, lat: CENTER.lat,
    frames: opts.frames || 180, res: opts.res || 384, clock: opts.clock || 'virtual',
  }))));
  return configs;
}

/** The two configurations the positive control needs. */
function controlConfigs(opts = {}) {
  const c = POSITIVE_CONTROL;
  return buildMatrix({ ...opts, views: [c.view], themes: [c.theme], variants: [c.blindVariant, c.fixedVariant] });
}

module.exports = { CENTER, VIEWS, THEMES, BASEMAP, VARIANTS, POSITIVE_CONTROL, controlHits, evaluateControl, buildMatrix, controlConfigs };
