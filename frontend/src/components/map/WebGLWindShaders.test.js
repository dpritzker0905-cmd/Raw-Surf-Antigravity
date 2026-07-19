import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS,
  HEATMAP_VS,
  HEATMAP_FS,
  SCREEN_VS,
  SCREEN_FS,
  FADE_FS
} from './WebGLWindShaders';

describe('WebGLWindShaders', () => {
  describe('Shader Exports', () => {
    it('should export all shaders as non-empty strings', () => {
      expect(typeof ADVECT_VS).toBe('string');
      expect(ADVECT_VS.length).toBeGreaterThan(0);

      expect(typeof ADVECT_FS).toBe('string');
      expect(ADVECT_FS.length).toBeGreaterThan(0);

      expect(typeof DRAW_VS).toBe('string');
      expect(DRAW_VS.length).toBeGreaterThan(0);

      expect(typeof DRAW_FS).toBe('string');
      expect(DRAW_FS.length).toBeGreaterThan(0);

      expect(typeof HEATMAP_VS).toBe('string');
      expect(HEATMAP_VS.length).toBeGreaterThan(0);

      expect(typeof HEATMAP_FS).toBe('string');
      expect(HEATMAP_FS.length).toBeGreaterThan(0);

      expect(typeof SCREEN_VS).toBe('string');
      expect(SCREEN_VS.length).toBeGreaterThan(0);

      expect(typeof SCREEN_FS).toBe('string');
      expect(SCREEN_FS.length).toBeGreaterThan(0);

      expect(typeof FADE_FS).toBe('string');
      expect(FADE_FS.length).toBeGreaterThan(0);
    });
  });

  describe('Vertex Shader Structure', () => {
    it('should contain expected attributes and uniforms in ADVECT_VS', () => {
      expect(ADVECT_VS).toContain('attribute vec2 a_pos;');
      expect(ADVECT_VS).toContain('varying vec2 v_uv;');
    });

    it('should contain expected attributes and uniforms in DRAW_VS', () => {
      expect(DRAW_VS).toContain('attribute float a_index;');
      expect(DRAW_VS).toContain('uniform sampler2D u_particles;');
      expect(DRAW_VS).toContain('uniform mat4 u_matrix;');
      expect(DRAW_VS).toContain('varying float v_speed;');
    });

    it('should contain expected attributes and uniforms in HEATMAP_VS', () => {
      expect(HEATMAP_VS).toContain('attribute vec2 a_grid_uv;');
      expect(HEATMAP_VS).toContain('uniform mat4 u_matrix;');
    });

    it('should contain expected attributes in SCREEN_VS', () => {
      expect(SCREEN_VS).toContain('attribute vec2 a_pos;');
      expect(SCREEN_VS).toContain('varying vec2 v_uv;');
    });
  });

  describe('Fragment Shader Structure', () => {
    it('should contain precision and sampler declarations in ADVECT_FS', () => {
      expect(ADVECT_FS).toContain('precision highp float;');
      expect(ADVECT_FS).toContain('uniform sampler2D u_particles;');
      expect(ADVECT_FS).toContain('uniform sampler2D u_wind;');
      expect(ADVECT_FS).toContain('vec2 decodePos(vec4 color)');
      expect(ADVECT_FS).toContain('vec4 encodePos(vec2 pos)');
    });

    it('should contain uniform declarations in DRAW_FS', () => {
      expect(DRAW_FS).toContain('precision mediump float;');
      expect(DRAW_FS).toContain('uniform sampler2D u_color_ramp;');
      expect(DRAW_FS).toContain('varying float v_speed;');
    });

    it('should contain expected uniforms in HEATMAP_FS', () => {
      expect(HEATMAP_FS).toContain('precision mediump float;');
      expect(HEATMAP_FS).toContain('uniform sampler2D u_wind;');
      expect(HEATMAP_FS).toContain('uniform float u_max_speed;');
    });

    it('should contain screen texture uniform in SCREEN_FS', () => {
      expect(SCREEN_FS).toContain('precision mediump float;');
      expect(SCREEN_FS).toContain('uniform sampler2D u_screen;');
      expect(SCREEN_FS).toContain('uniform float u_opacity;');
    });

    it('should contain screen texture and fade factor in FADE_FS', () => {
      expect(FADE_FS).toContain('precision mediump float;');
      expect(FADE_FS).toContain('uniform sampler2D u_screen;');
      expect(FADE_FS).toContain('uniform float u_fade;');
    });
  });
});

