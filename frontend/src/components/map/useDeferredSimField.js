import { useDeferredValue, useMemo } from 'react';

/**
 * useDeferredSimField — the simulation field's (FCE) inputs, DEFERRED (2026-10-25, the wind toggle's click task; #570).
 *
 * Nothing the map DRAWS reads the simulation field by default: RenderPlanDispatcher uploads to the wind engine only with
 * window.__ALLOW_FCE_WIND_UPLOAD__ and to the marine engine only with window.__ALLOW_FCE_MARINE_UPLOAD__ (both off); the HUD and
 * the debug tools read it. Yet its rebuild ran inside the click's urgent render: 58 ms at z2 on a Waves -> Wind toggle, where
 * the active marine layer flips and the whole field is rebuilt on the wind grid. All its inputs go through ONE deferred value,
 * so the urgent render keeps the previous inputs (useSimulationField's memo holds) and React rebuilds the field in a background
 * render after the wind commits. Deferring the inputs together (not the data alone) is what keeps a layer flip out of the
 * urgent render.
 *
 * Kill: window.__RAW_DISABLE_SIM_FIELD_DEFER__ = true (read per render: the urgent inputs, as before).
 */
export function useDeferredSimField({ windData, marineData, activeModel, timeOffsetHours, activeMarineLayer }) {
  const inputs = useMemo(() => ({ windData, marineData, activeModel, timeOffsetHours, activeMarineLayer }),
    [windData, marineData, activeModel, timeOffsetHours, activeMarineLayer]);
  const deferred = useDeferredValue(inputs);
  return (typeof window !== 'undefined' && window.__RAW_DISABLE_SIM_FIELD_DEFER__ === true) ? inputs : deferred;
}
