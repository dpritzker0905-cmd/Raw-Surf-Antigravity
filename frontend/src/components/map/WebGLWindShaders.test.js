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
