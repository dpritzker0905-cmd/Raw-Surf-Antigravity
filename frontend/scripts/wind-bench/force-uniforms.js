/**
 * Wind bench: ONE VARIABLE AT A TIME. Force a uniform of one of the real engine's programs for the length of a run.
 *
 * A lever in the app usually moves several things together (the white streak's kill also moves the field, the land's depth and both
 * paths), so "which of these makes the difference?" cannot be asked with levers alone. This holds the real engine, its real shaders
 * and every default exactly as they are and replaces ONE value on its way to the GPU: a run's `force` in motion-run.js's runs.json,
 *
 *     "force": { "screen.u_glow@map": 0, "draw.u_white": [1, 1], "draw.u_single_casing": 1 }
 *
 * A key is `<program>.<uniform>` with an optional `@map` (only while the map's own framebuffer is bound: the field and the
 * composite) or `@buffer` (only while one of the engine's own framebuffers is). The screen program is used twice a frame, once to
 * copy the trail buffer and once to lay it on the map: `screen.u_glow@map` is the composite alone. Programs: advect, draw, fade,
 * heatmap, screen (the engine's `<name>Program`). A value is a number (uniform1f) or two to four numbers (uniform2f .. uniform4f).
 *
 * Bench only, never the app: nothing under src/ reads this. `hits` in the result counts how often each key replaced a value; a key
 * that never fired stops the run (a misspelt uniform would otherwise be a run that silently measured the default).
 *
 * TWO LIMITS (the independent review, 2026-10-12):
 *   - `@map` and `@buffer` are judged when the value is SENT, not when a draw uses it. The screen, fade and draw programs send
 *     their uniforms with their own framebuffer already bound; the advect program sends its before it binds its buffer, so an
 *     advect uniform takes no suffix (`advect.u_speed_scale@buffer` never fires and stops the run).
 *   - A forced value stays in its program until the engine sends that uniform again. The buffer's copy re-sends `u_opacity`, `u_glow`,
 *     `u_ink_cap` and the trail's camera each frame, so `screen.u_glow@map` is the composite's alone; it does not re-send
 *     `u_premul`, `u_ink` or `u_trail_veil`, so one of those forced `@map` would be read by the next frame's copy too. Check that the
 *     pass you do not mean to touch re-sends the uniform.
 */
const SETTERS = ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f'];

/** { program, uniform, when, value: number[] } of each key, or an Error naming the first bad one. */
function parseForce(spec) {
  return Object.keys(spec || {}).map((key) => {
    const m = /^([a-z]+)\.([A-Za-z_][A-Za-z0-9_]*)(?:@(map|buffer))?$/.exec(key), v = spec[key];
    const value = typeof v === 'number' ? [v] : (Array.isArray(v) ? v.slice() : null);
    if (!m || !value || value.length < 1 || value.length > 4 || !value.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`not a forced uniform: ${key} = ${JSON.stringify(v)}`);
    return { key, program: m[1], uniform: m[2], when: m[3] || 'any', value };
  });
}

/**
 * Install the forces on `gl` for `engine` (its `<name>Program`s and its own framebuffers: screenA, screenB, advFBO).
 * Returns { hits: { key: count }, restore() }. Every other call on `gl` (the map's own included) passes through untouched.
 */
function forceUniforms(gl, engine, spec) {
  const forces = parseForce(spec), hits = {}, byProgram = new Map(), locs = new WeakMap();
  for (const f of forces) {
    const prog = engine && engine[`${f.program}Program`];
    if (!prog) throw new Error(`no program "${f.program}" on the engine (advect, draw, fade, heatmap, screen): ${f.key}`);
    if (!byProgram.has(prog)) byProgram.set(prog, {});
    (byProgram.get(prog)[f.uniform] = byProgram.get(prog)[f.uniform] || []).push(f); hits[f.key] = 0;
  }
  const real = { getUniformLocation: gl.getUniformLocation };
  const own = () => {   // is one of the engine's own framebuffers bound?
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const mine = [engine.screenA && engine.screenA.fbo, engine.screenB && engine.screenB.fbo, engine.advFBO].filter(Boolean);   // the trail buffers exist only after the first frame
    return !!fb && mine.includes(fb);
  };
  gl.getUniformLocation = function (prog, name) {
    const loc = real.getUniformLocation.call(gl, prog, name), named = byProgram.get(prog);
    if (loc && named && named[name]) locs.set(loc, named[name]);
    return loc;
  };
  for (const s of SETTERS) {
    real[s] = gl[s];
    gl[s] = function (loc, ...v) {
      const fs = loc && locs.get(loc);
      if (fs) for (const f of fs) if (f.value.length === v.length && (f.when === 'any' || (f.when === 'buffer') === own())) { hits[f.key]++; return real[s].call(gl, loc, ...f.value); }
      return real[s].call(gl, loc, ...v);
    };
  }
  return {
    hits,
    restore() { for (const k of Object.keys(real)) { if (Object.prototype.hasOwnProperty.call(gl, k)) delete gl[k]; if (gl[k] !== real[k]) gl[k] = real[k]; } },
  };
}

module.exports = { parseForce, forceUniforms };