// === THEME PARITY + LOW-WIND LEGIBILITY (2026-07-18 EVE-3) ===
// User report: wind animations blend into their own heatmap in light/beach, and light winds carry
// no direction cue (needed to see low-pressure systems form). Roots, both proven by inspection:
//  (1) particle colour and field colour sample the SAME ramp at the SAME normalised speed, so they
//      are identical BY CONSTRUCTION — only a luminance separation (rim/core) can break the tie,
//      and the DRAW program was the one wind program never bound to u_theme;
//  (2) that rim/core is a fraction of the sprite, and at synoptic zoom + low speed the sprite is
//      ~2.5 px, making both sub-pixel — while the existing low-speed rescue only fired at zoom>7.
describe('wind theme parity + low-wind legibility', () => {
  it('DRAW_FS receives the theme (the parity gap: it never used to)', () => {
    expect(DRAW_FS).toMatch(/uniform\s+float\s+u_theme\s*;/);
    expect(DRAW_FS).toMatch(/uniform\s+float\s+u_theme_rim\s*;/);
  });

  it('DRAW_FS branches the rim/core on all THREE themes, not just dark', () => {
    expect(DRAW_FS).toMatch(/u_theme\s*>\s*1\.5/);   // beach
    expect(DRAW_FS).toMatch(/u_theme\s*>\s*0\.5/);   // light
  });

  it('LIGHT inverts the rim to a bright halo (a black rim is camouflage on the dark light-ramp)', () => {
    // The light branch must set rimL to a HIGH luminance; dark's legacy pair stays 0.0/1.0.
    const lightBranch = DRAW_FS.slice(DRAW_FS.indexOf('u_theme > 0.5'), DRAW_FS.indexOf('// DARK: unchanged'));
    expect(lightBranch).toMatch(/rimL\s*=\s*1\.0/);
    expect(lightBranch).toMatch(/coreL\s*=\s*0\.0?5/);
  });

  it('the legacy black/white pair is the kill-switch default (u_theme_rim = 0)', () => {
    expect(DRAW_FS).toMatch(/float\s+rimL\s*=\s*0\.0\s*,\s*coreL\s*=\s*1\.0/);
    expect(DRAW_FS).toMatch(/if\s*\(\s*u_theme_rim\s*>\s*0\.5\s*\)/);
  });

  it('DRAW_VS enforces a minimum sprite size for slow winds at ANY zoom', () => {
    expect(DRAW_VS).toMatch(/uniform\s+float\s+u_lowwind_boost\s*;/);
    expect(DRAW_VS).toMatch(/gl_PointSize\s*=\s*max\s*\(\s*gl_PointSize\s*,/);
    // …and it must not be gated behind a close-zoom test the way the old rescue was.
    const boost = DRAW_VS.slice(DRAW_VS.indexOf('u_lowwind_boost > 0.5'));
    expect(boost).not.toMatch(/u_zoom\s*>\s*7\.0/);
  });

  it('the boost is bounded to genuinely slow, genuinely moving air', () => {
    expect(DRAW_VS).toMatch(/v_speed\s*>=\s*0\.15\s*&&\s*v_speed\s*<\s*10\.0/);
  });

  it('shader sources stay single template literals (no stray backticks)', () => {
    for (const src of [DRAW_VS, DRAW_FS, HEATMAP_FS, ADVECT_FS]) {
      expect(src.includes('`')).toBe(false);
    }
  });
});
