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

  describe('Direction-coherence seam DIM — measured on the BILINEAR sample (dead-zone fix, 2026-07-03)', () => {
    // Coherence is captured from the bilinear sample BEFORE the nearest override (dirCoherence). The
    // 2026-07-02 seam CULL (advect core-drop + draw core-discard + zero-alpha fade) made divergence
    // hotspots a band-wide crest DEAD ZONE (Baja live report: neighbor rows 177° apart → coherence ~0
    // across a strip degrees wide). Crests now only DIM to u_seamFadeFloor — no coherence-based drop
    // or discard anywhere. Legacy sanity floors (0.005 advect / 0.02 draw) stay.
    it('ADVECT_FS keeps the legacy sanity floor, never drops on coherence, and damps drift in confused seas', () => {
      expect(ADVECT_FS).toContain('uniform float u_dirCoherenceMin;');
      expect(ADVECT_FS).toContain('length(waveVec) < 0.005');
      expect(ADVECT_FS).not.toContain('dirCoherence < u_dirCoherenceMin');
      // Confused-sea damping: the nearest-cell heading is a coin-flip between opposing systems at a
      // seam — drift slows toward the core instead of streaming confidently the wrong way.
      expect(ADVECT_FS).toContain('offset *= mix(0.35, 1.0, smoothstep(0.0, u_dirCoherenceMin, dirCoherence));');
    });

    it('DRAW_VS keeps the legacy sanity floor and DIMS the seam two-segment (never discards)', () => {
      expect(DRAW_VS).toContain('uniform float u_dirCoherenceMin;');
      expect(DRAW_VS).toContain('uniform float u_seamFadeFloor;');
      expect(DRAW_VS).toContain('length(waveVec) < 0.02');
      expect(DRAW_VS).not.toContain('dirCoherence < u_dirCoherenceMin');
      // Mild seams dim to the floor; only the thin anti-parallel core line approaches invisible.
      expect(DRAW_VS).toContain('float seamT = smoothstep(u_dirCoherenceMin * 0.5, u_dirCoherenceMin, dirCoherence);');
      expect(DRAW_VS).toContain('float coreT = smoothstep(0.0, u_dirCoherenceMin * 0.5, dirCoherence);');
      expect(DRAW_VS).toContain('v_alpha *= mix(u_seamFadeFloor * coreT, 1.0, seamT);');
    });
  });
});

describe('DRAW_VS ribbon-endpoint land fade (2026-07-04, dashes crossing Venice/Lido)', () => {
  it('is gated on u_endpointLandFade and fades the corner alpha by the ribbon-END ocean flag', () => {
    expect(DRAW_VS).toContain('uniform float u_endpointLandFade;');
    expect(DRAW_VS).toContain('if (u_endpointLandFade > 0.5)');
    // Samples the SAME mask sampler the center cull uses, at the corner endpoint uv.
    expect(DRAW_VS).toContain('float endFlag = texture2D(u_oceanMaskTexture, vec2(end_u, end_v)).r;');
    // Fades alpha (dissolve toward land) instead of hard-discarding the whole ribbon.
    expect(DRAW_VS).toContain('v_alpha *= smoothstep(0.20, 0.45, endFlag);');
    // Endpoint is derived from the along-crest pixel offset inverted back to mercator.
    expect(DRAW_VS).toContain('vec2 pxDelta = crestDir * (deviceHalfLength * cornerUV.x);');
  });

  it('keeps the legacy center cull intact (endpoint fade is additive, not a replacement)', () => {
    expect(DRAW_VS).toContain('oceanFlag < 0.3');
  });
});
