import {
  HEATMAP_VS,
  HEATMAP_FS
} from './WebGLMarineShaders';
import {
  ADVECT_VS,
  ADVECT_FS,
  DRAW_VS,
  DRAW_FS
} from './WebGLMarineParticleShaders';

describe('WebGLMarineShaders', () => {
  describe('Vertex Shaders exports', () => {
    it('should export non-empty string vertex shaders', () => {
      expect(typeof ADVECT_VS).toBe('string');
      expect(ADVECT_VS.length).toBeGreaterThan(0);

      expect(typeof DRAW_VS).toBe('string');
      expect(DRAW_VS.length).toBeGreaterThan(0);

      expect(typeof HEATMAP_VS).toBe('string');
      expect(HEATMAP_VS.length).toBeGreaterThan(0);
    });

    it('should contain vertex attribute definitions and matrix uniforms', () => {
      // ADVECT_VS should have attribute a_pos
      expect(ADVECT_VS).toContain('attribute vec2 a_pos;');
      expect(ADVECT_VS).toContain('varying vec2 v_uv;');

      // DRAW_VS should have vertex id attribute and matrix/zoom uniforms
      expect(DRAW_VS).toContain('attribute highp float a_vertex_id;');
      expect(DRAW_VS).toContain('uniform mat4 u_matrix;');
      expect(DRAW_VS).toContain('uniform float u_zoom;');

      // HEATMAP_VS should have grid uv attribute and matrix
      expect(HEATMAP_VS).toContain('attribute highp vec2 a_grid_uv;');
      expect(HEATMAP_VS).toContain('uniform mat4 u_matrix;');
    });
  });

  describe('Fragment Shaders exports', () => {
    it('should export non-empty string fragment shaders', () => {
      expect(typeof ADVECT_FS).toBe('string');
      expect(ADVECT_FS.length).toBeGreaterThan(0);

      expect(typeof DRAW_FS).toBe('string');
      expect(DRAW_FS.length).toBeGreaterThan(0);

      expect(typeof HEATMAP_FS).toBe('string');
      expect(HEATMAP_FS.length).toBeGreaterThan(0);
    });

    it('should contain precision declarations and gl_FragColor assignments', () => {
      // ADVECT_FS checks
      expect(ADVECT_FS).toContain('precision highp float;');
      expect(ADVECT_FS).toContain('gl_FragColor =');
      expect(ADVECT_FS).toContain('uniform sampler2D u_particles;');

      // DRAW_FS checks
      expect(DRAW_FS).toContain('precision mediump float;');
      expect(DRAW_FS).toContain('gl_FragColor =');

      // HEATMAP_FS checks
      expect(HEATMAP_FS).toContain('precision mediump float;');
      expect(HEATMAP_FS).toContain('gl_FragColor =');
      expect(HEATMAP_FS).toContain('uniform sampler2D u_oceanMaskTexture;');
      expect(HEATMAP_FS).toContain('uniform highp float u_lng_offset;');
    });

    it('HEATMAP_FS exposes the BLEND-BOTH height-alpha uniforms (regional-over-coarse composite)', () => {
      expect(HEATMAP_FS).toContain('uniform float u_heightAlphaEnabled;');
      expect(HEATMAP_FS).toContain('uniform float u_heightAlphaLo;');
      expect(HEATMAP_FS).toContain('uniform float u_heightAlphaHi;');
    });

    it('HEATMAP_FS drives the edge feather from u_edgeFeatherWidth (zoom-out clamp softener)', () => {
      expect(HEATMAP_FS).toContain('uniform float u_edgeFeatherWidth;');
      expect(HEATMAP_FS).toContain('smoothstep(0.0, max(u_edgeFeatherWidth, 0.01), minEdgeDist)');
    });

    it('HEATMAP_FS only applies height-alpha when explicitly enabled (default-off → no-op on every other path)', () => {
      // The fade must be guarded by u_heightAlphaEnabled so a default-0 uniform leaves alpha untouched; the
      // factor itself is a smoothstep over displayHeight between the lo/hi bounds.
      expect(HEATMAP_FS).toContain('if (u_heightAlphaEnabled > 0.5)');
      expect(HEATMAP_FS).toMatch(/alpha\s*\*=\s*smoothstep\(u_heightAlphaLo,\s*u_heightAlphaHi,\s*displayHeight\)/);
    });
  });
});
