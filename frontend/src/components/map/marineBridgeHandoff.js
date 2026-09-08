// Coordinate the coarse wash and incoming regional pass after a coverage hold. The July
// from-hidden snap remains intact for rating/model/time changes. This experiment is opt-in
// until the controlled pixel result and live coastal evidence agree; no forecast values change.
export function sameHandoffTarget(a, b) {
  const time = g => g && (g.served_valid_time || g.valid_time || g.validTime);
  return !!(a && b && a.ratingMode === false && b.ratingMode === false
    && a.__sourceModel && a.__sourceModel === b.__sourceModel
    && a.__componentLayer && a.__componentLayer === b.__componentLayer
    && typeof time(a) === 'string' && Number.isFinite(Date.parse(time(a))) && time(a) === time(b)
    && a.hourOffset === b.hourOffset);
}

export function resolveBridgeHandoff(previous, input, now, enabled) {
  const { grid, base, mult, bridge, wash, covers } = input;
  let transition = previous?.transition || null;
  if (!enabled || !base || !Number.isFinite(wash) || !Number.isFinite(now) || !Number.isFinite(mult) || mult <= 0
      || !sameHandoffTarget(previous?.grid, grid) || previous?.base !== base) {
    transition = null;
  } else if (previous.grid !== grid) {
    transition = previous.mult === 0 && previous.bridge && previous.wash > 0 && covers
      ? { start: now, fromWash: previous.wash } : null;
  }
  let scale = 1, value = wash;
  if (transition) {
    const elapsed = now - transition.start;
    if (elapsed < 0 || elapsed >= 600) transition = null;
    else {
      const t = elapsed / 600;
      scale = t * t * (3 - 2 * t);
      value = transition.fromWash + scale * (wash - transition.fromWash);
    }
  }
  return { scale, wash: value, state: { ...input, wash: value, transition } };
}

export function applyBridgeHandoffWash(engine, wash, mult, bridge, covers, win, now) {
  const result = resolveBridgeHandoff(engine._bridgeHandoffState, {
    grid: engine._waveData?.waveGrid, base: engine._coarseBaseData, wash, mult, bridge, covers,
  }, now, win?.__RAW_ENABLE_BRIDGE_HANDOFF_BLEND__ === true);
  if (result.state.transition && !engine._bridgeHandoffState?.transition) {
    engine._bridgeHandoffStarts = (engine._bridgeHandoffStarts || 0) + 1;
  }
  engine._bridgeHandoffState = result.state;
  engine._bridgeHandoffScale = result.scale;
  if (win?.__RAW_GPU__) {
    win.__RAW_GPU__.bridgeHandoff = { scale: result.scale, wash: result.wash, starts: engine._bridgeHandoffStarts || 0 };
    win.__RAW_GPU__.washEff = +result.wash.toFixed(3);
  }
  return result.wash;
}
