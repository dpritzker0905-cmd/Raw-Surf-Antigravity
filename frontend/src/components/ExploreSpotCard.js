/**
 * ExploreSpotCard - Engaging surf spot card with conditions, forecast, and actions
 * Used in the Explore tab's "Surf Spots" section
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Waves, MapPin, Camera, Users, ChevronDown, ChevronUp, 
  Navigation, Clock, Compass, Crown, Lock, Radio, Star
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';

// Conditions color mapping
const conditionColors = {
  "Flat": "bg-gray-500",
  "Ankle High": "bg-blue-400",
  "Knee High": "bg-blue-500",
  "Waist High": "bg-emerald-400",
  "Chest High": "bg-emerald-500",
  "Head High": "bg-yellow-400",
  "Overhead": "bg-orange-400",
  "Double Overhead": "bg-orange-500",
  "Triple Overhead+": "bg-red-500"
};

// Direction arrow component
const DirectionArrow = ({ direction, className = "" }) => {
  if (!direction && direction !== 0) return null;
  return (
    <div 
      className={`w-4 h-4 ${className}`}
      style={{ transform: `rotate(${direction}deg)` }}
    >
      <Compass className="w-full h-full" />
    </div>
  );
};

// Forecast day badge - index 0 is now Tomorrow (backend skips today)
const ForecastDayBadge = ({ day, index, isLocked = false }) => {
  const dateObj = new Date(day.date);
  // index 0 = Tomorrow, index 1 = Day after tomorrow, etc.
  const dayName = index === 0 ? 'Tom' : index === 1 ? dateObj.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3) : dateObj.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
  
  if (isLocked) {
    return (
      <div className="flex flex-col items-center px-2 py-1 bg-zinc-800/50 rounded-lg opacity-50">
        <span className="text-[10px] text-gray-500">{dayName}</span>
        <Lock className="w-3 h-3 text-purple-400 my-0.5" />
        <span className="text-[9px] text-gray-600">--</span>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col items-center px-2 py-1 bg-zinc-800 rounded-lg">
      <span className="text-[10px] text-gray-400">{dayName}</span>
      <span className="text-xs font-bold text-white">{day.wave_height_max}ft</span>
      <span className={`text-[9px] ${conditionColors[day.label]?.replace('bg-', 'text-') || 'text-gray-400'}`}>
        {day.label?.split(' ')[0]}
      </span>
    </div>
  );
};

const ExploreSpotCard = ({ spot, userSubscriptionTier = 'free' }) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  
  const conditions = spot.current_conditions;
  const hasPhotographers = spot.active_photographers?.length > 0;
  const hasReports = spot.recent_reports?.length > 0;
  
  // Calculate forecast access
  const forecastDaysAllowed = spot.forecast_days_allowed || 3;
  const forecast = spot.forecast || [];
  
  const handleViewSpot = () => {
    navigate(`/spot-hub/${spot.id}`);
  };
  
  const handleViewOnMap = () => {
    navigate(`/map?spot=${spot.id}&lat=${spot.latitude}&lng=${spot.longitude}`);
  };

  return (
    <motion.div
      layout
      className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-xl overflow-hidden hover:border-cyan-500/30 transition-all duration-300 group"
      data-testid={`explore-spot-card-${spot.id}`}
    >
      {/* Image Header */}
      <div className="relative h-32 overflow-hidden">
        {spot.image_url ? (
          <img 
            src={spot.image_url} 
            alt={spot.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center">
            <Waves className="w-12 h-12 text-white/30" />
          </div>
        )}
        
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        
        {/* Live Photographers Badge */}
        {hasPhotographers && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-red-500/90 backdrop-blur-sm rounded-full animate-pulse">
            <Radio className="w-3 h-3 text-white" />
            <span className="text-[10px] font-bold text-white">
              {spot.active_photographers.length} LIVE
            </span>
          </div>
        )}
        
        {/* Current Conditions Badge */}
        {conditions && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-blue-500/90 backdrop-blur-sm rounded-full px-2 py-1">
            <Waves className="w-3 h-3 text-white" />
            <span className="text-xs font-bold text-white">{conditions.wave_height_ft}ft</span>
          </div>
        )}
        
        {/* Spot Name & Location */}
        <div className="absolute bottom-2 left-2 right-2">
          <h3 className="font-bold text-white text-lg truncate">{spot.name}</h3>
          <div className="flex items-center gap-2 text-gray-300 text-xs">
            <MapPin className="w-3 h-3" />
            <span>{spot.region}</span>
            {spot.difficulty && (
              <>
                <span className="text-gray-600">•</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {spot.difficulty}
                </Badge>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Conditions Summary Bar */}
      {conditions && (
        <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Wave Height */}
            <div className="flex items-center gap-1">
              <Waves className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-white">{conditions.wave_height_ft}ft</span>
              <Badge className={`text-[10px] ${conditionColors[conditions.label] || 'bg-gray-500'}`}>
                {conditions.label}
              </Badge>
            </div>
            
            {/* Period */}
            {conditions.wave_period && (
              <div className="flex items-center gap-1 text-gray-400 text-xs">
                <Clock className="w-3 h-3" />
                <span>{conditions.wave_period}s</span>
              </div>
            )}
            
            {/* Direction */}
            {conditions.wave_direction && (
              <div className="flex items-center gap-1 text-gray-400">
                <DirectionArrow direction={conditions.wave_direction} className="text-yellow-400" />
                <span className="text-xs">{conditions.wave_direction}°</span>
              </div>
            )}
          </div>
          
          {/* Expand Toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-zinc-800 rounded-full transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
        </div>
      )}
      
      {/* Forecast Strip */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-gray-400">Forecast</span>
          <Badge className={`text-[9px] ${userSubscriptionTier === 'premium' ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-700 text-gray-400'}`}>
            {forecastDaysAllowed} Days
          </Badge>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {forecast.slice(0, 5).map((day, i) => (
            <ForecastDayBadge 
              key={day.date} 
              day={day} 
              index={i}
              isLocked={i >= forecastDaysAllowed}
            />
          ))}
          {/* Show locked days indicator */}
          {forecast.length > forecastDaysAllowed && userSubscriptionTier !== 'premium' && (
            <div 
              className="flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg cursor-pointer hover:border-purple-400/50"
              onClick={() => navigate('/settings?tab=billing')}
            >
              <Crown className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-purple-400 whitespace-nowrap">+{Math.min(10 - forecastDaysAllowed, forecast.length - forecastDaysAllowed)} days</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Expanded Section */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Spot Details */}
            <div className="px-3 py-2 border-b border-zinc-800 space-y-2">
              {spot.wave_type && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Break:</span>
                  <span className="text-white">{spot.wave_type}</span>
                </div>
              )}
              {spot.best_tide && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Best Tide:</span>
                  <span className="text-white">{spot.best_tide}</span>
                </div>
              )}
              {spot.best_swell && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Best Swell:</span>
                  <span className="text-white">{spot.best_swell}</span>
                </div>
              )}
              {spot.description && (
                <p className="text-xs text-gray-400 line-clamp-2">{spot.description}</p>
              )}
            </div>
            
            {/* Active Photographers */}
            {hasPhotographers && (
              <div className="px-3 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-2 mb-2">
                  <Camera className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-medium text-white">Photographers Shooting Now</span>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {spot.active_photographers.map((photographer) => (
                    <div 
                      key={photographer.id}
                      onClick={() => navigate(`/profile/${photographer.id}`)}
                      className="flex items-center gap-2 px-2 py-1.5 bg-zinc-800 rounded-lg cursor-pointer hover:bg-zinc-700 transition-colors flex-shrink-0"
                    >
                      <Avatar className="w-6 h-6 ring-2 ring-red-500">
                        <AvatarImage src={photographer.avatar_url} />
                        <AvatarFallback className="text-[10px]">
                          {photographer.full_name?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-xs font-medium text-white truncate max-w-[80px]">
                          {photographer.full_name?.split(' ')[0]}
                        </p>
                        {photographer.session_price && (
                          <p className="text-[10px] text-emerald-400">
                            ${photographer.session_price}/session
                          </p>
                        )}
                      </div>
                      {photographer.is_streaming && (
                        <Badge className="bg-red-500 text-[8px] px-1">LIVE</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Recent Reports */}
            {hasReports && (
              <div className="px-3 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-white">Recent Reports</span>
                </div>
                <div className="space-y-1">
                  {spot.recent_reports.slice(0, 2).map((report) => (
                    <div key={report.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        {report.conditions && (
                          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
                            {report.conditions}
                          </Badge>
                        )}
                        {report.wave_height && (
                          <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30">
                            {report.wave_height}
                          </Badge>
                        )}
                        {report.crowd_level && (
                          <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                            {report.crowd_level}
                          </Badge>
                        )}
                      </div>
                      {report.rating && (
                        <div className="flex items-center gap-0.5 text-yellow-400">
                          <Star className="w-3 h-3 fill-current" />
                          <span>{report.rating}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Action Buttons */}
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={handleViewSpot}
          className="flex-1 flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-lg text-white text-sm font-medium transition-all"
          data-testid={`view-spot-${spot.id}`}
        >
          <Waves className="w-4 h-4" />
          View Spot
        </button>
        <button
          onClick={handleViewOnMap}
          className="flex items-center justify-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white text-sm transition-colors"
          data-testid={`view-map-${spot.id}`}
        >
          <Navigation className="w-4 h-4" />
          Map
        </button>
      </div>
    </motion.div>
  );
};

export default ExploreSpotCard;
