export const LAYER_REGISTRY = {
  rain: {
    id: "rain",
    type: "raster",
    source: "ICON_PRECIPITATION",
    omVariable: "precipitation",
    category: "forecast"
  },
  radar: {
    id: "radar",
    type: "raster",
    source: "RAINVIEWER_REFLECTIVITY",
    category: "observational"
  },
  satellite: {
    id: "satellite",
    type: "raster",
    source: "ICON_CLOUD_COVER",
    omVariable: "cloud_cover",
    category: "imagery"
  },
  pressure: {
    id: "pressure",
    type: "raster",
    source: "OM_PRESSURE",
    omVariable: "pressure_msl",
    category: "model"
  },
  fog: {
    id: "fog",
    type: "raster",
    source: "OM_FOG",
    omVariable: "cloud_cover_low",
    category: "model"
  },
  wind: {
    id: "wind",
    type: "canvas",
    source: "WIND_PARTICLES",
    category: "model"
  },
  waves: {
    id: "waves",
    type: "marine",
    source: "MARINE_WAVES",
    category: "model"
  },
  swell_1: {
    id: "swell_1",
    type: "marine",
    source: "MARINE_SWELL1",
    category: "model"
  },
  swell_2: {
    id: "swell_2",
    type: "marine",
    source: "MARINE_SWELL2",
    category: "model"
  },
  wind_waves: {
    id: "wind_waves",
    type: "marine",
    source: "MARINE_WINDWAVES",
    category: "model"
  }
};

export function resolveRasterSource(layerId) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) {
    throw new Error(`[LRCM] Unknown layer: ${layerId}`);
  }
  return layer.source;
}
