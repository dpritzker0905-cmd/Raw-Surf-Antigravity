# Wind bench

An offline, repeatable check of the wind particle layer. It renders the **real**
`src/components/map/WebGLWindEngine.js` on this machine's GPU, on a synthetic storm, across the
zoom × theme matrix. It also runs a significance-tested scanner that finds holes, blobs, diamonds
and rectangles the wind field does not explain.

It never calls the backend (the 1-CPU production box) and is never part of the app. It is bundled
by the app's own webpack into `scripts/wind-bench/out/` (gitignored), not into `public/`.

## Run it

From `frontend/`:

```bash
node scripts/wind-bench/run.js --control
node scripts/wind-bench/run.js
node scripts/wind-bench/run.js --ref origin/dev --themes dark
node scripts/wind-bench/run.js --serve
```

| command | what it does | time |
|---|---|---|
| `--control` | the positive control only (2 renders) | ~10 s |
| *(no flags)* | the full matrix: 13 views × 3 themes × 2 variants, plus the control | ~5 min |
| `--ref <git-ref>` | bundle the engine from that commit instead of the working tree, without checking it out | +5 s once per commit |
| `--serve` | serve the page and print its URL, for a browser tab (Claude's browser pane: `preview_start` with that URL) | |

It prints a table, the control verdict and the path of a static `contact-sheet.html`. That sheet
has every view with its variants side by side, and views with artifacts are outlined. The served
page shows the same sheet live: pick a matrix and press **Run**, or add `?auto=control`, `?auto=dark`
or `?auto=full` to the URL.

Other options: `--views fine-z8,fine-z9`, `--themes dark,light`, `--variants shipped,candidate`,
`--frames 180`, `--res 192` (the phone particle pool; desktop is 384), `--real-clock`,
`--gl swiftshader`, `--headed`, `--json <file>`, `--strict` (exit 1 if the candidate has any
artifact anywhere), `--no-control`, `--port`, `--out`.

Exit codes: `0` control PASS, `1` control FAIL, `2` BLIND, a GL error or a crash.

## What it renders

- **Canvas:** 897 × 914 css px (the owner's map pane) at a fixed DPR 2, WebGL2. The camera is
  MapLibre-equivalent Mercator with 512 css px per world tile (`camera.js`).
- **Field** (`field.js`): a climatology of trades, westerlies and smooth perturbations, plus a
  Holland-profile hurricane (vmax 52 kn, rm 0.45°, B 1.6) at -89.5, 25.5. It is point-registered
  at 2° over the world, at 0.25° over -100..-78 / 16..36, and as a 2° clip of that same box.
- **Load order:** the world grid first, then the view's regional grid, as the app does.
- **Frames:** 180 per configuration. The final frame's trail buffer (`engine.screenA.fbo`) is
  read back and scanned.
- **Deterministic:** `Math.random` is seeded per view and theme. A virtual clock advances exactly
  one 60 Hz frame per draw, because `frameTimeScale` reads `performance.now()` and rAF jitter
  otherwise makes every run differ. Both variants of a pair therefore start from the same
  particles, and the same tree gives the same numbers on every run.
  - If two variants come out identical in every view, the table says so. That means the engine
    reads none of the levers that tell them apart: e.g. #281's kill switches on a tree older than
    #281.

## What the columns mean

| column | meaning |
|---|---|
| `ink` | mean max(R,G,B) of the trail buffer, 0-255. The legacy composite's alpha is brightness, so this is what the eye sees. The approved look is about 150. |
| `sat` | share of pixels above 200 (a saturated carpet reads high) |
| `st/sl` | lit-pixel (> 32) brightness of the fastest 5-kn band on screen over the slowest non-calm one. Lit pixels only, so it compares how bright a fast mark is with a slow one, not how many there are. |
| `art` | significant non-calm clusters / their blocks |
| `ms` | mean rAF interval (16.7 = holding 60 fps) |

## The scanner (`scanner.js`, tested by `src/components/map/windBenchScanner.test.js`)

1. **Blocks:** cut the trail buffer into 32 css px blocks. Ink is the mean max-RGB.
2. **Residual:** each block's ink over the median of the blocks 2-4 away (a square ring). The
   near ring is left out so a shape a few blocks wide cannot hide inside its own reference.
3. **Clusters:** residual < 0.72 (HOLE) or > 1.38 (BLOB), joined 4-connected with others of the
   same sign.
4. **Null:** shuffle the same ink across the same blocks 30 times (seeded). The 95th percentile of
   each shuffle's largest cluster is what chance makes, so only bigger clusters are significant.
   Without this, a sparse z10 field showed fake artifacts, and two identical renders disagreed
   (4 vs 7).
5. Clusters slower than 5 kn are **calm** (thin slow air is patchy by nature). Every other
   significant cluster is an **artifact**.

## The positive control

A bench that cannot see a known defect proves nothing when it sees none. Before #281, the casing
pole was applied per pixel on a bilinear grid, so it traced each top-speed contour: inside it,
marks went dark (a HOLE near 44 kn here); just outside it, a ring over-inked (a BLOB near 34 kn).
`__RAW_DISABLE_WIND_FIXED_CASING__` brings that back. Its status is decided at dark z8 on the
0.25° grid:

- **BLIND:** `shipped` lacks either shape (±5 kn), so the scanner is blind and the run is invalid.
- **FAIL:** `candidate` still shows either shape.
- **PASS:** `shipped` shows both shapes and `candidate` shows neither.

Measured 2026-10-09 on an AMD Radeon 890M (D3D11):

| engine | shipped | candidate | verdict |
|---|---|---|---|
| PR #281 head (`ad228735`) | HOLE 40 blocks @ 44.1 kn, BLOB 38 @ 34.4 kn | none | **PASS** |
| `dev` before #281 (`f364efce`) | HOLE 41 @ 44 kn, BLOB 35 @ 35 kn | the same (no kill switches on that tree) | **FAIL** |

## Adding a variant

A variant is a set of window levers applied before the engine is created (`matrix.js`):

```js
const VARIANTS = Object.freeze({
  shipped: { label: '...', levers: { __RAW_DISABLE_WIND_SPEED_KEEP__: true, /* ... */ } },
  candidate: { label: 'engine as written', levers: {} },
  noWideTrails: { label: 'candidate without wide-zoom trails', levers: { __RAW_DISABLE_WIND_WIDE_TRAILS__: true } },
});
```

Then run `node scripts/wind-bench/run.js --variants candidate,noWideTrails`. The page deletes
every `__RAW_*` window key between configurations, so levers never leak.

- **Check the engine reads the lever** (`git grep <lever> frontend/src`). An unread lever is a
  silent no-op, which the "rendered identically" warning catches.
- **To compare two commits** rather than two lever sets, run `--ref` twice. The table rows line up.
- **A new defect class needs its own positive control.** Re-create it with a kill switch, add its
  expected shapes next to `POSITIVE_CONTROL`, and check the shipped side is not BLIND before
  trusting a clean candidate.
- **Changing the field, the canvas or the scanner thresholds starts a new baseline.** Say so in
  the PR.

## Limits

- It is the engine on a synthetic field, not the app. MapLibre, the basemap tiles, real served
  grids and the owner's display are outside it, so a visual change still needs the owner's eyes
  in their browser before it ships.
- `ms` from headless Chromium on a desktop GPU is not a phone. Use `--res 192` for the phone pool,
  but not for phone frame times.
- `--gl swiftshader` (or a machine without a GPU) renders correctly but slowly, and `ms` is then
  meaningless.
