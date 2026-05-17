import React from 'react';
import { useAdaptivePerformance } from '../hooks/useAdaptivePerformance';
import '../styles/wraparound.css'; // Make sure this provides .aurora-bg-container and .aurora-bg-wave

export var AdaptiveBackground = () => {
  const { shouldAnimate } = useAdaptivePerformance();

  return (
    <div className={`aurora-bg-container ${!shouldAnimate ? 'static-fallback' : ''}`}>
      <div className="aurora-bg-wave" />
    </div>
  );
};
