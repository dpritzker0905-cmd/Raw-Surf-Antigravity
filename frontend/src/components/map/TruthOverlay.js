import React from 'react';
import { LAYER_REGISTRY } from './LayerRegistry';

function getLayerTruth(layerId, rasterVisible) {
  const layer = LAYER_REGISTRY[layerId];
  if (!layer) return "OFF";
  if (layer.type === "raster") return rasterVisible ? "LOADED" : "LOADING";
  return "UNKNOWN";
}

/**
 * TruthOverlay — Visual debugging HUD for the GIS renderer.
 * Displays active layer state, data pipeline status, and truth violations.
 * Extract from MapWebGL.js to maintain LOC compliance.
 */
const TruthOverlay = ({ activeLayers, activeRenderType, marineData, windData, truthIssues, rasterVisible }) => {
  const layerId = activeLayers[0];
  const layer = LAYER_REGISTRY[layerId];

  return (
    <div className="absolute top-4 left-4 z-50 bg-black/80 p-3 rounded text-xs text-white font-mono pointer-events-none">
      <div className="font-bold text-blue-400 mb-1 border-b border-gray-600 pb-1">v250 TRUTH ENGINE (LRCM v1)</div>
      <div className="text-cyan-400">UI Layer: {layerId || 'none'}</div>
      {layer && <div className="text-purple-300">Source: {layer.source}</div>}
      
      {layer?.type === 'raster' ? (
        <div className="text-purple-400">Raster Status: {getLayerTruth(layerId, rasterVisible)}</div>
      ) : null}
      
      <div className="text-blue-500">Marine: {marineData ? 'ON' : 'OFF'} ({marineData?.features?.length || 0} pts)</div>
      <div className="text-green-400">Wind: {activeLayers.includes('wind') ? 'ON' : 'OFF'} ({windData?.vectors?.length || 0} vec)</div>
      {truthIssues.length > 0 && (
        <div className="mt-1 pt-1 border-t border-red-800">
          <div className="text-red-400 font-bold">⚠ {truthIssues.length} violation{truthIssues.length > 1 ? 's' : ''}</div>
          {truthIssues.slice(0, 3).map((issue, i) => (
            <div key={i} className="text-red-300 text-[10px]">{issue.type}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TruthOverlay;
