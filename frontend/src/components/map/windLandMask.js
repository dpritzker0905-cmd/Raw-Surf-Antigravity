/**
 * windLandMask.js — the land under each wind mark (dark's rules, rule 4: windDarkRules.js).
 *
 * Dark's land and sea are both near black, so one streak colour per speed serves both. Light's and beach's sea is far darker
 * than their land under the tint, so a streak solved for land washes the sea (the Ground Truth lab: +24 L* and the picture ending
 * at L* 75 over light's sea). The marks therefore read a land mask and mix the LUT's land row and sea row by it (DRAW_FS).
 *
 * The mask is the app's own Natural Earth 1:50m land (public/ne_50m_land.json, the fallback basemap's), drawn once into a
 * 2048 x 2048 Web Mercator texture: a texel is 20 km at the equator, so the hand-over between rows sits within a few device
 * pixels of the coast at zoom 6 and spreads to about 30 px at zoom 8 (a known limit; the coast is drawn by the basemap, not this).
 * It loads only when a theme draws dark's rules; until it is ready, or if it cannot load, every mark draws its land row
 * (at the SEA's strength where the land is drawn a step above the sea: bindLandMask).
 * WHAT THE BUILD COSTS: no frame waits for it (a 1 x 1 stand-in is bound until it is ready), but the build itself is ONE task on the
 * main thread, started in an idle period where the browser has them: 1,420 polygons drawn into a 2048 px canvas, 16.8 MB read back,
 * 4.2 M texels copied and uploaded. `ms` in the read-back says how long it held the thread on this device. It reuses the land the
 * page has already parsed (mapUtils getSharedLandGeoJSON) rather than fetch and parse the 2.8 MB file again.
 * A failed load is tried again, at most MAX_TRIES times, 20 s and then 40 s apart: one bad fetch on a weak signal must not cost the
 * sea its rows until reload, and a file that is not there must not be asked for forever.
 *
 * Read-back: window.__WIND_LAND_MASK__ = { status: 'loading' | 'ready' | 'failed', size, at, tries, ms?, reason? }, set when the state
 * changes (never per frame). 'ready' is the only state in which a mark over the sea draws its sea row.
 */
import { bindTexture } from './WebGLWindUtils';
import { windLandStepOn } from './windBasemapMute';

export const LAND_MASK_SIZE = 2048;
const MAX_TRIES = 3, RETRY_MS = 20000;

