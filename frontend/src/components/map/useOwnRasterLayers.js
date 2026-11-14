/**
 * The raster layers drawn from OUR CDN frames instead of Open-Meteo's .om tiles (useOwnRasterFrames.js), and the active layer
 * list the .om path keeps: a layer is left out of it only while its own frames are drawing (the hook reports it once its
 * first frame is on screen), so Open-Meteo is never asked for it and nothing is drawn twice. Moved out of MapWebGL.js
 * (2026-11-14) as is: one hook call per layer, in this fixed order.
 *   pressure (2026-10-23) + its isobars / H-L; air temperature and cloud cover, the 'satellite' layer (2026-10-24);
 *   precipitation, the 'rain' layer (2026-11-12); fog and water temperature (2026-11-14, ON with per-layer kills; a set not
 *   published yet stays on the .om path). Water temp anchors where its .om slots do, BELOW the ocean mask's land fill, so land
 *   skin temperatures stay covered.
 * Which of them are on by default, per layer and model: ownRasterFrames.js (DEFAULT_ON_LAYERS, DEFAULT_ON_MODELS, the levers).
 */
import { useMemo } from 'react';
import { useOwnRasterFrames } from './useOwnRasterFrames';
import { usePressureIsobars } from './usePressureIsobars';

export function useOwnRasterLayers({ mapInstance, activeModel, activeLayers, timeOffsetHours, theme, omSlotsBeforeId, marineBeforeId }) {
  const on = (layer) => (activeLayers || []).includes(layer);
  const base = { mapInstance, model: activeModel, timeOffsetHours, theme, beforeId: omSlotsBeforeId };
  const ownPressure = useOwnRasterFrames({ ...base, layer: 'pressure', active: on('pressure') });
  usePressureIsobars({ mapInstance, engaged: ownPressure, theme, beforeId: omSlotsBeforeId });   // isobars + H/L over it (same lever)
  const ownTemperature = useOwnRasterFrames({ ...base, layer: 'temperature', active: on('temperature') });
  const ownSatellite = useOwnRasterFrames({ ...base, layer: 'satellite', active: on('satellite') });
  const ownRain = useOwnRasterFrames({ ...base, layer: 'rain', active: on('rain') });
  const ownFog = useOwnRasterFrames({ ...base, layer: 'fog', active: on('fog') });
  const ownWaterTemp = useOwnRasterFrames({ ...base, layer: 'water_temp', active: on('water_temp'), beforeId: marineBeforeId || omSlotsBeforeId });
  return useMemo(() => {
    const own = { pressure: ownPressure, temperature: ownTemperature, satellite: ownSatellite, rain: ownRain, fog: ownFog, water_temp: ownWaterTemp };
    if (!Object.values(own).some(Boolean)) return activeLayers;
    return (activeLayers || []).filter((l) => !own[l]);
  }, [ownPressure, ownTemperature, ownSatellite, ownRain, ownFog, ownWaterTemp, activeLayers]);
}
