import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Thermometer, Cloud, Eye } from 'lucide-react';
import { RATING_LABEL, RATING_COLOR } from './surfRating';
import { energyFluxKwM, energyBand, formatEnergy, isCoarseTier } from './surfEnergy';
// ⚠️ IMPORTED, NOT INJECTED — deliberately, and this is the whole point of the 2026-08-09 fix.
// Every height on these cards used the injected `mToFt`, which each of the five card test files
// supplies itself at 3.28084; production's copy had drifted to 3.281 and NO test could see it.
// A formatter that arrives as a prop is a formatter the suite can replace, so the suite grades a
// converter it wrote rather than the one that ships. Importing the shared display formatter makes
// the production path the only path. (`heightUnit` is still a PROP — it is state, not behaviour.)
import { formatHeightFromMeters } from './heightUnits';

export const STATUS_RENDERS = {
  ready: { color: 'text-emerald-400', text: 'Heatmap Ready (CMEMS)' },
  zoom_too_low: { color: 'text-amber-400', text: 'Zoom In for Heatmap' },
  copernicus_credentials_missing: { color: 'text-rose-400', text: 'Config Error (Credentials)' },
  copernicus_backend_502: { color: 'text-rose-400', text: 'Heatmap Backend Error (502)' },
  copernicus_timeout: { color: 'text-rose-400', text: 'Heatmap Timeout' },
  copernicus_empty_time_range: { color: 'text-rose-400', text: 'Out of Time Range' },
  copernicus_no_nonzero_vectors: { color: 'text-amber-400', text: 'Calm/Zero Data (No Waves)' },
  rate_limited: { color: 'text-rose-400', text: 'Rate Limited (429 Cooldown)' },
  unavailable: { color: 'text-rose-400', text: 'Heatmap Error/Timeout' },
  retained_stale_warning: { color: 'text-amber-400', text: 'Stale Hour Retained' },
  payload_too_large: { color: 'text-amber-400', text: 'Forecast heatmap too large / scoped fetch required' },
  no_copernicus_coverage: { color: 'text-amber-400', text: 'No Copernicus coverage' },
  no_backend_coverage: { color: 'text-amber-400', text: 'No Coverage' }
};

