/**
 * GUST SHADER SPLICES for the wind particle draw pass (gustParticles.js has the design; windGustColour.js binds the uniforms).
 * Read ONCE at module load, like the motion fixes' splices (particleRk2.js, particleState.js): with
 * window.__RAW_DISABLE_GUST_PARTICLES__ = true set before the map loads, every piece below is the draw pass's original text,
 * so the wind shaders are byte for byte what they were (motionFixes.killSwitch.test.js pins that with every kill set).
 * On, they add: v_cspeed (the speed a mark is COLOURED by: the gust at its position in gust mode, else the wind's v_speed) and
 * v_flick (the gust flicker, 1.0 outside gust mode). Motion, size, keep and dash keep reading v_speed in every case.
 */
// CURRENTS (2026-11-22, currentParticles.js) ride the same splices (their colour / sea texture is this path's u_gust): the text is
// present unless BOTH layers' particle kills are set, so either kill alone leaves the other layer working, and every kill
// together still draws dev's shaders byte for byte.
const killed = typeof window !== 'undefined' && window.__RAW_DISABLE_GUST_PARTICLES__ === true
  && window.__RAW_DISABLE_CURRENT_PARTICLES__ === true;
const on = !killed;

const VS_DECL = `
// GUSTS (gustParticles.js / windGustColour.js): v_cspeed is the speed the mark is COLOURED by: the gust at its position with a
// gust field set, else the wind's own v_speed (so the Wind layer is unchanged). Motion, size, keep and dash stay on v_speed.
uniform float u_gust_on; uniform sampler2D u_gust; uniform vec4 u_gust_box; uniform vec2 u_gust_size; uniform float u_gust_max; varying float v_cspeed;
// GUST FLICKER (windGustColour.gustFlicker): where the gust runs well above the mean wind, the mark's light pulses on its own
// phase, a non-colour cue for gustiness; motion is untouched. u_gust_flick = (on, seconds, Hz, depth); v_flick multiplies alpha.
uniform vec4 u_gust_flick; varying float v_flick;
// GUST WIDTH (A/B cue 'width', windGustColour.gustCue): where G/W runs 1.5 -> 2.0 the mark is drawn up to 1.8x WIDER across the
// flow (static; length, which reads as speed, and motion are untouched). v_bold divides DRAW_FS's across-wind squash.
uniform float u_gust_bold; varying float v_bold;
// CURRENTS (currentParticles.js): u_gust_sea = 1 hides a mark where the colour texture has no data (land): ocean only.
uniform float u_gust_sea;`;

const VS_COLOUR = `
  v_cspeed = v_speed; float gb = 255.0;
  if (u_gust_on > 0.5) {
    // Cell-centred lattice: node 0 at the box's west/south edge, node (n-1) at its east/north edge.
    float gspan = max(u_gust_box.z - u_gust_box.x, 1e-3);
    float gfx = clamp(mod(lng - u_gust_box.x + 720.0, 360.0) / gspan, 0.0, 1.0);
    float gfy = clamp((lat - u_gust_box.y) / max(u_gust_box.w - u_gust_box.y, 1e-3), 0.0, 1.0);
    vec2 guv = (vec2(gfx, gfy) * (u_gust_size - 1.0) + 0.5) / u_gust_size;
    gb = texture2D(u_gust, guv).r * 255.0;
    if (gb >= 1.0) v_cspeed = (gb - 1.0) / 254.0 * u_gust_max;   // byte 0 = no gust there: keep the wind's speed
  }
  v_flick = 1.0;
  if (u_gust_on > 0.5 && u_gust_flick.x > 0.5) {
    // gust factor G/W: 1.3 (ordinary turbulence) -> 0, 2.2 (very gusty) -> 1; floored wind so calm air cannot blow it up
    float gusty = smoothstep(1.3, 2.2, v_cspeed / max(v_speed, 2.0));
    float phase = rand(uv + vec2(0.711, 0.239)) * 6.2831853;
    v_flick = 1.0 - u_gust_flick.w * gusty * (0.5 + 0.5 * sin(u_gust_flick.y * 6.2831853 * u_gust_flick.z + phase));
  }
  v_bold = 1.0;
  if (u_gust_on > 0.5 && u_gust_bold > 0.5) v_bold = 1.0 + 0.8 * smoothstep(1.5, 2.0, v_cspeed / max(v_speed, 2.0));
  if (u_gust_on > 0.5 && u_gust_sea > 0.5 && gb < 1.0) v_flick = 0.0;   // currents: no water here (land), no mark`;

const FS_DECL = `
varying float v_cspeed;      // the colour speed (DRAW_VS): the gust in gust mode, else v_speed
varying float v_flick;       // gust flicker (DRAW_VS): 1.0 outside gust mode
varying float v_bold;        // gust width (DRAW_VS): 1.0 unless the 'width' cue widens a gusty mark`;

// The fragment stage has its OWN switch: a uniform declared in both stages must match precision, and the vertex default is
// highp while this pass is mediump ("Precisions of uniform 'u_gust_on' differ" failed the link and dropped the whole wind
// layer to its Canvas2D fallback in the browser check, 2026-11-18). No gust uniform is shared between the two stages.
const FS_UNIFORMS = `
uniform float u_gust_fs; uniform float u_ramp_max;   // gust mode (fragment's own switch): the ramp spans 0..u_ramp_max (75 kn)`;

export const GUST_SPLICE = Object.freeze({
  on,
  vsDecl: on ? VS_DECL : '',
  vsColour: on ? VS_COLOUR : '',
  fsDecl: on ? FS_DECL : '',
  fsUniforms: on ? FS_UNIFORMS : '',
  // the colour lookup's speed / ramp top
  fsSpeed: on ? 'v_cspeed / (u_gust_fs > 0.5 ? max(u_ramp_max, 1.0) : u_max_speed)' : 'v_speed / u_max_speed',
  // the mark's alpha: the flicker multiplies it (1.0 outside gust mode)
  fsFlick: on ? ' * v_flick;   // v_flick: 1.0 outside gust mode' : ';',
  // after the dash's across-wind squash: divided by v_bold (1.0 unless the 'width' cue widens a gusty mark)
  fsBold: on ? '\n    localCoord.y /= v_bold;   // gust width (the A/B cue): a gusty mark widens across the flow; 1.0 otherwise' : '',
});
