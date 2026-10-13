import React, { useEffect, useState } from 'react';
import { describeWindLane, windLaneOnScreen } from './windLane';

// Which wind model is on screen at this hour (HRRR near the US to its horizon, then GFS; windLane.js, D-017). A derived
// readout of the grid the engine is drawing, never a trigger for a request; polled like ForecastTimeStatus because the
// engine's resident grids live outside React. Rendered once in renderTimeline, so all three layouts show it.
export default function WindLaneStatus({ theme, active }) {
  const [label, setLabel] = useState(null);
  useEffect(() => {
    if (!active) { setLabel(null); return undefined; }
    const read = () => {
      const next = describeWindLane(windLaneOnScreen());
      setLabel((prev) => (prev && next && prev.short === next.short && prev.text === next.text ? prev : next));
    };
    read();
    const timer = setInterval(read, 500);
    return () => clearInterval(timer);
  }, [active]);
  if (!active || !label) return null;
  const tone = theme === 'light' ? 'text-gray-700' : theme === 'beach' ? 'text-cyan-100' : 'text-gray-300';
  return (
    <div role="status" aria-live="polite" className={`mt-1 text-[10px] font-semibold ${tone}`} data-testid="wind-lane-status">
      <span aria-hidden="true">{label.short}</span>
      <span className="sr-only">{label.text}</span>
    </div>
  );
}
