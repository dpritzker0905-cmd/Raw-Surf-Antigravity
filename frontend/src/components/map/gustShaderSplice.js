/**
 * GUST SHADER SPLICES for the wind particle draw pass (gustParticles.js has the design; windGustColour.js binds the uniforms).
 * Read ONCE at module load, like the motion fixes' splices (particleRk2.js, particleState.js): with
 * window.__RAW_DISABLE_GUST_PARTICLES__ = true set before the map loads, every piece below is the draw pass's original text,
 * so the wind shaders are byte for byte what they were (motionFixes.killSwitch.test.js pins that with every kill set).
 * On, they add: v_cspeed (the speed a mark is COLOURED by: the gust at its position in gust mode, else the wind's v_speed) and
 * v_flick (the gust flicker, 1.0 outside gust mode). Motion, size, keep and dash keep reading v_speed in every case.
 */
const killed = typeof window !== 'undefined' && window.__RAW_DISABLE_GUST_PARTICLES__ === true;
const on = !killed;

const VS_DECL = `
// GUSTS (gustParticles.js / windGustColour.js): v_cspeed is the speed the mark is COLOURED by: the gust at its position with a
// gust field set, else the wind's own v_speed (so the Wind layer is unchanged). Motion, size, keep and dash stay on v_speed.
uniform float u_gust_on; uniform sampler2D u_gust; uniform vec4 u_gust_box; uniform vec2 u_gust_size; uniform float u_gust_max; varying float v_cspeed;
// GUST FLICKER (windGustColour.gustFlicker): where the gust runs well above the mean wind, the mark's light pulses on its own
// phase, a non-colour cue for gustiness; motion is untouched. u_gust_flick = (on, seconds, Hz, depth); v_flick multiplies alpha.
uniform vec4 u_gust_flick; varying float v_flick;`;

const VS_COLOUR = `
  v_cspeed = v_speed;
  if (u_gust_on > 0.5) {
    // Cell-centred lattice: node 0 at the box's west/south edge, node (n-1) at its east/north edge.
    float gspan = max(u_gust_box.z - u_gust_box.x, 1e-3);
    float gfx = clamp(mod(lng - u_gust_box.x + 720.0, 360.0) / gspan, 0.0, 1.0);
    float gfy = clamp((lat - u_gust_box.y) / max(u_gust_box.w - u_gust_box.y, 1e-3), 0.0, 1.0);
    vec2 guv = (vec2(gfx, gfy) * (u_gust_size - 1.0) + 0.5) / u_gust_size;
    float gb = texture2D(u_gust, guv).r * 255.0;
    if (gb >= 1.0) v_cspeed = (gb - 1.0) / 254.0 * u_gust_max;   // byte 0 = no gust there: keep the wind's speed
  }
  v_flick = 1.0;
  if (u_gust_on > 0.5 && u_gust_flick.x > 0.5) {
    // gust factor G/W: 1.3 (ordinary turbulence) -> 0, 2.2 (very gusty) -> 1; floored wind so calm air cannot blow it up
    float gusty = smoothstep(1.3, 2.2, v_cspeed / max(v_speed, 2.0));
    float phase = rand(uv + vec2(0.711, 0.239)) * 6.2831853;
    v_flick = 1.0 - u_gust_flick.w * gusty * (0.5 + 0.5 * sin(u_gust_flick.y * 6.2831853 * u_gust_flick.z + phase));
  }`;

const FS_DECL = `
varying float v_cspeed;      // the colour speed (DRAW_VS): the gust in gust mode, else v_speed
varying float v_flick;       // gust flicker (DRAW_VS): 1.0 outside gust mode`;

const FS_UNIFORMS = `
uniform float u_gust_on; uniform float u_ramp_max;   // gust mode: the ramp spans 0..u_ramp_max (the gust heatmap's 75 kn)`;

export const GUST_SPLICE = Object.freeze({
  on,
  vsDecl: on ? VS_DECL : '',
  vsColour: on ? VS_COLOUR : '',
  fsDecl: on ? FS_DECL : '',
  fsUniforms: on ? FS_UNIFORMS : '',
  // the colour lookup's speed / ramp top
  fsSpeed: on ? 'v_cspeed / (u_gust_on > 0.5 ? max(u_ramp_max, 1.0) : u_max_speed)' : 'v_speed / u_max_speed',
  // the mark's alpha: the flicker multiplies it (1.0 outside gust mode)
  fsFlick: on ? ' * v_flick;   // v_flick: 1.0 outside gust mode' : ';',
});
