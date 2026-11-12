/**
 * Tap targets in responsiveWeather.css (follow-up to #791, review finding 5).
 *
 * On short screens (max-height: 600px) the Legend toggle is a 24px pill. Its hit area must still
 * be at least 44x44 px: a transparent ::before centred on the button, so the visible layout does not
 * move. jsdom does not lay out CSS, so this pins the stylesheet text itself.
 */
import fs from 'fs';
import path from 'path';

const CSS = fs.readFileSync(path.join(__dirname, 'responsiveWeather.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first `@media (max-height: 600px)` block (brace-balanced). */
function shortScreenBlock(css) {
  const start = css.indexOf('@media (max-height: 600px)');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error('unbalanced @media block');
}

/** Declarations of the rule whose selector ends exactly with `selectorTail`. */
function decls(block, selectorTail) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(block))) {
    if (m[1].trim().endsWith(selectorTail)) {
      return Object.fromEntries(m[2].split(';').map((d) => d.split(':').map((s) => s.trim())).filter((d) => d[0]));
    }
  }
  return null;
}

describe('responsiveWeather.css short-screen tap targets', () => {
  const block = shortScreenBlock(CSS);

  it('the Legend toggle keeps its 24px pill and is positioned for a hit-area overlay', () => {
    const toggle = decls(block, '.weather-legend-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle['min-height']).toBe('24px');      // visible size unchanged
    expect(toggle.position).toBe('relative');        // anchors the ::before
  });

  it('the Legend toggle hit area is at least 44x44 px, centred, and invisible in every theme', () => {
    const hit = decls(block, '.weather-legend-toggle::before');
    expect(hit).not.toBeNull();
    expect(hit.content).toBe('""');
    expect(hit.position).toBe('absolute');
    expect(hit.width).toBe('max(100%, 44px)');
    expect(hit.height).toBe('max(100%, 44px)');
    expect(hit.transform).toBe('translate(-50%, -50%)');
    // no paint: light, dark and beach look exactly as before
    for (const prop of ['background', 'background-color', 'border', 'box-shadow', 'color', 'outline']) {
      expect(hit[prop]).toBeUndefined();
    }
  });

  it('every other short-screen toggle that declares a min-height declares at least 44px', () => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    const small = [];
    while ((m = re.exec(block))) {
      const sel = m[1].trim();
      const mh = /min-height:\s*(\d+)px/.exec(m[2]);
      if (/-toggle$/.test(sel) && mh && Number(mh[1]) < 44 && !sel.endsWith('.weather-legend-toggle')) small.push(sel);
    }
    expect(small).toEqual([]);
  });
});
