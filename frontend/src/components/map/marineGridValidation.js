import { iconFarHourRenderEnabled } from './iconEstimateDelivery';

// Return the reason to retain the previous texture, or null to admit the incoming frame.
export function marineGridRejection(data, activeModel, activeLayer, defaultModel = activeModel) {
  const model = data.__sourceModel || data.grid?.__sourceModel || defaultModel;
  const provider = data.grid?.__gridProvider || data.__gridProvider || 'none';
  const layer = data.grid?.__componentLayer || data.__componentLayer || 'none';
  if (model !== activeModel || (data.grid?.__sourceModel && data.grid.__sourceModel !== activeModel)) return 'model_mismatch';
  if (activeModel === 'GFS' || activeModel === 'ICON') {
    const iconEstimate = activeModel === 'ICON' && iconFarHourRenderEnabled()
      && provider === 'gfs_trend';
    if (!iconEstimate && !['open-meteo', 'backend-weather-service', 'estimated', 'test-fixture', 'gfs_euro_blend'].includes(provider)) {
      return 'provider_not_whitelisted';
    }
    if ((iconEstimate || provider !== 'open-meteo') && layer !== activeLayer) return 'component_layer_mismatch';
  } else if (activeModel === 'EURO') {
    if (!['copernicus', 'backend-weather-service', 'gfs_estimated_fallback', 'gfs_estimated_backdrop',
      'open-meteo', 'estimated', 'test-fixture'].includes(provider)) return 'provider_not_whitelisted';
    if (layer !== activeLayer) return 'component_layer_mismatch';
  }
  return null;
}
