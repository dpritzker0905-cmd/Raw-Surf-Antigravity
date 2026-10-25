#!/usr/bin/env node
// BEACH PATH, the ground table: the ground the wind FIELD lays, knot by knot, over land and over sea (L* / C* / hue), for dark by the
// ENGINE's law (field x alpha squared + map x (1 - alpha)), beach before its path, beach on its path, and any candidate handed in; and
// how FLAT each is from 6 to 40 kn (the span between its lightest and its deepest ground). The shape of the ground along speed sets
// how far one white strength can lift the picture at every speed, so this is the table a white strength is solved against.
//
//   node beach-path-ground.mjs [--to 60] ["label=candidate.json" ...] > ground.md
import fs from 'fs';
import { TOP, LAND, WATER, TODAY, on, pathOf, darkOn } from './beach-path-solve.mjs';
import { lchOf } from './light-path-lib.mjs';
import { sample, drawnField } from './mirror-model.mjs';

const argv = process.argv.slice(2), to = Number(argv.includes('--to') ? argv[argv.indexOf('--to') + 1] : 60), extra = argv.filter((a) => a.includes('=') && a.endsWith('.json'));
const knots = Array.from({ length: TOP + 1 }, (_, kn) => kn);
const fromField = (F) => knots.map((kn) => ({ land: on(sample(F, kn), kn, LAND), water: on(sample(F, kn), kn, WATER) }));
const arms = [
  { label: 'dark', rows: knots.map((kn) => ({ land: darkOn(kn, 'land'), water: darkOn(kn, 'water') })) },
  { label: 'beach today', rows: fromField(TODAY) },
  { label: 'on its path (A, built)', rows: fromField(drawnField('beach', {})) },
  ...extra.map((e) => { const j = JSON.parse(fs.readFileSync(e.slice(e.indexOf('=') + 1), 'utf8')), cand = Array.isArray(j) ? j[0].cand : j; return { label: e.slice(0, e.indexOf('=')), rows: pathOf(cand).map((r) => ({ land: r.land, water: r.water })) }; }),
];
const cell = (c) => { const q = lchOf(c); return `${q.L.toFixed(1)} / ${q.C.toFixed(1)} / ${q.h.toFixed(0)}`; };
const span = (arm, surf, a, b) => { const L = knots.filter((kn) => kn >= a && kn <= b).map((kn) => lchOf(arm.rows[kn][surf]).L); return { lo: Math.min(...L), hi: Math.max(...L) }; };
console.log('# The ground beach\'s wind field lays, knot by knot (L* / C* / hue)\n');
console.log('Dark by the ENGINE\'s law (field x alpha squared + map x (1 - alpha); grounds: land [18, 20, 26], sea [93, 117, 126]). Beach by its multiply tint over its muted land and sea, as the palette checker models them (`mirror-model.mjs`).\n');
console.log('## How flat each is from 6 to 40 kn (lightest minus deepest ground, L*), and from 6 to 21 kn\n');
console.log('| | land 6-40 kn | sea 6-40 kn | land 6-21 kn | sea 6-21 kn |\n|---|---|---|---|---|');
for (const arm of arms) { const f = (surf, a, b) => { const s = span(arm, surf, a, b); return `${(s.hi - s.lo).toFixed(1)} (${s.lo.toFixed(1)} to ${s.hi.toFixed(1)})`; };
  console.log(`| ${arm.label} | ${f('land', 6, 40)} | ${f('water', 6, 40)} | ${f('land', 6, 21)} | ${f('water', 6, 21)} |`); }
console.log(`\n## Per knot\n\n| kn | ${arms.flatMap((a) => [`${a.label} land`, `${a.label} sea`]).join(' | ')} |\n|---|${arms.map(() => '---|---|').join('')}`);
for (const kn of knots.filter((k) => k <= to)) console.log(`| ${kn} | ${arms.flatMap((a) => [cell(a.rows[kn].land), cell(a.rows[kn].water)]).join(' | ')} |`);
