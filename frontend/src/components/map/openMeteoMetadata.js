import { openMeteoFetchInput } from './openMeteoTransport';

export const MODEL_METADATA_PROMISES = {};
export const LIVE_FETCHED_MODELS = new Set();

function isUsableManifest(data) {
  return data?.completed === true && typeof data.reference_time === 'string' &&
    Number.isFinite(Date.parse(data.reference_time)) &&
    Array.isArray(data.valid_times) && data.valid_times.length > 0 &&
    data.valid_times.every(time => typeof time === 'string' && Number.isFinite(Date.parse(time))) &&
    Array.isArray(data.variables) && data.variables.length > 0 &&
    data.variables.every(variable => typeof variable === 'string' && variable.length > 0);
}

export async function fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, onMetadataChanged) {
  const cached = MODEL_METADATA_CACHE[modelToCheck];
  if (!LIVE_FETCHED_MODELS.has(modelToCheck) && !MODEL_METADATA_PROMISES[modelToCheck]) {
    MODEL_METADATA_PROMISES[modelToCheck] = fetch(openMeteoFetchInput(`https://map-tiles.open-meteo.com/data_spatial/${modelToCheck}/latest.json?skip_intercept=true`))
      .then(res => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.json();
      })
      .then(data => {
        if (!isUsableManifest(data)) throw new Error('Incomplete or invalid Open-Meteo manifest');
        const variables = [...data.variables];
        if (variables.includes('wind_u_component_10m') && variables.includes('wind_v_component_10m') && !variables.includes('wind_speed_10m')) {
          variables.push('wind_speed_10m');
        }
        const result = {
          variables,
          validTimes: data.valid_times,
          referenceTime: data.reference_time,
          // Serve the provider's completed manifest to the decoder verbatim. Bootstrap axes
          // and derived UI variable aliases are not provider observations.
          sourceMetadata: data,
        };
        const prevCache = MODEL_METADATA_CACHE[modelToCheck];
        const hasChanged = !prevCache ||
          prevCache.referenceTime !== result.referenceTime ||
          prevCache.variables.length !== result.variables.length ||
          prevCache.validTimes.length !== result.validTimes.length;
        MODEL_METADATA_CACHE[modelToCheck] = result;
        LIVE_FETCHED_MODELS.add(modelToCheck);
        if (hasChanged && onMetadataChanged) onMetadataChanged();
        return result;
      })
      .catch(err => {
        console.warn(`[MapWebGL] Failed to fetch latest.json for ${modelToCheck}`, err);
        return cached || { variables: [], validTimes: [], referenceTime: null };
      })
      .finally(() => { MODEL_METADATA_PROMISES[modelToCheck] = null; });
  }
  // The caller already bypasses this async function on a live warm cache. A cold caller
  // must await the shared real manifest instead of publishing guessed cycle/time axes.
  return MODEL_METADATA_PROMISES[modelToCheck] || cached || { variables: [], validTimes: [], referenceTime: null };
}
