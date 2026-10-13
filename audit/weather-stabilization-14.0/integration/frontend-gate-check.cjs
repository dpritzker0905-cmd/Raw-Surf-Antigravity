const fs = require('fs');
const path = require('path');
// Floors are shrink-only. Raise them when guards are added; lowering one is a deliberate
// act that should appear in a diff. Measured 2026-08-01 on a quiet tree at this SHA:
//   marine-card-matrix-closure.test.js   29 tests   (14 at 1a-0, +4 at 1a-1, +11 at 1a-2)
//   forecast-card-swell-vs-surf.test.js  19 tests
//   => 2 suites / 48 tests. MIN_SUITES is EXACT so any drop is red, not quietly narrower.
// ⬆ 33 -> 37 (1a-1: the #22 bare-'Height' ban, TOTAL-vs-TRAIN, the (est.) disclosure pair)
// ⬆ 37 -> 48 (1a-2: the derived energy coefficient, the band ladder, coarsen-don't-hide,
//             magnitude-based precision, and the live-fixture band-span anti-vacuity)
// Measured from the run each time, never incremented by hand.
// Audit14: measured 7 suites / 96 tests, including exact-time reuse and timeline truth.
// This focused discovery floor supplements the blocking full frontend suite.
const MIN_SUITES = 7, MIN_TESTS = 96;
let r;
try { r = JSON.parse(fs.readFileSync("C:\\Users\\dprit\\OneDrive\\Documents\\New project\\raw-surf-stabilization14\\audit\\weather-stabilization-14.0\\frontend-gate.json", 'utf8')); }
catch (e) { console.error('✗ no guard-results.json — jest never wrote a result'); process.exit(1); }
// path.basename, NOT a regex — a `[\\/]` character class does not survive intact through
// the YAML block scalar + heredoc layers (verified: it arrived as `[\/]`), and a mangled
// escape in a step that is supposed to PROVE coverage is the wrong place to be clever.
const files = r.testResults.map((t) => path.basename(t.name)).sort();
console.log(`suites ${r.numPassedTestSuites}/${r.numTotalTestSuites}  tests ${r.numPassedTests}/${r.numTotalTests}  failed ${r.numFailedTests}`);
files.forEach((f) => console.log(`  guard: ${f}`));
let bad = false;
if (r.numTotalTestSuites < MIN_SUITES) { console.error(`✗ suites ${r.numTotalTestSuites} < floor ${MIN_SUITES}`); bad = true; }
if (r.numPassedTests < MIN_TESTS) { console.error(`✗ passed ${r.numPassedTests} < floor ${MIN_TESTS}`); bad = true; }
if (r.numFailedTests > 0) { console.error(`✗ ${r.numFailedTests} failed`); bad = true; }
process.exit(bad ? 1 : 0);
