/**
 * WebGLSynchronizedOverlay.js
 * Synchronized standalone WebGL canvas overlay absolute-positioned over MapLibre.
 * Bypasses MapLibre's rendering bugs, custom protocols, and state conflicts.
 * Maintains perfect coordination with MapLibre's camera matrix.
 */
import React, { useEffect, useRef, useState } from 'react';
import WebGLWindEngine from './WebGLWindEngine';
import WebGLMarineEngine from './WebGLMarineEngine';

export function WebGLSynchronizedOverlay({ mapInstance, activeLayers, windData, marineData, theme }) {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const windEngineRef = useRef(null);
  const marineEngineRef = useRef(null);
  const animationFrameRef = useRef(null);

  const activeLayersRef = useRef(activeLayers);
  const windDataRef = useRef(windData);
  const marineDataRef = useRef(marineData);
  const themeRef = useRef(theme);

  useEffect(() => { activeLayersRef.current = activeLayers; }, [activeLayers]);
  useEffect(() => { windDataRef.current = windData; }, [windData]);
  useEffect(() => { marineDataRef.current = marineData; }, [marineData]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Handle canvas resizing to match map container exactly
  useEffect(() => {
    if (!mapInstance) return;
    const canvas = mapInstance.getCanvas();
    const updateSize = () => {
      setDimensions({
        width: canvas.clientWidth,
        height: canvas.clientHeight
      });
    };
    
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, [mapInstance]);

  // Handle WebGL initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      depth: false,
      stencil: false
    });

    if (!gl) {
      console.error('[WebGLOverlay] Failed to create WebGL context');
      return;
    }
    glRef.current = gl;

    // Instantiate and initialize engines
    const windEngine = new WebGLWindEngine();
    const marineEngine = new WebGLMarineEngine();

    const isMobile = window.innerWidth < 768;
    windEngine.particleRes = isMobile ? 40 : 50; // 50x50 = 2500 density
    marineEngine.particleRes = isMobile ? 40 : 50; // 50x50 = 2500 density

    windEngine.init(gl);
    marineEngine.init(gl);
    try {
      windEngine.setTheme(gl, themeRef.current);
    } catch (e) {
      console.error('[WebGLOverlay] Failed to set initial theme:', e);
    }

    windEngineRef.current = windEngine;
    marineEngineRef.current = marineEngine;

    console.log('[WebGLOverlay] Standalone WebGL engines initialized');

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      windEngine.dispose(gl);
      marineEngine.dispose(gl);
      glRef.current = null;
      windEngineRef.current = null;
      marineEngineRef.current = null;
    };
  }, [dimensions.width, dimensions.height]);

  // Handle theme changes to update color ramps dynamically
  useEffect(() => {
    const gl = glRef.current;
    const windEngine = windEngineRef.current;
    if (gl && windEngine) {
      try {
        windEngine.setTheme(gl, theme);
      } catch (e) {
        console.error('[WebGLOverlay] setTheme error:', e);
      }
    }
  }, [theme]);

  // Bind new data to textures when received
  useEffect(() => {
    const gl = glRef.current;
    const windEngine = windEngineRef.current;
    if (gl && windEngine && windData?.vectors?.length) {
      try {
        windEngine.setWindData(gl, windData);
      } catch (e) {
        console.error('[WebGLOverlay] setWindData error:', e);
      }
    }
  }, [windData]);

  useEffect(() => {
    const gl = glRef.current;
    const marineEngine = marineEngineRef.current;
    if (gl && marineEngine && (marineData?.vectors?.length || marineData?.grid?.vectors?.length)) {
      try {
        const marineLayerNames = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
        // Use first matching active layer, fall back to 'waves' so marine always renders
        const activeMarine = marineLayerNames.find(l => activeLayersRef.current?.includes(l)) || 'waves';
        const rawVectors = marineData.vectors || marineData.grid?.vectors || [];
        const formattedGrid = {
          bounds: marineData.bounds || marineData.grid?.bounds,
          cols: marineData.cols || marineData.grid?.cols,
          rows: marineData.rows || marineData.grid?.rows,
          vectors: rawVectors.map(v => {
            const hasSub = activeMarine !== 'waves' && v[activeMarine];
            const sub = hasSub ? v[activeMarine] : {};
            return {
              lat: v.lat,
              lng: v.lng,
              u: hasSub && typeof sub.u === 'number' ? sub.u : (typeof v.u === 'number' ? v.u : 0),
              v: hasSub && typeof sub.v === 'number' ? sub.v : (typeof v.v === 'number' ? v.v : 0),
              speed: hasSub && typeof sub.speed === 'number' ? sub.speed : (typeof v.speed === 'number' ? v.speed : 0),
              period: hasSub && typeof sub.period === 'number' ? sub.period : (typeof v.period === 'number' ? v.period : 0),
              isOcean: hasSub && sub.isOcean !== undefined ? sub.isOcean : (v.isOcean !== undefined ? v.isOcean : true)
            };
          })
        };
        if (formattedGrid.vectors.some(v => v.speed > 0)) {
          marineEngine.setWaveData(gl, formattedGrid);
        }
      } catch (e) {
        console.error('[WebGLOverlay] setWaveData error:', e);
      }
    }
  }, [marineData, activeLayers]);

  // Unified render loop synchronized with MapLibre's requestAnimationFrame
  useEffect(() => {
    if (!mapInstance) return;

    const render = () => {
      const gl = glRef.current;
      const windEngine = windEngineRef.current;
      const marineEngine = marineEngineRef.current;
      const canvas = canvasRef.current;

      if (!gl || !canvas) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Check current active layers
      const active = activeLayersRef.current || [];
      const showWind = active.includes('wind');
      const showMarine = ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => active.includes(l));

      // Clear standalone canvas completely
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (showWind || showMarine) {
        // Extract projection matrix from MapLibre v5 / v4
        let matrix;
        if (typeof mapInstance.transform.getProjectionDataForCustomLayer === 'function') {
          matrix = mapInstance.transform.getProjectionDataForCustomLayer(true).mainMatrix;
        } else if (typeof mapInstance.transform.customLayerMatrix === 'function') {
          matrix = mapInstance.transform.customLayerMatrix();
        } else if (mapInstance.transform.projMatrix) {
          matrix = mapInstance.transform.projMatrix;
        } else {
          console.warn('[WebGLOverlay] No projection matrix found on mapInstance.transform');
          matrix = new Float32Array(16);
        }
        const zoom = mapInstance.getZoom();

        if (showWind && windEngine && windDataRef.current) {
          try {
            windEngine.renderHeatmapAndParticles(gl, matrix, canvas.width, canvas.height, zoom);
          } catch (e) {
            console.error('[WebGLOverlay] Wind Engine render error:', e);
          }
        }

        if (showMarine && marineEngine && marineDataRef.current) {
          try {
            marineEngine.renderHeatmapAndParticles(gl, matrix, canvas.width, canvas.height, zoom);
          } catch (e) {
            console.error('[WebGLOverlay] Marine Engine render error:', e);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [mapInstance]);

  const hasActiveLayers = activeLayers && (
    activeLayers.includes('wind') || 
    ['waves', 'swell_1', 'swell_2', 'wind_waves'].some(l => activeLayers.includes(l))
  );

  return (
    <canvas
      ref={canvasRef}
      width={dimensions.width}
      height={dimensions.height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 6,
        display: hasActiveLayers ? 'block' : 'none',
        mixBlendMode: 'normal'
      }}
    />
  );
}

export default WebGLSynchronizedOverlay;
