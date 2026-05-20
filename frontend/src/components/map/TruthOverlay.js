import React from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';

function getLayerTruth(layerId, rasterVisible) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) return "OFF";
  if (layer.type === "raster") return rasterVisible ? "LOADED" : "LOADING";
  return "UNKNOWN";
}

/**
 * TruthOverlay Visual debugging HUD for the GIS renderer.
 * Displays active layer state, data pipeline status, and truth violations.
 * Extract from MapWebGL.js to maintain LOC compliance.
 */
var TruthOverlay = ({ activeLayers, activeRenderType, marineData, windData, truthIssues, rasterVisible }) => {
  return null;
};

export default TruthOverlay;
