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

  // Bind field to simulation loop whenever it changes
  useEffect(() => {
    if (field) {
      bindField(field);
    }
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
      // Throttle React updates to ~10Hz to avoid excessive re-renders
      // The simulation runs at 60Hz but React doesn't need that frequency
      const now = Date.now();
      if (now - throttleRef.current < 100) return; // Max 10 updates/sec to React
      throttleRef.current = now;

      // Update React with latest plan (field evolves continuously)
      if (plan && frame !== lastPlanRevRef.current) {
        lastPlanRevRef.current = frame;
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
