/**
 * Phase 2.1 — useRenderPlanBridge must NOT publish per-frame RenderPlans into
 * React state in normal forecast-authoritative mode (that re-renders the whole
 * map for diagnostics-only data). It must still:
 *   - keep the latest plan/frame on window for the diagnostics HUD, and
 *   - publish to React in the simulation sandbox (or explicit FCE diagnostics).
 */
import { renderHook, act } from '@testing-library/react';

// `mock`-prefixed names are allowed inside the (hoisted) jest.mock factory.
const mockSubHolder = { sub: null };
jest.mock('../engine/SimulationLoop', () => ({
  startSimulation: jest.fn(),
  stopSimulation: jest.fn(),
  bindField: jest.fn(),
  bindConfig: jest.fn(),
  onRenderPlan: (fn) => { mockSubHolder.sub = fn; return () => {}; },
  getSimDiagnostics: () => ({}),
}));

import { useRenderPlanBridge } from '../engine/useRenderPlanBridge';

const makePlan = (rev) => ({
  revision: rev,
  oceanMask: { active: true },
  evolution: { mode: 'disabled_forecast_authoritative', evolved: false },
});

describe('useRenderPlanBridge — normal-mode React publishing gate', () => {
  beforeEach(() => {
    mockSubHolder.sub = null;
    delete window.__IN_SIMULATION_SANDBOX__;
    delete window.__FCE_REACT_PUBLISH__;
    delete window.__FCE_LATEST_PLAN__;
    delete window.__SIM_FRAME__;
    delete window.__SIM_EVOLUTION__;
    delete window.isScrubbingTimeline;
  });

  it('does NOT push renderPlan into React state in normal mode, but keeps the window sample fresh', () => {
    const { result } = renderHook(() =>
      useRenderPlanBridge({ field: { revision: 1 }, config: {}, enabled: true })
    );

    const plan = makePlan(7);
    act(() => { mockSubHolder.sub(plan, 42); });

    // No React publication → component still sees null plan / zero frame.
    expect(result.current.renderPlan).toBeNull();
    expect(result.current.frameIndex).toBe(0);
    // But the diagnostics sample on window IS updated (no re-render).
    expect(window.__FCE_LATEST_PLAN__).toBe(plan);
    expect(window.__SIM_FRAME__).toBe(42);
    expect(window.__SIM_EVOLUTION__.mode).toBe('disabled_forecast_authoritative');
  });

  it('DOES publish renderPlan into React state when the simulation sandbox is active', () => {
    window.__IN_SIMULATION_SANDBOX__ = true;
    const { result } = renderHook(() =>
      useRenderPlanBridge({ field: { revision: 1 }, config: {}, enabled: true })
    );

    const plan = makePlan(9);
    act(() => { mockSubHolder.sub(plan, 55); });

    expect(result.current.renderPlan).toBe(plan);
    expect(result.current.frameIndex).toBe(55);
  });

  it('bypasses bindField while scrubbing and binds the settled field on timeline_scrub_end', () => {
    const { bindField } = require('../engine/SimulationLoop');
    bindField.mockClear();

    // Start scrubbing, then mount + change the field — bindField must NOT fire during the scrub.
    window.isScrubbingTimeline = true;
    const { rerender } = renderHook(
      ({ field }) => useRenderPlanBridge({ field, config: {}, enabled: true }),
      { initialProps: { field: { revision: 1 } } }
    );
    rerender({ field: { revision: 2 } });
    expect(bindField).not.toHaveBeenCalled();

    // On scrub release, the settled (latest) field is bound exactly once.
    window.isScrubbingTimeline = false;
    act(() => {
      window.dispatchEvent(new CustomEvent('timeline_scrub_end'));
    });
    expect(bindField).toHaveBeenCalledWith({ revision: 2 });
  });
});
