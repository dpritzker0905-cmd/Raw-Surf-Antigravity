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

  describe('Animation upgrades (§5 #2) — gated, default-off', () => {
    it('DRAW_FS trochoidal crest is gated and warps the across-wave coordinate only when enabled', () => {
      expect(DRAW_FS).toContain('uniform float u_trochoidal;');
      expect(DRAW_FS).toContain('if (u_trochoidal > 0.001)');
      // Default path must keep the symmetric ellipse: acWarp starts as acrossCrest and is only mixed toward
      // the warped profile inside the guard, so u_trochoidal=0 → length(vec2(alongCrest, acrossCrest)) unchanged.
      expect(DRAW_FS).toContain('float acWarp = acrossCrest;');
      expect(DRAW_FS).toContain('float ellipseDist = length(vec2(alongCrest, acWarp));');
    });

    it('DRAW_VS orbital pitch is gated and sways pixel0 along waveDir only when enabled', () => {
      expect(DRAW_VS).toContain('uniform float u_orbitalPitch;');
      expect(DRAW_VS).toContain('if (u_orbitalPitch > 0.0001)');
      expect(DRAW_VS).toContain('pixel0 += waveDir * sin(orbPhase) * u_orbitalPitch * dpr;');
    });

    it('DRAW_VS shoaling foam is gated and samples the bathymetry depthFactor only when enabled', () => {
      expect(DRAW_VS).toContain('uniform sampler2D u_bathTexture;');
      expect(DRAW_VS).toContain('uniform float u_shoalFoam;');
      expect(DRAW_VS).toContain('if (u_shoalFoam > 0.0001)');
      // shelfProximity = 1 - depthFactor (0=deep → no boost, 1=shelf/reef → full boost); whitecap scaled up only.
      expect(DRAW_VS).toContain('float shelfProximity = clamp(1.0 - depthFactor, 0.0, 1.0);');
      expect(DRAW_VS).toContain('v_whitecap *= 1.0 + shelfProximity * u_shoalFoam;');
    });
  });

  describe('Direction-coherence floor — measured on the BILINEAR sample (seam-cull update, 2026-07-02)', () => {
    // The floor moved off length(waveVec): in nearest mode the sampled vector is the cell-center value
    // (magnitude ~1), which made any floor inert exactly where the seam cull is needed. Coherence is now
    // captured from the bilinear sample BEFORE the nearest override (dirCoherence), and the legacy sanity
    // floors (0.005 advect / 0.02 draw) stay as separate literal tests on the ADVECTED vector. A floor
    // uniform of 0.0 keeps the gates byte-equivalent to legacy (dirCoherence < 0.0 is never true).
    it('ADVECT_FS keeps the legacy sanity floor and hard-drops only the seam CORE (half the floor)', () => {
      expect(ADVECT_FS).toContain('uniform float u_dirCoherenceMin;');
      expect(ADVECT_FS).toContain('length(waveVec) < 0.005');
      expect(ADVECT_FS).toContain('dirCoherence < u_dirCoherenceMin * 0.5');
    });

    it('DRAW_VS keeps the legacy sanity floor, hard-discards the seam core, and FADES the edge', () => {
      expect(DRAW_VS).toContain('uniform float u_dirCoherenceMin;');
      expect(DRAW_VS).toContain('length(waveVec) < 0.02');
      expect(DRAW_VS).toContain('dirCoherence < u_dirCoherenceMin * 0.5');
      expect(DRAW_VS).toContain('smoothstep(u_dirCoherenceMin * 0.5, u_dirCoherenceMin, dirCoherence)');
    });
  });
});
