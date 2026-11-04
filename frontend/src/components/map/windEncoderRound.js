/**
 * windEncoderRound.js: the wind texture's u/v bytes ROUND to the nearest code on a zero-aligned lattice. ON by default.
 * Kill: window.__RAW_DISABLE_WIND_ENCODER_ROUND__ = true -> the old floor() bytes and the raw [min, max] range, byte for byte.
 *
 * WHY (L4, 2026-11-02): encodeWindTexture (WebGLWindUtils.js) wrote byte = floor((x - min) / (max - min) * 255) and every shader
 * decodes mix(min, max, byte / 255). Flooring is biased by half a step on average (up to a whole step, range / 255, ~0.5 kn), and
 * for a range straddling zero, calm air lands between two codes: it decoded as about (-range/510, -range/510), a ~0.3 kn breeze
 * toward the south-west, which the particles then drew. Rounding alone halves the worst error but cannot put zero on a code.
 *
 * THE FIX: when min < 0 < max, widen the range by less than one step so zero is EXACTLY code n (n = round(255 * -min / range)):
 * step = max(-min / n, max / (255 - n)), min' = -n step, max' = (255 - n) step. Then round. Calm decodes as 0, every value within
 * half a step, nothing outside the range. The engines read min'/max' from the encoder's return (uMin/uMax), so decode follows.
 * No palette or ramp is touched: the colour field moves by under half a byte step where it moves at all.
 */
export const WIND_ENCODER_ROUND_KILL = '__RAW_DISABLE_WIND_ENCODER_ROUND__';

const winOf = (w) => (w !== undefined ? w : (typeof window !== 'undefined' ? window : null));
export function windEncoderRoundOn(win) { const w = winOf(win); return !(w && w[WIND_ENCODER_ROUND_KILL] === true); }

/** The decode range for [min, max]: unchanged when killed or when zero is outside it, else widened onto a zero-aligned lattice. */
export function windByteRange(min, max, on = windEncoderRoundOn()) {
  if (!on || !(min < 0 && max > 0)) return { min, max };
  const n = Math.min(254, Math.max(1, Math.round((255 * -min) / (max - min))));
  const step = Math.max(-min / n, max / (255 - n));
  return { min: -n * step, max: (255 - n) * step };
}
/** One channel's byte. Killed: floor (and a value at max wraps nowhere: floor(255) = 255, as before). */
export function windByte(x, min, max, on = windEncoderRoundOn()) {
  const t = (x - min) / (max - min);
  return on ? Math.min(255, Math.max(0, Math.round(t * 255))) : Math.floor(t * 255);
}
/** What every shader does with it: mix(min, max, byte / 255). */
export const decodeWindByte = (b, min, max) => min + ((max - min) * b) / 255;
