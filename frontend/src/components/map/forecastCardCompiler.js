import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Thermometer, Cloud, Eye } from 'lucide-react';
import { RATING_LABEL, RATING_COLOR } from './surfRating';

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
  mToFt,
  degToCompass,
  getClampedValue,
  getBiasAdjustedLocal,
  isLoading
}) {
  const cards = [];

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
      cards.push({ icon: CloudRain, label: 'Rain', value: precip != null ? `${precip.toFixed(1)} mm/h` : '--', color: 'text-blue-400' });
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
      cards.push({ icon: Wind, label: isLive ? 'Live Wind' : 'Wind', value: `${kts} kts`, color: 'text-teal-400' });
      if (windDir != null) {
        cards.push({ icon: ArrowUp, label: degToCompass(windDir), value: `${Math.round(windDir)}`, color: 'text-teal-300', rotate: (windDir + 180) % 360 });
      }
      if (windGusts != null) {
        cards.push({ icon: Wind, label: 'Gusts', value: `${Math.round(windGusts)} kts`, color: 'text-orange-400' });
      }
    } else {
      cards.push({ icon: Wind, label: 'Wind', value: isLoading ? 'Loading' : '--', color: 'text-gray-400' });
    }
  }

  if (activeLayer === 'pressure' || activeLayer === 'pressure_msl' || activeLayer === 'msl_pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa` : '--', color: 'text-rose-400' });
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
      const isEst = false;
      const hFt = mToFt(waveHeight);
      const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
      displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}` : '--';
      if (wavePeriod != null) displayPeriod = `${wavePeriod.toFixed(1)}s${isEst ? ' (est.)' : ''}`;
      if (useExactPoint?.wave_peak_period != null && useExactPoint.wave_peak_period > 0) {
        displayPeak = `${useExactPoint.wave_peak_period.toFixed(1)}s`;
      }
      if (waveDir != null) {
        displayDir = `${Math.round(waveDir)}${isEst ? '° (est.)' : ''}`;
        displayCompass = degToCompass(waveDir);
      }
    }

    cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-blue-300' });
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
    // Option-2 bathymetry SURF transform (ESTIMATE): nearshore breaking height (cross-shelf bottom friction
    // + shoaling + depth-limited breaking). Shown for any coastal break regime (shelf/shoaling/breaking);
    // hidden for 'open_ocean' (no shore to break on) and calm/unknown. The coastal gate is geography-based,
    // so this row shows consistently for GFS/EURO/ICON. A wide shallow shelf (Florida) reads SMALLER than the
    // offshore Height; a steep coast ~the same. (est.) keeps it honestly distinct from the model value.
    {
      const _surf = useExactPoint?.surf_height_m;
      const _reg = useExactPoint?.surf_regime;
      const _hidden = _reg === 'open_ocean' || _reg === 'calm' || _reg === 'unknown';
      if (_surf != null && _reg && !_hidden) {
        const _surfFt = mToFt(_surf);
        if (_surfFt != null) {
          cards.push({ icon: Waves, label: 'Surf', value: `${_surfFt} ft (est.)`, color: 'text-emerald-300' });
        }
      }
    }
    if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
      cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-blue-200' });
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
        rotate: waveDir != null ? (waveDir + 180) % 360 : undefined
      });
    }
  }

  if (activeLayer === 'swell_1') {
    if (!swell1Supported) {
      const modelLabel1 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell', value: 'N/A', color: 'text-cyan-400' });
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
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
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
        const isEst = false;
        const swell1LowEnergy = swell1Height == null || swell1Height < 0.05;
        const hFt = mToFt(swell1Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}` : '--';
        if (!swell1LowEnergy) {
          if (swell1Period != null && swell1Period > 0) displayPeriod = `${swell1Period.toFixed(1)}s${isEst ? ' (est.)' : ''}`;
          if (useExactPoint?.swell_wave_peak_period != null && useExactPoint.swell_wave_peak_period > 0) {
            displayPeak = `${useExactPoint.swell_wave_peak_period.toFixed(1)}s`;
          }
          if (swell1Dir != null) {
            displayDir = `${Math.round(swell1Dir)}${isEst ? '° (est.)' : ''}`;
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

      cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-cyan-400' });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-cyan-300' });
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
            rotate: swell1Dir != null ? (swell1Dir + 180) % 360 : undefined
          });
        }
      }
    }
  }

  if (activeLayer === 'swell_2') {
    if (swell2ModelUnavailable) {
      const modelLabel2 = activeModel === 'EURO' ? 'ECMWF' : activeModel;
      cards.push({ icon: Waves, label: 'Swell 2', value: 'N/A', color: 'text-purple-400' });
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
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
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
        const isEst = false;
        const swell2LowEnergy = swell2Height == null || swell2Height < 0.10;
        const hFt = mToFt(swell2Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}` : '--';
        if (!swell2LowEnergy) {
          if (swell2Period != null && swell2Period > 0) displayPeriod = `${swell2Period.toFixed(1)}s${isEst ? ' (est.)' : ''}`;
          if (swell2Dir != null) {
            displayDir = `${Math.round(swell2Dir)}${isEst ? '° (est.)' : ''}`;
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

      cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-purple-400' });
      if (showStatus) {
        cards.push({ icon: Waves, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Waves, label: 'Period', value: displayPeriod, color: 'text-purple-300' });
        }
        if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({
            icon: ArrowUp,
            label: displayCompass || 'Dir',
            value: displayDir,
            color: 'text-purple-200',
            rotate: swell2Dir != null ? (swell2Dir + 180) % 360 : undefined
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
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
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
        const isEst = false;
        const windWaveLowEnergy = windWaveHeight == null || windWaveHeight < 0.05;
        const hFt = mToFt(windWaveHeight);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : (isEst ? ' (est.)' : '')}` : '--';
        if (!windWaveLowEnergy) {
          if (windWavePeriod != null && windWavePeriod > 0) displayPeriod = `${windWavePeriod.toFixed(1)}s${isEst ? ' (est.)' : ''}`;
          if (windWaveDir != null) {
            displayDir = `${Math.round(windWaveDir)}${isEst ? '° (est.)' : ''}`;
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

      cards.push({ icon: Wind, label: 'Height', value: displayHeight, color: 'text-emerald-400' });
      if (showStatus) {
        cards.push({ icon: Wind, label: 'Status', value: showStatus, color: statusColor });
      } else {
        if (displayPeriod !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({ icon: Wind, label: 'Period', value: displayPeriod, color: 'text-emerald-300' });
        }
        if (displayDir !== '--' || isExactPointLoading || isExactPointTimeout || isExactPointError || isNoCoverage) {
          cards.push({
            icon: ArrowUp,
            label: displayCompass || 'Dir',
            value: displayDir,
            color: 'text-emerald-200',
            rotate: windWaveDir != null ? (windWaveDir + 180) % 360 : undefined
          });
        }
      }
    }
  }

  if (isExactPointAuthority && isExactPointLoading && waveHeight != null) {
    cards.push({
      icon: Waves,
      label: 'Source',
      value: 'Loading (Grid Fallback)',
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
