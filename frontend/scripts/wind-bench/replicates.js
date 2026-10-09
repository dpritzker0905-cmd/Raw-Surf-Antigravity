/**
 * Wind bench: replicates. Pure, shared by the page, the Node runner and the Jest test.
 *
 * One render is one draw of the particle lottery. Measured 2026-10-09 on PR #281's engine: the
 * same code scored 6, 12 and 11 candidate artifacts on three seeds. The big shapes recurred
 * every time, while the 1-4 block clusters at the null floor came and went. So with
 * `--seeds N`, every configuration is rendered N times. An artifact counts only when it RECURS:
 * the same kind, with its centre within reach, in a majority of the seeds.
 */

const { evaluateControl, POSITIVE_CONTROL } = require('./matrix');

const groupKey = (r) => `${r.view}/${r.theme}/${r.variant}`;

/** Two clusters are the same shape when the kinds match and the centres are close for their size. */
function sameShape(a, b, blockCss = 32) {
  if (a.kind !== b.kind) return false;
  const reach = Math.max(2 * blockCss, 0.5 * Math.sqrt(Math.max(a.blocks, b.blocks)) * blockCss);
  return Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) <= reach;
}

/**
 * Groups the non-calm significant clusters of one view/theme/variant across its seeds.
 * @param runs results for ONE view/theme/variant, one per seed
 * @returns shapes [{ kind, kn, blocks, at, seen, of, stable }], most-seen first
 */
function recurringShapes(runs) {
  const shapes = [];
  runs.forEach((run, s) => {
    run.significant.filter((c) => !c.calm).forEach((c) => {
      const hit = shapes.find((g) => !g.seeds.has(s) && sameShape(g.members[0], c));
      if (hit) { hit.seeds.add(s); hit.members.push(c); } else shapes.push({ seeds: new Set([s]), members: [c] });
    });
  });
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  return shapes.map((g) => ({
    kind: g.members[0].kind,
    kn: +mean(g.members.map((c) => c.kn)).toFixed(1),
    blocks: Math.round(mean(g.members.map((c) => c.blocks))),
    res: +mean(g.members.map((c) => c.res)).toFixed(2),
    at: [0, 1].map((k) => Math.round(mean(g.members.map((c) => c.at[k])))),
    calm: false,
    seen: g.seeds.size,
    of: runs.length,
    stable: g.seeds.size > runs.length / 2,
  })).sort((a, b) => b.seen - a.seen || b.blocks - a.blocks);
}

/**
 * One row per view/theme/variant. Metrics are seed means, `significant` lists the shapes that
 * recur in a majority of seeds, and `artifacts` counts them. With one seed it is the run itself.
 */
function mergeSeeds(results) {
  const groups = new Map();
  results.forEach((r) => {
    if (!groups.has(groupKey(r))) groups.set(groupKey(r), []);
    groups.get(groupKey(r)).push(r);
  });
  return [...groups.values()].map((runs) => {
    if (runs.length === 1) return { ...runs[0], seeds: 1, flicker: 0 };
    const avg = (f, dp) => {
      const xs = runs.map(f).filter((x) => x != null && !Number.isNaN(x));
      return xs.length ? +(xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(dp) : null;
    };
    const shapes = recurringShapes(runs);
    const stable = shapes.filter((g) => g.stable);
    return {
      ...runs[0],
      seed: runs.map((r) => r.seed),
      seeds: runs.length,
      ink: avg((r) => r.ink, 1),
      saturated: avg((r) => r.saturated, 3),
      stormSlow: avg((r) => r.stormSlow, 2),
      msPerFrame: avg((r) => r.msPerFrame, 1),
      cpuMs: avg((r) => r.cpuMs, 2),
      significant: stable,
      artifacts: stable.length,
      artifactBlocks: stable.reduce((a, g) => a + g.blocks, 0),
      flicker: shapes.length - stable.length,
      clusters: avg((r) => r.clusters, 1),
    };
  });
}

/** The control must hold in EVERY seed: one blind seed means the scanner is not reliable. */
function controlAcrossSeeds(results, control = POSITIVE_CONTROL) {
  const pick = (variant) => results.filter((r) => r.view === control.view && r.theme === control.theme && r.variant === variant);
  const blind = pick(control.blindVariant), fixed = pick(control.fixedVariant);
  const perSeed = blind.map((b) => {
    const f = fixed.find((x) => (x.seed || 0) === (b.seed || 0));
    return f ? { seed: b.seed || 0, ...evaluateControl(b, f, control) } : null;
  }).filter(Boolean);
  if (!perSeed.length) return null;
  const worst = ['BLIND', 'FAIL', 'PASS'].find((s) => perSeed.some((v) => v.status === s));
  const first = perSeed.find((v) => v.status === worst);
  return { ...first, status: worst, seeds: perSeed.map((v) => `${v.seed}:${v.status}`) };
}

module.exports = { sameShape, recurringShapes, mergeSeeds, controlAcrossSeeds };