export function compileForecastCards({
  activeLayer,
  activeModel,
  timeOffsetHours,
  isLive,
  currentHourIndex,
  marineHourIndex,
  wx,
  marine,
  currentWeather,
  isExactPointAuthority,
  isExactPointLoading,
  isExactPointTimeout,
  isExactPointError,
  exactPointStatus,
  useExactPoint,
  surfRating,
  waveHeight,
  wavePeriod,
  waveDir,
  swell1Supported,
  swell1Height,
  swell1Period,
  swell1Dir,
  swell2ModelUnavailable,
  swell2Supported,
  swell2Height,
  swell2Period,
  swell2Dir,
  windWavesSupported,
  windWaveHeight,
  windWavePeriod,
  windWaveDir,
  snowfall,
  temp,
  precip,
  windSpeed,
  windDir,
  windGusts,
  pressure,
  sampledWind,
  sampledRain,
  sampledPressure,
  sampledCloudCover,
  sampledVisibility,
  sampledWaterTempC,
  sampledAirTempC,
  mToFt,
  // The user's ft/m display preference, threaded from MapForecastOverlay's window-event listener
  // (the heightUnits.js house pattern). Absent => 'ft', the pre-2026-08-09 behaviour, so any caller
  // that has not been threaded yet keeps its current output rather than silently switching units.
  heightUnit,
  degToCompass,
  getClampedValue,
  getBiasAdjustedLocal,
  isLoading
}) {
  const cards = [];
  // One place decides how a height reads, in the user's unit. `_h` returns null (never the '—'
  // sentinel formatHeightFromMeters uses) so the existing `!= null ? … : '--'` no-data branches
  // stay reachable and keep printing '--'; `_hWord` spells the unit for screen readers, which must
  // never be left saying "feet" beside a card showing metres.
  const _unit = heightUnit === 'm' ? 'm' : 'ft';
  const _h = (m) => (m == null ? null : formatHeightFromMeters(m, _unit, { withUnit: true }));
  const _hWord = (m) => (m == null ? null
    : `${formatHeightFromMeters(m, _unit)} ${_unit === 'm' ? 'meters' : 'feet'}`);

  // GRACEFUL TIMEOUT (2026-07-08): a bare "Timeout" reads as a hard error, but the exact-point budget
  // just elapsed against a (usually cold) backend and self-heals when it warms / on the next fetch — and
  // whenever any grid or forecast value exists the Source card already reads "(Grid Fallback)". Soften the
  // no-data terminal wording to "Updating…" so it reads as recoverable. Kill: __RAW_INFOBOX_TIMEOUT_SOFT_DISABLED__.
  const timeoutSoftOff = typeof window !== 'undefined' && window.__RAW_INFOBOX_TIMEOUT_SOFT_DISABLED__ === true;
  const TIMEOUT_LABEL = timeoutSoftOff ? 'Timeout' : 'Updating…';

  // TWO-PHASE PROVISIONAL MARKER (2026-07-05 item ③, predicate FIXED 2026-07-17): while the
  // authoritative exact-point fetch is in flight, checkIsExactPointValid() rejects the point on its
  // status gate, so useExactPoint is null and every value painted comes from the grid/forecast
  // fallbacks — the fast first set that later "changes to different data". isExactPointAuthority is
  // a SELECTION-TYPE flag (true from the first render of a user-selected marine point), NOT a
  // fetch-completion flip, so the original `!isExactPointAuthority && isExactPointLoading` was
  // false for the entire provisional phase and the marker never rendered where it was built to.
  // Kill: __RAW_INFOBOX_PROVISIONAL_MARK_DISABLED__.
  const provisionalMarkOff = typeof window !== 'undefined' && window.__RAW_INFOBOX_PROVISIONAL_MARK_DISABLED__ === true;
  const isProvisionalPaint = !provisionalMarkOff && isExactPointAuthority && isExactPointLoading;
  const _prov = isProvisionalPaint ? '…' : '';

  // ── IS THIS NUMBER A MEASUREMENT OR A SYNTHESIS? (1a-1, 2026-08-01) ───────────────────────────
  // `isEst` was a hardcoded `false`, declared FOUR separate times inside the four marine blocks,
  // so all twelve `(est.)` branches below were dead code. It was set false by 4117cfc9 (2026-06-08)
  // "Delete frontend estimators and visual fallbacks" — correct at the time. Then 81f2ec23
  // (06-17) and 328a1862 (06-24) RE-INTRODUCED a frontend estimator, 9 and 16 days later, and
  // never restored the marker.
  // ⇒ MEASURED LIVE 2026-08-01: selecting ICON + swell_2 renders `Height | Period | Dir` under an
  //   ICON model chip, at all 7 sites probed, while the numbers are a 60/40 GFS/EURO blend.
  //   ICON/GWAM has no second swell at all; the backend answers `unsupported` and the CLIENT
  //   synthesizes it (backendWeatherServiceClientPoint.js:250).
  // The response has carried the truth the whole time — `is_estimated: true`, `provider:
  // 'estimated'`, `estimate_basis.type` — and the render layer read none of them.
  // THREE producers set it, all ICON, all genuinely estimates, so reading the flag is right for
  // all three rather than special-casing swell_2:
  //   icon_extended_estimate       persistence + GFS trend, hours 168-240
  //   icon_extended_blend          weighted GFS/EURO, hours >240
  //   icon_swell_2_gfs_euro_blend  60/40 GFS/EURO, ALL hours (ICON has no swell_2)
  // ★ ONE EXPRESSION, ONE PLACE. Four copies of a constant is how the knots constant reached seven
  // and diverged; the four block-local declarations are deliberately gone.
  const isEst = useExactPoint?.is_estimated === true;

  // ── ENERGY (1a-2, 2026-08-01) ────────────────────────────────────────────────────────────────
  // Height alone is the wrong headline — a 1.2 m at 6 s and a 1.2 m at 16 s are not the same sea,
  // and energy flux (P ~ H^2*T) is the domain standard for saying so. See surfEnergy.js for why
  // this is kW/m and not the "kJ" every competitor prints.
  // ⚠️ OWN-LAYER ONLY, DELIBERATELY. Each marine layer's TIER is chosen independently, so summing
  // partition energies into a total — which is how Surfline builds its number — composes readings
  // from different footprints: measured 2026-08-01, sum/total energy ratios ran 0.14 to 1.94 with
  // 44% of EURO samples off by more than 2x. An own-layer figure composes nothing and is exactly
  // as trustworthy as the Height and Period already shown beside it. The summed, shore-relative
  // version is queued (1a-3) BEHIND the tier fix, not in front of it.
  const _coarseTier = isCoarseTier(useExactPoint?.coverage_status);
  const _energyCard = (h, p, color) => {
    const kwm = energyFluxKwM(h, p);
    if (kwm == null) return null;
    const band = energyBand(kwm);
    return {
      icon: Waves,
      label: 'Energy',
      value: `${formatEnergy(kwm, { coarse: _coarseTier })}${isEst ? ' (est.)' : ''}${_prov}`,
      color,
      provisional: isProvisionalPaint,
      ariaLabel: `Wave energy flux ${Math.round(kwm)} kilowatts per metre, ${band.label}`
        + ` — ${band.hint}${_coarseTier ? ', approximate: coarse resolution' : ''}`,
    };
  };

  if (activeLayer === 'rain' || activeLayer === 'radar' || activeLayer === 'precipitation') {
    const hasSnow = snowfall != null && snowfall > 0;
    const hasRain = precip != null && precip > 0 && (!hasSnow || (temp != null && temp > 2));
    const isSnowOnly = hasSnow && !hasRain;
    const isMixed = hasSnow && hasRain;
    const noPrecip = (precip == null || precip === 0) && (snowfall == null || snowfall === 0);

    if (noPrecip) {
      const precipLabel = temp != null && temp <= 2 ? 'Snow' : 'Rain';
      const precipIcon = temp != null && temp <= 2 ? Snowflake : CloudRain;
      const precipColor = temp != null && temp <= 2 ? 'text-sky-300' : 'text-blue-400';
      cards.push({ icon: precipIcon, label: precipLabel, value: '0.0 mm/h', color: precipColor });
    } else if (isSnowOnly) {
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else if (isMixed) {
      const rainAmount = precip != null ? Math.max(0, precip - (snowfall * 0.1)).toFixed(1) : '0.0';
      cards.push({ icon: CloudRain, label: 'Rain', value: `${rainAmount} mm/h`, color: 'text-blue-400' });
      cards.push({ icon: Snowflake, label: 'Snow', value: `${snowfall.toFixed(1)} cm/h`, color: 'text-sky-300' });
    } else {
      cards.push({ icon: CloudRain, label: 'Rain', value: precip != null ? `${precip.toFixed(1)} mm/h${_prov}` : '--', color: 'text-blue-400', provisional: isProvisionalPaint });
    }
    cards.push({
      icon: Droplets,
      label: 'Prob',
      value: getClampedValue(wx.precipitation_probability, currentHourIndex) != null
        ? `${getClampedValue(wx.precipitation_probability, currentHourIndex)}%`
        : '--',
      color: 'text-indigo-400'
    });
    if (temp != null) {
      cards.push({ icon: Thermometer, label: 'Temp', value: `${Math.round(temp * 9/5 + 32)}°F`, color: 'text-amber-400' });
    }
  }

  if (activeLayer === 'wind') {
    if (windSpeed != null) {
      const kts = Math.round(windSpeed);
      cards.push({ icon: Wind, label: isLive ? 'Live Wind' : 'Wind', value: `${kts} kts${_prov}`, color: 'text-teal-400', provisional: isProvisionalPaint });
      if (windDir != null) {
        cards.push({ icon: ArrowUp, label: degToCompass(windDir), value: `${Math.round(windDir)}${_prov}`, color: 'text-teal-300', rotate: (windDir + 180) % 360, provisional: isProvisionalPaint });
      }
      if (windGusts != null) {
        cards.push({ icon: Wind, label: 'Gusts', value: `${Math.round(windGusts)} kts`, color: 'text-orange-400' });
      }
    } else {
      cards.push({ icon: Wind, label: 'Wind', value: isLoading ? 'Loading' : '--', color: 'text-gray-400' });
    }
  }

  if (activeLayer === 'pressure' || activeLayer === 'pressure_msl' || activeLayer === 'msl_pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa${_prov}` : '--', color: 'text-rose-400', provisional: isProvisionalPaint });
  }

  // Temp-pair infobox v2 (2026-07-11, the "no data" v1 gap): Air Temp rides the point-forecast
  // temperature_2m that already flows here (°C); Water Temp samples the CLIENT-DECODED grid the
  // raster is rendering (decodedOmSampler — SST is on neither backend point lane). °F per the
  // legend convention. Water Temp null over the landmask's NaN interior reads "Land".
  if (activeLayer === 'temperature') {
    const c = temp != null ? temp : sampledAirTempC; // point forecast first; decoded-grid fallback
    const f = c != null ? Math.round(c * 9 / 5 + 32) : null;
    cards.push({ icon: Thermometer, label: 'Air Temp', value: f != null ? `${f}°F` : (isLoading ? 'Loading' : '--'), color: 'text-orange-400' });
  }

  if (activeLayer === 'water_temp') {
    const f = sampledWaterTempC != null ? Math.round(sampledWaterTempC * 9 / 5 + 32) : null;
    cards.push({ icon: Thermometer, label: 'Water Temp', value: f != null ? `${f}°F` : (isLoading ? 'Loading' : 'Land / no data'), color: 'text-sky-400' });
  }

  if (activeLayer === 'satellite' || activeLayer === 'cloud_cover') {
    const cloudVal = sampledCloudCover?.value;
    const value = cloudVal != null ? `${Math.round(cloudVal)}%` : (isLoading ? 'Loading' : '--');
    cards.push({ icon: Cloud, label: 'Cloud Cover', value, color: 'text-sky-300' });
  }

  if (activeLayer === 'fog' || activeLayer === 'visibility') {
    const visVal = sampledVisibility?.value;
    let value = '--';
    if (visVal != null) {
      if (visVal < 1000) {
        value = 'Dense Fog (<1km)';
      } else if (visVal < 5000) {
        value = 'Moderate Fog';
      } else if (visVal < 10000) {
        value = 'Light Fog';
      } else if (visVal >= 20000) {
        value = 'Clear';
      } else {
        value = `Clear (${Math.round(visVal / 1000)} km)`;
      }
    } else if (isLoading) {
      value = 'Loading';
    }
    cards.push({ icon: Eye, label: 'Visibility', value, color: 'text-gray-300' });
  }

  if (activeLayer === 'waves') {
    let displayHeight = '--';
    let displayPeriod = '--';
    let displayPeak = null;
    let displayDir = '--';
    let displayCompass = '';

    const isNoCoverage = isExactPointAuthority && (
      exactPointStatus === 'exact_no_time_coverage' ||
      exactPointStatus === 'no_copernicus_coverage' ||
      exactPointStatus === 'no_backend_coverage'
    );

    if (isExactPointAuthority && isExactPointLoading && waveHeight == null) {
      displayHeight = 'Loading...';
      displayPeriod = 'Loading...';
      displayDir = 'Loading...';
    } else if (isExactPointAuthority && isExactPointTimeout && waveHeight == null) {
      displayHeight = 'Timeout';
      displayPeriod = 'Timeout';
      displayDir = 'Timeout';
    } else if (isExactPointAuthority && isExactPointError && waveHeight == null) {
      displayHeight = exactPointStatus === 'rate_limited'
        ? 'Rate limited'
        : exactPointStatus === 'copernicus_backend_502'
          ? 'Proxy 502'
          : exactPointStatus === 'copernicus_credentials_missing'
            ? 'Backend unavailable'
            : exactPointStatus === 'estimate_pending_sources'
              ? 'Estimate pending'
              : 'Unavailable';
      displayPeriod = displayHeight;
      displayDir = displayHeight;
    } else if (isNoCoverage && waveHeight == null) {
      displayHeight = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
      displayPeriod = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
      displayDir = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
    } else {
      const hDisp = _h(waveHeight);
      const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
      // Provisional first paint: mark with the shared trailing ellipsis (reads "still refining")
      // instead of suppressing the instant feedback; the marker disappears when authority lands.
      displayHeight = hDisp != null ? `${hDisp}${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}${_prov}` : '--';
      if (wavePeriod != null) displayPeriod = `${wavePeriod.toFixed(1)}s${isEst ? ' (est.)' : ''}${_prov}`;
      if (useExactPoint?.wave_peak_period != null && useExactPoint.wave_peak_period > 0) {
        displayPeak = `${useExactPoint.wave_peak_period.toFixed(1)}s`;
      }
      if (waveDir != null) {
        displayDir = `${Math.round(waveDir)}${isEst ? ' (est.)' : ''}${_prov}`;
        displayCompass = degToCompass(waveDir);
      }
    }

    // ── SURF FIRST, THEN SWELL (2026-07-31, owner decision on #17/#10) ────────────────────────
    // The box used to lead with an unlabelled 'Height' card carrying the OFFSHORE significant wave
    // height while the Rating badge beside it graded the NEARSHORE BREAKING height — two different
    // quantities, same units, nothing marking the difference. That is how a reader compares our
    // number against Windy and concludes we are wrong: Windy shows offshore too.
    // Measured live 2026-07-31, offshore -> breaking at the same coordinate and hour:
    //     shoaling  Sebastian 2.25x  Satellite 1.67  Cocoa 1.64  Trestles 1.57  Uluwatu 1.49
    //               Hossegor 1.48  NewSmyrna 1.42  Mavericks 1.38  Ocean Beach 1.33
    //     shelf     Bells 0.86  Jeffreys Bay 0.84  Pipeline 0.83
    // SIGNED BOTH WAYS and the REGIME predicts the sign, so no constant can reconcile them — only
    // showing both, each named, can. Surf leads because it is the quantity the Rating badge grades
    // and the one a surfer rides; Swell is the sea that produces it.
    const _surfCards = [];
    {
      const _surf = useExactPoint?.surf_height_m;
      const _reg = useExactPoint?.surf_regime;
      const _hidden = _reg === 'open_ocean' || _reg === 'calm' || _reg === 'unknown';
      // NEARSHORE GATE (2026-07-18, user mandate: "Estimated surf should only appear on a marker
      // that is nearshore"): the backend tags land-within-~±0.25° (surf_nearshore). Strictly hide
      // when the backend says false; null/undefined (older cached responses, deploy skew) keeps the
      // legacy regime-only behavior so the row never vanishes from stale caches alone.
      const _near = useExactPoint?.surf_nearshore;
      if (_surf != null && _reg && !_hidden && _near !== false) {
        const _surfDisp = _h(_surf);
        if (_surfDisp != null) {
          _surfCards.push({
            icon: Waves, label: 'Surf', value: `${_surfDisp} (est.)`, color: 'text-emerald-300',
            ariaLabel: `Breaking surf height, estimated ${_hWord(_surf)}`,
          });
        }
      }
    }
    cards.push(..._surfCards);
    // ⚠️ NAMED 'Swell', never 'Height'. An unqualified 'Height' reads as the answer, and this is the
    // OFFSHORE significant wave height — the open-ocean sea, not what breaks at the bank. When the
    // Surf row is suppressed (open_ocean / calm / unknown regime, or surf_nearshore false) this is
    // the ONLY height in the box, so the label is the only thing keeping it honest.
    cards.push({
      icon: Waves, label: 'Swell', value: displayHeight, color: 'text-blue-300',
      provisional: isProvisionalPaint,
      ariaLabel: `Offshore swell height ${displayHeight}`,
    });
    // Surf-quality RATING badge (very_poor..epic) — the headline "how good is it?": size + period + wind
    // (offshore/onshore via shore_normal). Same coastal-break geography gate as the Surf row; colored pill
    // by level (backend surf_rating.py is the source of truth, this shows the JS-mirror result).
    {
      const _reg = useExactPoint?.surf_regime;
      const _coastal = _reg && _reg !== 'open_ocean' && _reg !== 'calm' && _reg !== 'unknown';
      if (_coastal && surfRating && surfRating.score != null && surfRating.level && surfRating.level !== 'unknown') {
        cards.push({
          icon: Waves,
          label: 'Rating',
          value: RATING_LABEL[surfRating.level] || '—',
          color: 'text-emerald-300',
          badgeColor: RATING_COLOR[surfRating.level],
        });
      }
    }
    if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
      cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-blue-200', provisional: isProvisionalPaint });
      { const _e = _energyCard(waveHeight, wavePeriod, 'text-blue-200'); if (_e) cards.push(_e); }
    }
    if (displayPeak) {
      cards.push({ icon: Waves, label: 'Peak', value: displayPeak, color: 'text-blue-100' });
    }
    if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
      cards.push({
        icon: ArrowUp,
        label: displayCompass || 'Dir',
        value: displayDir,
        color: 'text-blue-200',
        rotate: waveDir != null ? (waveDir + 180) % 360 : undefined,
        provisional: isProvisionalPaint
      });
    }
  }

  if (activeLayer === 'swell_1') {
    if (!swell1Supported) {
      const modelLabel1 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      // Same name as the data path below — the no-data card and the data card describe the SAME
      // quantity, and two names for one quantity is the defect this arc is closing.
      cards.push({ icon: Waves, label: 'Primary Swell', value: 'N/A', color: 'text-cyan-400' });
      cards.push({ icon: Waves, label: modelLabel1, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayPeak = null;
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      const isNoCoverage = isExactPointAuthority && (
        exactPointStatus === 'exact_no_time_coverage' ||
        exactPointStatus === 'no_copernicus_coverage' ||
        exactPointStatus === 'no_backend_coverage'
      );

      if (isExactPointAuthority && isExactPointLoading && swell1Height == null) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout && swell1Height == null) {
        displayHeight = TIMEOUT_LABEL;
        displayPeriod = TIMEOUT_LABEL;
        displayDir = TIMEOUT_LABEL;
      } else if (isExactPointAuthority && isExactPointError && swell1Height == null) {
        displayHeight = exactPointStatus === 'rate_limited'
          ? 'Rate limited'
          : exactPointStatus === 'copernicus_backend_502'
            ? 'Proxy 502'
            : exactPointStatus === 'copernicus_credentials_missing'
              ? 'Backend unavailable'
              : 'Unavailable';
        displayPeriod = displayHeight;
        displayDir = displayHeight;
      } else if (isNoCoverage && swell1Height == null) {
        displayHeight = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayPeriod = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayDir = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
      } else {
        const swell1LowEnergy = swell1Height == null || swell1Height < 0.05;
        const hDisp = _h(swell1Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hDisp != null ? `${hDisp}${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}${_prov}` : '--';
        if (!swell1LowEnergy) {
          if (swell1Period != null && swell1Period > 0) displayPeriod = `${swell1Period.toFixed(1)}s${isEst ? ' (est.)' : ''}${_prov}`;
          if (useExactPoint?.swell_wave_peak_period != null && useExactPoint.swell_wave_peak_period > 0) {
            displayPeak = `${useExactPoint.swell_wave_peak_period.toFixed(1)}s`;
          }
          if (swell1Dir != null) {
            displayDir = `${Math.round(swell1Dir)}${isEst ? ' (est.)' : ''}${_prov}`;
            displayCompass = degToCompass(swell1Dir);
          }
        } else {
          const gridHasData = swell1Supported;
          const hasExactData = useExactPoint?.swell_wave_height != null;
          if (!gridHasData && !hasExactData) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      // #22 — 'Height' unqualified reads as THE answer, exactly the ambiguity #17 removed from the
      // `waves` layer and left standing on the other three. But naming this one plain 'Swell'
      // (which is what the layer picker calls it) would REBUILD #17 one level down: on `waves`,
      // 'Swell' is the TOTAL offshore significant height; here it is the PRIMARY TRAIN only.
      // Measured at Cocoa 2026-08-01 — waves 1.6 ft vs swell_1 0.9 ft — two numbers a layer switch
      // apart that would carry the same word. TOTAL vs TRAIN is the distinction the label has to
      // survive, so the train is named as a train.
      cards.push({
        icon: Waves, label: 'Primary Swell', value: displayHeight, color: 'text-cyan-400',
        provisional: isProvisionalPaint,
        ariaLabel: `Primary swell train height ${displayHeight}`,
      });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-cyan-300', provisional: isProvisionalPaint });
          { const _e = _energyCard(swell1Height, swell1Period, 'text-cyan-300'); if (_e) cards.push(_e); }
        }
        if (displayPeak) {
          cards.push({ icon: Waves, label: 'Peak', value: displayPeak, color: 'text-cyan-200' });
        }
        if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({
            icon: ArrowUp,
            label: displayCompass || 'Dir',
            value: displayDir,
            color: 'text-cyan-200',
            rotate: swell1Dir != null ? (swell1Dir + 180) % 360 : undefined,
            provisional: isProvisionalPaint
          });
        }
      }
    }
  }

  if (activeLayer === 'swell_2') {
    if (swell2ModelUnavailable) {
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Secondary Swell', value: 'N/A', color: 'text-purple-400' });
      cards.push({ icon: Waves, label: modelLabel2, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      const isNoCoverage = isExactPointAuthority && (
        exactPointStatus === 'exact_no_time_coverage' ||
        exactPointStatus === 'no_copernicus_coverage' ||
        exactPointStatus === 'no_backend_coverage'
      );

      if (exactPointStatus === 'unsupported') {
        displayHeight = 'Unsupported';
        showStatus = 'No source data';
        statusColor = 'text-amber-500';
      } else if (isExactPointAuthority && isExactPointLoading && swell2Height == null) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout && swell2Height == null) {
        displayHeight = TIMEOUT_LABEL;
        displayPeriod = TIMEOUT_LABEL;
        displayDir = TIMEOUT_LABEL;
      } else if (isExactPointAuthority && isExactPointError && swell2Height == null) {
        displayHeight = exactPointStatus === 'rate_limited'
          ? 'Rate limited'
          : exactPointStatus === 'copernicus_backend_502'
            ? 'Proxy 502'
            : exactPointStatus === 'copernicus_credentials_missing'
              ? 'Backend unavailable'
              : 'Unavailable';
        displayPeriod = displayHeight;
        displayDir = displayHeight;
      } else if (isNoCoverage && swell2Height == null) {
        displayHeight = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayPeriod = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayDir = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
      } else {
        const swell2LowEnergy = swell2Height == null || swell2Height < 0.10;
        const hDisp = _h(swell2Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hDisp != null ? `${hDisp}${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}${_prov}` : '--';
        if (!swell2LowEnergy) {
          if (swell2Period != null && swell2Period > 0) displayPeriod = `${swell2Period.toFixed(1)}s${isEst ? ' (est.)' : ''}${_prov}`;
          if (swell2Dir != null) {
            displayDir = `${Math.round(swell2Dir)}${isEst ? ' (est.)' : ''}${_prov}`;
            displayCompass = degToCompass(swell2Dir);
          }
        } else {
          const gridHasSwell2 = swell2Supported;
          const hasExactS2 = useExactPoint?.secondary_swell_wave_height != null;
          if (!gridHasSwell2 && !hasExactS2) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      // #22, and the layer where it matters most: on ICON this train does not exist upstream at
      // all and the value is a 60/40 GFS/EURO synthesis (see `isEst` above). Naming it as a train
      // is half the honesty; the `(est.)` marker is the other half.
      cards.push({
        icon: Waves, label: 'Secondary Swell', value: displayHeight, color: 'text-purple-400',
        provisional: isProvisionalPaint,
        ariaLabel: `Secondary swell train height ${displayHeight}`,
      });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-purple-300', provisional: isProvisionalPaint });
          { const _e = _energyCard(swell2Height, swell2Period, 'text-purple-300'); if (_e) cards.push(_e); }
        }
        if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({
            icon: ArrowUp,
            label: displayCompass || 'Dir',
            value: displayDir,
            color: 'text-purple-200',
            rotate: swell2Dir != null ? (swell2Dir + 180) % 360 : undefined,
            provisional: isProvisionalPaint
          });
        }
      }
    }
  }

  if (activeLayer === 'wind_waves') {
    if (!windWavesSupported) {
      const modelLabelWw = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Wind, label: 'Wind Waves', value: 'N/A', color: 'text-emerald-400' });
      cards.push({ icon: Wind, label: modelLabelWw, value: 'No data', color: 'text-gray-400' });
    } else {
      let displayHeight = '--';
      let displayPeriod = '--';
      let displayDir = '--';
      let displayCompass = '';
      let showStatus = null;
      let statusColor = 'text-gray-500';

      const isNoCoverage = isExactPointAuthority && (
        exactPointStatus === 'exact_no_time_coverage' ||
        exactPointStatus === 'no_copernicus_coverage' ||
        exactPointStatus === 'no_backend_coverage'
      );

      if (isExactPointAuthority && isExactPointLoading && windWaveHeight == null) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout && windWaveHeight == null) {
        displayHeight = TIMEOUT_LABEL;
        displayPeriod = TIMEOUT_LABEL;
        displayDir = TIMEOUT_LABEL;
      } else if (isExactPointAuthority && isExactPointError && windWaveHeight == null) {
        displayHeight = exactPointStatus === 'rate_limited'
          ? 'Rate limited'
          : exactPointStatus === 'copernicus_backend_502'
            ? 'Proxy 502'
            : exactPointStatus === 'copernicus_credentials_missing'
              ? 'Backend unavailable'
              : 'Unavailable';
        displayPeriod = displayHeight;
        displayDir = displayHeight;
      } else if (isNoCoverage && windWaveHeight == null) {
        displayHeight = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayPeriod = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
        displayDir = activeModel === 'EURO' ? 'No Copernicus coverage' : 'No Coverage';
      } else {
        const windWaveLowEnergy = windWaveHeight == null || windWaveHeight < 0.05;
        const hDisp = _h(windWaveHeight);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hDisp != null ? `${hDisp}${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}${_prov}` : '--';
        if (!windWaveLowEnergy) {
          if (windWavePeriod != null && windWavePeriod > 0) displayPeriod = `${windWavePeriod.toFixed(1)}s${isEst ? ' (est.)' : ''}${_prov}`;
          if (windWaveDir != null) {
            displayDir = `${Math.round(windWaveDir)}${isEst ? ' (est.)' : ''}${_prov}`;
            displayCompass = degToCompass(windWaveDir);
          }
        } else {
          const gridHasWW = windWavesSupported;
          const hasExactWW = useExactPoint?.wind_wave_height != null;
          if (!gridHasWW && !hasExactWW) {
            showStatus = 'No data';
          } else {
            showStatus = 'Trace';
          }
        }
      }

      // #22. 'Wind Waves' matches the layer picker and collides with nothing — windsea is locally
      // generated chop, never confusable with the total or with a swell train.
      cards.push({
        icon: Wind, label: 'Wind Waves', value: displayHeight, color: 'text-emerald-400',
        provisional: isProvisionalPaint,
        ariaLabel: `Wind wave (windsea) height ${displayHeight}`,
      });
      if (showStatus) {
        cards.push({ icon: Wind, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Wind, label: 'Period', value: displayPeriod, color: 'text-emerald-300', provisional: isProvisionalPaint });
          { const _e = _energyCard(windWaveHeight, windWavePeriod, 'text-emerald-300'); if (_e) cards.push(_e); }
        }
        if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({
            icon: ArrowUp,
            label: displayCompass || 'Dir',
            value: displayDir,
            color: 'text-emerald-200',
            rotate: windWaveDir != null ? (windWaveDir + 180) % 360 : undefined,
            provisional: isProvisionalPaint
          });
        }
      }
    }
  }

  if (isExactPointAuthority && isExactPointLoading && waveHeight != null) {
    // Plain-language companion to the per-value '…' marker: tells the user the numbers on screen
    // are the map's estimate and the precise point values are still on the way.
    cards.push({
      icon: Waves,
      label: 'Source',
      value: 'Map estimate — refining…',
      color: 'text-cyan-400 animate-pulse'
    });
  } else if (isExactPointAuthority && isExactPointTimeout && waveHeight != null) {
    cards.push({
      icon: Waves,
      label: 'Source',
      value: 'Timeout (Grid Fallback)',
      color: 'text-amber-400'
    });
  } else if (isExactPointAuthority && isExactPointError && waveHeight != null) {
    cards.push({
      icon: Waves,
      label: 'Source',
      value: exactPointStatus === 'rate_limited'
        ? 'Rate limited (Using heatmap grid)'
        : exactPointStatus === 'copernicus_backend_502'
          ? 'Proxy 502 (Using heatmap grid)'
          : exactPointStatus === 'copernicus_credentials_missing'
            ? 'Credentials missing (Using heatmap grid)'
            : 'Unavailable (Using heatmap grid)',
      color: 'text-rose-400'
    });
  } else if (isExactPointAuthority && (exactPointStatus === 'exact_no_time_coverage' || exactPointStatus === 'no_copernicus_coverage' || exactPointStatus === 'no_backend_coverage') && waveHeight != null) {
    cards.push({
      icon: Waves,
      label: 'Source',
      value: activeModel === 'EURO' ? 'No CMEMS coverage (Grid Fallback)' : 'No coverage (Grid Fallback)',
      color: 'text-amber-400'
    });
  }

  return cards;
}
