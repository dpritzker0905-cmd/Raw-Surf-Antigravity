/**
 * R11-11 item 3 — legend numbers vs legend colours.
 *
 * The gradient places each colour at its VALUE position (buildGradientCSS), the labels were laid
 * out evenly (`flex justify-between`). These tests pin the real breakpoint arrays that ship, so a
 * future scale change cannot quietly re-open the gap.
 */
import { valueTicks, evenTicks, dropCollisions, tickTransform } from './legendTicks';

// The scales that actually render the value-proportional gradient. `fog` and `radar` are NOT here:
// they are overridden by hardcoded static legends AFTER the data-driven loop in MapWeatherControls,
// so their breakpoints never reach a bar (measuring them was a false alarm on the way to this fix).
const RAIN = [0, 0.1, 0.5, 2.0, 6.0, 15.0, 30.0, 60.0];
const WAVES = [0, 0.61, 1.22, 2.44, 3.66, 6.1];
const PRESSURE = [970, 990, 1005, 1009, 1013, 1018, 1025, 1045];

const pctOf = (ticks, label) => ticks.find((t) => t.label === label).pct;

describe('valueTicks — a label sits where its colour sits', () => {
  it('reproduces buildGradientCSS positions exactly (same formula, or the fix is a new lie)', () => {
    const t = valueTicks(RAIN, (v) => String(v));
    // (bp - min) / range * 100, range = 60
    expect(pctOf(t, '0')).toBeCloseTo(0, 6);
    expect(pctOf(t, '6')).toBeCloseTo(10, 6);
    expect(pctOf(t, '30')).toBeCloseTo(50, 6);
    expect(pctOf(t, '60')).toBeCloseTo(100, 6);
  });

  it('THE DEFECT, quantified: rain\'s "6" was 47 pp from its own colour', () => {
    const t = valueTicks(RAIN, (v) => String(v));
    const evenPct = (4 / (RAIN.length - 1)) * 100;      // where flex justify-between put it
    expect(evenPct).toBeCloseTo(57.14, 1);
    expect(pctOf(t, '6')).toBeCloseTo(10, 6);
    expect(Math.abs(evenPct - pctOf(t, '6'))).toBeGreaterThan(45);
  });

  it('every rendered scale is now within 0 pp of its colour, by construction', () => {
    for (const bp of [RAIN, WAVES, PRESSURE]) {
      const min = bp[0], range = bp[bp.length - 1] - min;
      valueTicks(bp, (v) => String(v)).forEach((tick, i) => {
        expect(tick.pct).toBeCloseTo(((bp[i] - min) / range) * 100, 6);
      });
    }
  });

  it('ends anchor at 0 and 100 for every scale', () => {
    for (const bp of [RAIN, WAVES, PRESSURE]) {
      const t = valueTicks(bp, (v) => String(v));
      expect(t[0].pct).toBe(0);
      expect(t[t.length - 1].pct).toBe(100);
    }
  });

  it('survives a degenerate scale without dividing by zero', () => {
    expect(valueTicks([5, 5], (v) => String(v)).map((t) => t.pct)).toEqual([0, 0]);
    expect(valueTicks([], (v) => String(v))).toEqual([]);
    expect(valueTicks(null)).toEqual([]);
  });

  it('passes index and isLast to the formatter (the "60+" suffix depends on it)', () => {
    const t = valueTicks(WAVES, (v, i, isLast) => (isLast ? `${v}+` : `${v}`));
    expect(t[t.length - 1].label).toBe('6.1+');
    expect(t[0].label).toBe('0');
  });
});

describe('evenTicks — the hand-authored gradients were already right', () => {
  it('spaces labels evenly, matching CSS default colour distribution', () => {
    expect(evenTicks(['a', 'b', 'c']).map((t) => t.pct)).toEqual([0, 50, 100]);
  });
  it('handles the degenerate cases', () => {
    expect(evenTicks(['only']).map((t) => t.pct)).toEqual([0]);
    expect(evenTicks([])).toEqual([]);
  });
});

describe('dropCollisions — precise AND readable, or the fix trades one wrongness for another', () => {
  it('THE TRAP: pressure clusters 1005/1009/1013 within ~11 pp and would overlap', () => {
    const t = valueTicks(PRESSURE, (v) => String(v));
    const gaps = t.slice(1).map((x, i) => x.pct - t[i].pct);
    expect(Math.min(...gaps)).toBeLessThan(12);          // the collision is real, not hypothetical
    const kept = dropCollisions(t, 12);
    kept.slice(1).forEach((x, i) => {
      expect(x.pct - kept[i].pct).toBeGreaterThanOrEqual(12 - 1e-9);
    });
  });

  it('ALWAYS keeps the first and last — the ends anchor the whole scale', () => {
    for (const bp of [RAIN, WAVES, PRESSURE]) {
      const kept = dropCollisions(valueTicks(bp, (v) => String(v)), 12);
      expect(kept[0].pct).toBe(0);
      expect(kept[kept.length - 1].pct).toBe(100);
    }
  });

  it('evicts a kept tick rather than crowd the last one', () => {
    // 0, 95, 100: keeping 95 would leave a 5 pp gap before the end, so 95 must go.
    const kept = dropCollisions([{ label: 'a', pct: 0 }, { label: 'b', pct: 95 },
                                 { label: 'c', pct: 100 }], 12);
    expect(kept.map((k) => k.label)).toEqual(['a', 'c']);
  });

  it('keeps everything when nothing collides (rain and waves are already well spread)', () => {
    expect(dropCollisions(valueTicks(WAVES, (v) => String(v)), 5).length).toBe(WAVES.length);
  });

  it('never returns fewer than the two anchors', () => {
    expect(dropCollisions([{ label: 'a', pct: 0 }, { label: 'b', pct: 1 }], 50).length).toBe(2);
    expect(dropCollisions([{ label: 'solo', pct: 0 }], 12).length).toBe(1);
  });
});

describe('tickTransform — the end labels stay inside the bar', () => {
  it('anchors the ends and centres the rest', () => {
    expect(tickTransform(0)).toBe('translateX(0)');
    expect(tickTransform(100)).toBe('translateX(-100%)');
    expect(tickTransform(50)).toBe('translateX(-50%)');
  });
});
