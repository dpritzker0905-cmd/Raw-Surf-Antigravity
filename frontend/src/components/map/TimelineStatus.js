import React from 'react';
import ForecastTimeStatus from './ForecastTimeStatus';
import WindLaneStatus from './WindLaneStatus';

// The status lines under the forecast timeline, rendered once by MapWeatherControls' renderTimeline, so the desktop
// panel and both mobile layouts all carry them: the displayed-forecast-time check, and the wind model at this hour
// (HRRR near the US to its horizon, then GFS; windLane.js, D-017).
export default function TimelineStatus({ model, layer, hour, theme, showTime, showWind }) {
  return (
    <>
      {showTime && <ForecastTimeStatus model={model} layer={layer} hour={hour} theme={theme} />}
      <WindLaneStatus theme={theme} active={!!showWind} />
    </>
  );
}
