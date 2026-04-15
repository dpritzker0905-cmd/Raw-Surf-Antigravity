/**
 * WaveDirectionIndicator - Visual compass showing wave/wind direction
 * Displays an arrow or wave icon pointing in the direction waves are coming from
 */

import React from 'react';
import { Waves, Wind, Navigation2 } from 'lucide-react';

/**
 * Convert compass direction to degrees
 */
const directionToDegrees = (direction) => {
  const directions = {
    'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
    'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
    'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
    'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
  };
  return directions[direction?.toUpperCase()] ?? 0;
};

/**
 * Mini compass indicator with rotating arrow
 */
export const DirectionCompass = ({ 
  degrees, 
  direction,
  type = 'wave', // 'wave' or 'wind'
  size = 'sm',
  showLabel = true,
  className = ''
}) => {
  // Use degrees if provided, otherwise convert direction string
  const rotationDegrees = degrees ?? directionToDegrees(direction);
  
  // Sizes
  const sizes = {
    xs: { container: 'w-6 h-6', icon: 'w-3 h-3', text: 'text-[10px]' },
    sm: { container: 'w-8 h-8', icon: 'w-4 h-4', text: 'text-xs' },
    md: { container: 'w-12 h-12', icon: 'w-6 h-6', text: 'text-sm' },
    lg: { container: 'w-16 h-16', icon: 'w-8 h-8', text: 'text-base' }
  };
  
  const sizeConfig = sizes[size] || sizes.sm;
  
  // Colors based on type
  const colors = {
    wave: {
      bg: 'bg-cyan-500/20',
      border: 'border-cyan-500/30',
      icon: 'text-cyan-400',
      arrow: 'fill-cyan-400'
    },
    wind: {
      bg: 'bg-emerald-500/20',
      border: 'border-emerald-500/30',
      icon: 'text-emerald-400',
      arrow: 'fill-emerald-400'
    }
  };
  
  const colorConfig = colors[type] || colors.wave;
  
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div 
        className={`${sizeConfig.container} ${colorConfig.bg} ${colorConfig.border} border rounded-full flex items-center justify-center relative`}
        title={`${type === 'wave' ? 'Wave' : 'Wind'} direction: ${direction || `${rotationDegrees}°`}`}
      >
        {/* Compass ring markers */}
        <div className="absolute inset-0">
          {['N', 'E', 'S', 'W'].map((d, i) => (
            <span 
              key={d}
              className={`absolute ${sizeConfig.text} text-gray-500 font-medium`}
              style={{
                top: i === 0 ? '2px' : i === 2 ? 'auto' : '50%',
                bottom: i === 2 ? '2px' : 'auto',
                left: i === 3 ? '2px' : i === 1 ? 'auto' : '50%',
                right: i === 1 ? '2px' : 'auto',
                transform: i === 0 || i === 2 ? 'translateX(-50%)' : 'translateY(-50%)'
              }}
            >
              {size !== 'xs' && d}
            </span>
          ))}
        </div>
        
        {/* Direction arrow */}
        <div 
          className="transition-transform duration-300"
          style={{ transform: `rotate(${rotationDegrees}deg)` }}
        >
          {type === 'wave' ? (
            <Waves className={`${sizeConfig.icon} ${colorConfig.icon}`} />
          ) : (
            <Navigation2 className={`${sizeConfig.icon} ${colorConfig.icon}`} />
          )}
        </div>
      </div>
      
      {showLabel && direction && (
        <span className={`${sizeConfig.text} ${colorConfig.icon} font-medium`}>
          {direction}
        </span>
      )}
    </div>
  );
};

/**
 * Combined wave direction display with height and period
 */
export const WaveConditionsBadge = ({
  waveHeightFt,
  wavePeriodSec,
  waveDirection,
  waveDirectionDegrees,
  className = ''
}) => {
  if (!waveHeightFt && !waveDirection) return null;
  
  return (
    <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 ${className}`}>
      <Waves className="w-4 h-4 text-cyan-400" />
      
      {waveHeightFt && (
        <span className="text-sm text-cyan-300 font-medium">
          {waveHeightFt}ft
        </span>
      )}
      
      {wavePeriodSec && (
        <span className="text-xs text-cyan-400/70">
          @{wavePeriodSec}s
        </span>
      )}
      
      {waveDirection && (
        <DirectionCompass
          degrees={waveDirectionDegrees}
          direction={waveDirection}
          type="wave"
          size="xs"
          showLabel={true}
        />
      )}
    </div>
  );
};

/**
 * Combined wind direction display with speed
 */
export const WindConditionsBadge = ({
  windSpeedMph,
  windDirection,
  className = ''
}) => {
  if (!windSpeedMph && !windDirection) return null;
  
  return (
    <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 ${className}`}>
      <Wind className="w-4 h-4 text-emerald-400" />
      
      {windSpeedMph && (
        <span className="text-sm text-emerald-300 font-medium">
          {windSpeedMph}mph
        </span>
      )}
      
      {windDirection && (
        <DirectionCompass
          direction={windDirection}
          type="wind"
          size="xs"
          showLabel={true}
        />
      )}
    </div>
  );
};

/**
 * Full conditions panel with wave and wind
 */
export const ConditionsPanel = ({
  waveHeightFt,
  wavePeriodSec,
  waveDirection,
  waveDirectionDegrees,
  windSpeedMph,
  windDirection,
  tideStatus,
  tideHeightFt,
  className = ''
}) => {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <WaveConditionsBadge
        waveHeightFt={waveHeightFt}
        wavePeriodSec={wavePeriodSec}
        waveDirection={waveDirection}
        waveDirectionDegrees={waveDirectionDegrees}
      />
      
      <WindConditionsBadge
        windSpeedMph={windSpeedMph}
        windDirection={windDirection}
      />
      
      {tideStatus && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
          <span className="text-sm text-blue-300 font-medium capitalize">
            {tideStatus}
          </span>
          {tideHeightFt && (
            <span className="text-xs text-blue-400/70">
              {tideHeightFt}ft
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default DirectionCompass;
