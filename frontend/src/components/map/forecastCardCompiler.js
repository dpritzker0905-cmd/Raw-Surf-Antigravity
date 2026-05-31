import { Wind, Waves, CloudRain, Snowflake, ArrowUp, Droplets, Gauge, Thermometer } from 'lucide-react';

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
  useExactPoint,
  waveHeight,
  wavePeriod,
  waveDir,
  swell1Supported,
  swell1Height,
  swell1Period,
  swell1Dir,
  swell2ModelUnavailable,
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
  mToFt,
  degToCompass,
  getClampedValue,
  getBiasAdjustedLocal,
  isLoading
}) {
  const cards = [];

  if (activeLayer === 'rain' || activeLayer === 'radar') {
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

  if (activeLayer === 'pressure') {
    cards.push({ icon: Gauge, label: 'Pressure', value: pressure != null ? `${Math.round(pressure)} hPa` : '--', color: 'text-rose-400' });
  }

  if (activeLayer === 'waves') {
    let displayHeight = '--';
    let displayPeriod = '--';
    let displayPeak = null;
    let displayDir = '--';
    let displayCompass = '';

    const isNoCoverage = isExactPointAuthority && exactPointStatus === 'exact_no_time_coverage';

    if (isExactPointAuthority && isExactPointLoading) {
      displayHeight = 'Loading...';
      displayPeriod = 'Loading...';
      displayDir = 'Loading...';
    } else if (isExactPointAuthority && isExactPointTimeout) {
      displayHeight = 'Timeout';
      displayPeriod = 'Timeout';
      displayDir = 'Timeout';
    } else if (isExactPointAuthority && isExactPointError) {
      displayHeight = 'Unavailable';
      displayPeriod = 'Unavailable';
      displayDir = 'Unavailable';
    } else if (isNoCoverage) {
      displayHeight = 'No Coverage';
      displayPeriod = 'No Coverage';
      displayDir = 'No Coverage';
    } else {
      const hFt = mToFt(waveHeight);
      const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
      displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : ''}` : '--';
      if (wavePeriod != null) displayPeriod = `${wavePeriod.toFixed(1)}s`;
      if (useExactPoint?.wave_peak_period != null && useExactPoint.wave_peak_period > 0) {
        displayPeak = `${useExactPoint.wave_peak_period.toFixed(1)}s`;
      }
      if (waveDir != null) {
        displayDir = `${Math.round(waveDir)}`;
        displayCompass = degToCompass(waveDir);
      }
    }

    cards.push({ icon: Waves, label: 'Height', value: displayHeight, color: 'text-blue-300' });
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

      const isNoCoverage = isExactPointAuthority && exactPointStatus === 'exact_no_time_coverage';

      if (isExactPointAuthority && isExactPointLoading) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout) {
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
      } else if (isExactPointAuthority && isExactPointError) {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else if (isNoCoverage) {
        displayHeight = 'No Coverage';
        displayPeriod = 'No Coverage';
        displayDir = 'No Coverage';
      } else {
        const swell1LowEnergy = swell1Height == null || swell1Height < 0.05;
        const hFt = mToFt(swell1Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : ''}` : '--';
        if (!swell1LowEnergy) {
          if (swell1Period != null && swell1Period > 0) displayPeriod = `${swell1Period.toFixed(1)}s`;
          if (useExactPoint?.swell_wave_peak_period != null && useExactPoint.swell_wave_peak_period > 0) {
            displayPeak = `${useExactPoint.swell_wave_peak_period.toFixed(1)}s`;
          }
          if (swell1Dir != null) {
            displayDir = `${Math.round(swell1Dir)}`;
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

      const isNoCoverage = isExactPointAuthority && exactPointStatus === 'exact_no_time_coverage';

      if (isExactPointAuthority && isExactPointLoading) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout) {
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
      } else if (isExactPointAuthority && isExactPointError) {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else if (isNoCoverage) {
        displayHeight = 'No Coverage';
        displayPeriod = 'No Coverage';
        displayDir = 'No Coverage';
      } else {
        const swell2LowEnergy = swell2Height == null || swell2Height < 0.10;
        const hFt = mToFt(swell2Height);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : ''}` : '--';
        if (!swell2LowEnergy) {
          if (swell2Period != null && swell2Period > 0) displayPeriod = `${swell2Period.toFixed(1)}s`;
          if (swell2Dir != null) {
            displayDir = `${Math.round(swell2Dir)}`;
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

      const isNoCoverage = isExactPointAuthority && exactPointStatus === 'exact_no_time_coverage';

      if (isExactPointAuthority && isExactPointLoading) {
        displayHeight = 'Loading...';
        displayPeriod = 'Loading...';
        displayDir = 'Loading...';
      } else if (isExactPointAuthority && isExactPointTimeout) {
        displayHeight = 'Timeout';
        displayPeriod = 'Timeout';
        displayDir = 'Timeout';
      } else if (isExactPointAuthority && isExactPointError) {
        displayHeight = 'Unavailable';
        displayPeriod = 'Unavailable';
        displayDir = 'Unavailable';
      } else if (isNoCoverage) {
        displayHeight = 'No Coverage';
        displayPeriod = 'No Coverage';
        displayDir = 'No Coverage';
      } else {
        const windWaveLowEnergy = windWaveHeight == null || windWaveHeight < 0.05;
        const hFt = mToFt(windWaveHeight);
        const isStale = isExactPointAuthority && exactPointStatus === 'exact_stale_available';
        displayHeight = hFt != null ? `${hFt} ft${isStale ? ' (latest)' : ''}` : '--';
        if (!windWaveLowEnergy) {
          if (windWavePeriod != null && windWavePeriod > 0) displayPeriod = `${windWavePeriod.toFixed(1)}s`;
          if (windWaveDir != null) {
            displayDir = `${Math.round(windWaveDir)}`;
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

  return cards;
}
