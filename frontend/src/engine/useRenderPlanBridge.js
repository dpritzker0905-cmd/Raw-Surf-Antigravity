/**
 * useRenderPlanBridge.js — React ↔ SimulationLoop Bridge
 *
 * This hook connects the simulation engine (which runs independently
 * of React) to the React rendering layer.
 *
 * It:
 *   1. Starts the simulation loop on mount
 *   2. Binds SimulationField whenever it changes
 *   3. Binds render config whenever it changes
 *   4. Subscribes to RenderPlan updates from the simulation loop
 *   5. Exposes the latest RenderPlan to React components
 *
 * IMPORTANT: The simulation loop runs at 60Hz FIXED TIMESTEP.
 * React re-renders are triggered ONLY when the RenderPlan changes
 * in a way that affects the component tree (throttled to avoid spam).
 *
 * RULES:
 *   - This is the ONLY connection between engine and React
 *   - No simulation logic in this file
 *   - No MapLibre references
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  startSimulation,
  stopSimulation,
  bindField,
  bindConfig,
  onRenderPlan,
  getSimDiagnostics,
} from './SimulationLoop';

/**
 * Bridge the SimulationLoop to React.
 *
 * @param {Object} params
 * @param {import('./SimulationField').SimulationField|null} params.field - Current SimulationField
 * @param {Object} params.config - Render config { activeLayers, activeMarineLayer, theme }
 * @param {boolean} [params.enabled=true] - Whether the simulation should run
 * @returns {{ renderPlan: Object|null, frameIndex: number, diagnostics: Object }}
 */
export function useRenderPlanBridge({ field, config, enabled = true }) {
  const [renderPlan, setRenderPlan] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const lastPlanRevRef = useRef(0);
  const throttleRef = useRef(0);

  // Start/stop simulation loop
  useEffect(() => {
    if (enabled) {
      startSimulation();
    }
    return () => {
      // Don't stop on every re-render — only on true unmount
    };
  }, [enabled]);

  // Bind field to simulation loop whenever it changes — but BYPASS during active scrubbing.
  // Each hour's grid differs, so useSimulationField hands us a new field per committed hour;
  // bindField deep-clones it + allocates/copies 16 typed arrays + re-baselines the particle
  // energy, which at scrub rate (~18Hz) is the dominant main-thread churn (~33ms tasks → GC
  // pressure). Bypassing here lets the heatmap commit track the slider; the settled field is
  // bound once on scrub release (effect below). Non-scrub field changes bind normally.
  useEffect(() => {
    if (field) {
      if (typeof window !== 'undefined' && window.isScrubbingTimeline) {
        return;
      }
      bindField(field);
    }
  }, [field]);

  // Bind the settled field once scrubbing ends (timeline_scrub_end is dispatched by the slider
  // on drag release, after window.isScrubbingTimeline flips false).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleScrubEnd = () => {
      if (field) {
        bindField(field);
      }
    };
    window.addEventListener('timeline_scrub_end', handleScrubEnd);
    return () => {
      window.removeEventListener('timeline_scrub_end', handleScrubEnd);
    };
  }, [field]);

  // Bind config to simulation loop whenever it changes
  useEffect(() => {
    if (config) {
      bindConfig(config);
    }
  }, [config]);

  // Subscribe to RenderPlan updates from the simulation loop
  useEffect(() => {
    const unsub = onRenderPlan((plan, frame) => {
      // Throttle to ~10Hz. The simulation runs at 60Hz but nothing here needs it.
      const now = Date.now();
      if (now - throttleRef.current < 100) return;
      throttleRef.current = now;

      if (!plan || frame === lastPlanRevRef.current) return;
      lastPlanRevRef.current = frame;

      // ALWAYS keep the latest sample on window for the diagnostics HUD — this is a
      // plain assignment, NOT React state, so it triggers no re-render.
      if (typeof window !== 'undefined') {
        window.__FCE_LATEST_PLAN__ = plan;
        window.__FCE_RENDER_PLAN__ = plan;
        window.__SIM_FRAME__ = frame;
        window.__SIM_EVOLUTION__ = plan.evolution || null;
      }

      // In normal forecast-authoritative map mode the per-frame RenderPlan does NOT
      // control forecast-direct WebGL rendering (FCE GPU uploads are disabled), so
      // publishing it into React state would re-render the whole map for nothing.
      // Only publish to React in the simulation sandbox or when an explicit FCE
      // diagnostics flag is set. (P0 — RenderPlan/frame state drives avoidable React work.)
      const publishToReact = typeof window !== 'undefined' &&
        (window.__IN_SIMULATION_SANDBOX__ === true || window.__FCE_REACT_PUBLISH__ === true);
      if (publishToReact) {
        setRenderPlan(plan);
        setFrameIndex(frame);
      }
    });

    return unsub;
  }, []);

  // Diagnostics
  const diagnostics = getSimDiagnostics();

  return {
    renderPlan,
    frameIndex,
    diagnostics,
  };
}