/** DRAW_FS's declarations (inlined into its uniform line, so it starts on a line of its own for the precision guard). */
export const GLSL_LAND_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define LAND_HP highp
#else
#define LAND_HP mediump
#endif
uniform sampler2D u_land_mask; uniform float u_land_on; uniform vec2 u_white; uniform vec4 u_calm; varying LAND_HP vec2 v_world;   // windLandMask.js; u_white: the mark's light level over land (x) and over sea (y); u_calm: how far it falls in near-calm air (windCalmAir.js)
`;

const STATE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

export function landMaskUrl(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const origin = w && w.location ? w.location.origin : '';
  return `${origin}${process.env.PUBLIC_URL || ''}/ne_50m_land.json`;
}

/** Web Mercator y in [0, 1], north at 0 (DRAW_VS's latToMercatorY). */
export function mercatorY(lat) {
  const r = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

/** Draw a GeoJSON land collection into a size x size mercator mask (one byte a texel, 255 = land). */
export function rasterizeLand(geojson, size, makeCanvas) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  const ring = (pts) => { pts.forEach((p, i) => { const x = (p[0] + 180) / 360 * size, y = mercatorY(p[1]) * size; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
  for (const f of (geojson && geojson.features) || []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    for (const poly of polys) { ctx.beginPath(); poly.forEach(ring); ctx.fill('evenodd'); }
  }
  const rgba = ctx.getImageData(0, 0, size, size).data, out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

// The mask is uploaded outside the engine's frame (an idle callback), where the unpack state is whatever the map or another layer
// left: the row order is pinned here (a flipped mask would lay the Arctic's rows on the Southern Ocean) and everything is put back.
function texture(gl, size, bytes, repeat) {
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D), tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const align = gl.getParameter(gl.UNPACK_ALIGNMENT), flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, size, size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, align); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
  gl.bindTexture(gl.TEXTURE_2D, prev);
  return tex;
}

function publish(w, st, status, extra) {
  if (w) w.__WIND_LAND_MASK__ = Object.assign({ status, size: LAND_MASK_SIZE, at: Date.now(), tries: st.tries }, extra || {});
}

function load(gl, st, win) {
  st.loading = true; st.failed = false; st.tries++;
  const w = win || (typeof window !== 'undefined' ? window : null);
  const fail = (e) => { st.failed = true; st.retryAt = Date.now() + RETRY_MS * st.tries; publish(w, st, 'failed', { reason: String((e && e.message) || e) }); };
  if (!w || typeof w.fetch !== 'function' || typeof document === 'undefined') { st.tries = MAX_TRIES; fail('no fetch'); return; }
  publish(w, st, 'loading');
  // The page's own copy first (parsed once for the ocean mask and the fallback basemap), on the first try only: a retry asks the file itself.
  const shared = st.tries === 1 ? (w.__LAND_GEOJSON_CACHE__ || w.__LAND_GEOJSON_PROMISE__) : null;
  const land = shared ? Promise.resolve(shared) : w.fetch(landMaskUrl(w)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`land mask ${r.status}`))));
  land.then((geo) => {
    const run = () => {
      if (STATE.get(gl) !== st || (gl.isContextLost && gl.isContextLost())) return;   // the context was lost or came back meanwhile: this load was the old one's
      let canvas = null;
      try {
        if (!geo || !Array.isArray(geo.features) || !geo.features.length) throw new Error('land mask: no land in the file');   // an all-sea mask would lay sea rows on every continent
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (max && max < LAND_MASK_SIZE) throw new Error(`land mask: this device's largest texture is ${max} px`);
        const t0 = Date.now();
        const bytes = rasterizeLand(geo, LAND_MASK_SIZE, (n) => { canvas = document.createElement('canvas'); canvas.width = n; canvas.height = n; return canvas; });
        st.tex = texture(gl, LAND_MASK_SIZE, bytes, true); st.ready = true; publish(w, st, 'ready', { ms: Date.now() - t0 });
      } catch (e) { fail(e); }
      if (canvas) { canvas.width = 0; canvas.height = 0; }   // let the 16 MB backing store go (canvas memory is capped on phones)
    };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 2000 }); else setTimeout(run, 0);
  }).catch(fail);
}

/**
 * Bind the land mask for DRAW_FS on texture `unit`: u_land_on = 1 only when `on` and the mask is ready (a 1 x 1 land texel is
 * bound otherwise, so the sampler always has a texture). Starts the one-time load the first time `on` is asked for.
 * The bind goes through the engine's own bindTexture, which keeps a record of the active unit: a raw activeTexture here would leave
 * that record wrong, and the engine's next bind would land on another unit.
 */
export function bindLandMask(gl, prog, unit, on, win, white, theme) {
  if (!gl || !prog || !STATE) return;
  let st = STATE.get(gl);
  // A restored context keeps its object and loses its textures, and the engine rebuilds its programs then: a new program is the
  // moment to ask the driver (once, never per frame). Dead textures mean a fresh start, the mask loaded anew.
  if (st && st.prog !== prog && typeof gl.isTexture === 'function' && !gl.isTexture(st.blank)) st = null;
  if (!st) { st = { tex: null, blank: texture(gl, 1, new Uint8Array([255]), false), loading: false, ready: false, failed: false, tries: 0, retryAt: 0 }; STATE.set(gl, st); }
  st.prog = prog;
  if (on && (!st.loading || (st.failed && st.tries < MAX_TRIES && Date.now() >= st.retryAt))) load(gl, st, win);
  const ready = !!(on && st.ready);
  bindTexture(gl, ready ? st.tex : st.blank, unit);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_land_mask'), unit);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_land_on'), ready ? 1 : 0);
  // DARK'S WHITE (windDarkRules.js DARK_WHITE): the mark's light level over land and over sea. The screen pass lays a trail at its
  // level SQUARED, so a strength (the share of full) is carried as its square root. Without a ready mask every mark reads as land:
  // where the land is drawn a STEP above the sea (windBasemapMute.js WIND_LAND_STEP) that would lay the land's stronger streak over
  // the sea, most of a view, until the mask is in, so both grounds take the sea's until then (as they did at the sea's depth).
  const blind = !ready && !!white && windLandStepOn(theme, win || (typeof window !== 'undefined' ? window : null));
  gl.uniform2f(gl.getUniformLocation(prog, 'u_white'), Math.sqrt(white ? (blind ? white.sea : white.land) : 1), Math.sqrt(white ? white.sea : 1));
}
