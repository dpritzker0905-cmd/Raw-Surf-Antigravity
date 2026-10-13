/**
 * A15-20 (audit 15.0): the telemetry FPS counter requested an animation frame on every vsync from
 * module load, forever, on every page. It must run only while weather layers are active, and report
 * null (never a stale or invented 60) while paused.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TruthOverlayGpuTab } from './TruthOverlayGpuTab';

let queue;
let nextId;
let clock;

const flushFrame = (dtMs) => {
  clock += dtMs;
  const pending = queue;
  queue = new Map();
  pending.forEach((cb) => cb(clock));
};

const loadFresh = () => {
  let mod;
  jest.isolateModules(() => { mod = require('./WeatherTelemetry'); });
  return mod.WeatherTelemetry;
};

beforeEach(() => {
  queue = new Map();
  nextId = 1;
  clock = 1000;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  window.requestAnimationFrame = jest.fn((cb) => { const id = nextId++; queue.set(id, cb); return id; });
  window.cancelAnimationFrame = jest.fn((id) => { queue.delete(id); });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WeatherTelemetry FPS monitor', () => {
  it('requests no frames at load: an idle page stays idle', () => {
    const t = loadFresh();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(t.gpuStats.fps).toBeNull();
  });

  it('measures while a weather layer is active', () => {
    const t = loadFresh();
    t.updateState('GFS', ['waves'], 0);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 61; i++) flushFrame(1000 / 60);
    expect(t.gpuStats.fps).toBe(60);
    expect(queue.size).toBe(1);                       // one loop, re-armed each frame
  });

  it('does not start a second loop when the layer set changes while running', () => {
    const t = loadFresh();
    t.updateState('GFS', ['waves'], 0);
    t.updateState('GFS', ['waves', 'wind'], 0);
    flushFrame(16);
    expect(queue.size).toBe(1);
  });

  it('stops, and reads null, when the last layer is turned off', () => {
    const t = loadFresh();
    t.updateState('GFS', ['waves'], 0);
    for (let i = 0; i < 61; i++) flushFrame(1000 / 60);
    const calls = window.requestAnimationFrame.mock.calls.length;
    t.updateState('GFS', [], 0);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(queue.size).toBe(0);
    expect(t.gpuStats.fps).toBeNull();
    flushFrame(16);
    expect(window.requestAnimationFrame.mock.calls.length).toBe(calls);
  });

  it('still reports a frame-rate drop while layers draw', () => {
    const t = loadFresh();
    const events = [];
    t.subscribe((e) => events.push(e));
    t.updateState('GFS', ['waves'], 0);
    for (let i = 0; i < 12; i++) flushFrame(100);   // 10 fps
    expect(events.some((e) => e.type === 'FPS_drop_detected')).toBe(true);
  });
});

describe('TruthOverlayGpuTab frame rate', () => {
  it('shows a dash, not an invented 60, when nothing was measured', () => {
    render(<TruthOverlayGpuTab gpuFps={null} />);
    expect(screen.getByText(/— FPS/)).toBeInTheDocument();
    expect(screen.queryByText(/60 FPS/)).toBeNull();
  });

  it('shows a measured value, including a frozen 0', () => {
    const { rerender } = render(<TruthOverlayGpuTab gpuFps={42} />);
    expect(screen.getByText(/42 FPS/)).toBeInTheDocument();
    rerender(<TruthOverlayGpuTab gpuFps={0} />);
    expect(screen.getByText(/^0 FPS$/)).toBeInTheDocument();
  });
});
