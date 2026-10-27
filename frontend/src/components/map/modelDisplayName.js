/**
 * modelDisplayName.js: the model name the forecast panel shows, the SAME word the model picker shows.
 *
 * 2026-10-20 (owner: "Euro is fine" for what users see). The picker (MapWeatherControls) labels the
 * lane 'EURO', but the panel header and the no-data swell cards printed 'ECMWF'. That was a provenance
 * claim and it was false on three of EURO's four marine layers: swell_1, swell_2 and wind_waves come
 * from Copernicus Marine (Météo-France's MFWAM wave model, driven by ECMWF winds), not from ECMWF's own
 * wave model. 'EURO' names our lane rather than an organisation, so it is true on every layer; which
 * organisation made each layer is the HUD's job (dataOrigin.js reads the served product).
 *
 * Display only. modelProvenance.ACTIVE_MODEL_LABEL stays 'ECMWF' on purpose: describeSubstitution
 * compares it with the FAMILY of the Open-Meteo tile id (ecmwf_* -> 'ECMWF'), and renaming it would
 * raise a false "substituted" banner on every EURO tile.
 * Kill switch: window.__RAW_DISABLE_EURO_DISPLAY_NAME__ = true -> the old 'ECMWF' label.
 */
export function modelDisplayName(activeModel) {
  if (activeModel === 'EURO' && typeof window !== 'undefined'
      && window.__RAW_DISABLE_EURO_DISPLAY_NAME__ === true) {
    return 'ECMWF';
  }
  return activeModel;
}
