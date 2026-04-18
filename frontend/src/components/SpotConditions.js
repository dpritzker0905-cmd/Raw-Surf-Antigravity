import React, { useState, useEffect } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { Waves, Clock, Compass, Users, Star, MessageSquare, ChevronDown, ChevronUp, Loader2, ArrowUp, ArrowDown, Droplets, Calendar, Lock, Crown } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import logger from '../utils/logger';


// Get subscription tier for forecast access
const getForecastDays = (subscriptionTier) => {
  if (!subscriptionTier || subscriptionTier === 'free') return 3;
  if (subscriptionTier === 'basic') return 3;
  return 10; // Premium gets 10-day forecast
};

// Check if user has premium forecast access
const hasPremiumForecast = (subscriptionTier) => {
  return subscriptionTier === 'premium' || subscriptionTier === 'pro' || subscriptionTier === 'gold';
};

// Conditions badge colors
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

export const SpotConditions = ({ spotId, spotName, compact = false }) => {
  const { user } = useAuth();
  const [conditions, setConditions] = useState(null);
  const [tideData, setTideData] = useState(null);
  const [reports, setReports] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [forecastExpanded, setForecastExpanded] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState({
    wave_height: '',
    conditions: '',
    wind_direction: '',
    crowd_level: '',
    rating: 0,
    notes: ''
  });
  
  // Get forecast days based on user's subscription
  const forecastDaysAllowed = getForecastDays(user?.subscription_tier);
  const isPremiumUser = hasPremiumForecast(user?.subscription_tier);

  useEffect(() => {
    if (spotId) {
      fetchConditions();
      fetchTideData();
      fetchTodaysReports();
      fetchForecast();
    }
  }, [spotId]);

  const fetchConditions = async () => {
    try {
      const response = await apiClient.get(`/conditions/${spotId}`);
      setConditions(response.data);
    } catch (error) {
      logger.error('Error fetching conditions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTideData = async () => {
    try {
      const response = await apiClient.get(`/tides/${spotId}`);
      if (!response.data.error) {
        setTideData(response.data);
      }
    } catch (error) {
      logger.error('Error fetching tide data:', error);
    }
  };

  const fetchTodaysReports = async () => {
    try {
      const response = await apiClient.get(`/surf-reports/today/${spotId}`);
      setReports(response.data);
    } catch (error) {
      logger.error('Error fetching reports:', error);
    }
  };

  const fetchForecast = async () => {
    try {
      const response = await apiClient.get(`/conditions/forecast/${spotId}`);
      if (response.data?.forecast) {
        setForecast(response.data.forecast);
      }
    } catch (error) {
      logger.error('Error fetching forecast:', error);
    }
  };

  const submitReport = async () => {
    if (!user?.id) {
      toast.error('Please login to submit a report');
      return;
    }

    setReportLoading(true);
    try {
      await apiClient.post(`/surf-reports?user_id=${user.id}`, {
        spot_id: spotId,
        ...reportData
      });
      toast.success('Report submitted! Thanks for sharing 🤙');
      setShowReportModal(false);
      setReportData({ wave_height: '', conditions: '', wind_direction: '', crowd_level: '', rating: 0, notes: '' });
      fetchTodaysReports();
    } catch (error) {
      toast.error('Failed to submit report');
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-yellow-400" />
      </div>
    );
  }

  // Compact view for cards
  if (compact) {
    const waveHeight = conditions?.current?.wave_height_ft || 0;
    const label = conditions?.current ? getConditionsLabel(waveHeight) : "No Data";
    
    return (
      <div className="flex items-center gap-2">
        <Waves className="w-4 h-4 text-blue-400" />
        <span className="text-sm text-white font-medium">
          {waveHeight > 0 ? `${waveHeight}ft` : label}
        </span>
        <Badge className={`text-[10px] ${conditionColors[label] || 'bg-gray-500'}`}>
          {label}
        </Badge>
      </div>
    );
  }

  // Full view
  const current = conditions?.current;
  const waveLabel = current ? getConditionsLabel(current.wave_height_ft) : "No Data";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden" data-testid="spot-conditions">
      {/* Header with current conditions */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Waves className="w-5 h-5 text-blue-400" />
            Current Conditions
          </h3>
          <Badge className={`${conditionColors[waveLabel] || 'bg-gray-500'}`}>
            {waveLabel}
          </Badge>
        </div>

        {current ? (
          <div className="grid grid-cols-2 gap-4">
            {/* Wave Height */}
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-white">{current.wave_height_ft}<span className="text-lg">ft</span></p>
              <p className="text-xs text-gray-400">Wave Height</p>
            </div>
            
            {/* Swell */}
            <div className="bg-zinc-800 rounded-lg p-3 text-center">
              <p className="text-3xl font-bold text-white">{current.swell_height_ft || 0}<span className="text-lg">ft</span></p>
              <p className="text-xs text-gray-400">Swell</p>
            </div>

            {/* Direction */}
            <div className="flex items-center gap-3 col-span-2">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-gray-300">
                  {current.wave_direction ? `${current.wave_direction}°` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-gray-300">
                  {current.wave_period ? `${current.wave_period}s period` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Unable to fetch conditions</p>
        )}

        {/* Source attribution */}
        <p className="text-[10px] text-gray-500 mt-3">
          Data from Open-Meteo Marine API • Updated: {current?.updated_at ? new Date(current.updated_at).toLocaleTimeString() : 'N/A'}
        </p>
      </div>

      {/* Tide Data Section */}
      {tideData && tideData.tides && tideData.tides.length > 0 && (
        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Droplets className="w-5 h-5 text-cyan-400" />
            <h4 className="font-bold text-white text-sm">Today's Tides</h4>
            {tideData.current_status && (
              <Badge className={`text-[10px] ${
                tideData.current_status === 'Rising' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'
              }`}>
                {tideData.current_status === 'Rising' ? (
                  <><ArrowUp className="w-3 h-3 mr-1" /> Rising</>
                ) : (
                  <><ArrowDown className="w-3 h-3 mr-1" /> Falling</>
                )}
              </Badge>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            {tideData.tides.slice(0, 4).map((tide, index) => {
              const tideTime = new Date(tide.time);
              const isHigh = tide.type === 'High';
              const isPast = tideTime < new Date();
              
              return (
                <div 
                  key={index} 
                  className={`p-2 rounded-lg ${isPast ? 'bg-zinc-800/50 opacity-60' : 'bg-zinc-800'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {isHigh ? (
                      <ArrowUp className="w-4 h-4 text-cyan-400" />
                    ) : (
                      <ArrowDown className="w-4 h-4 text-blue-400" />
                    )}
                    <span className={`text-xs font-medium ${isHigh ? 'text-cyan-400' : 'text-blue-400'}`}>
                      {tide.type} Tide
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-white">
                      {tideTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xs text-gray-400">
                      {parseFloat(tide.height).toFixed(1)}ft
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          
          <p className="text-[10px] text-gray-500 mt-2">
            Data from NOAA Tides & Currents
          </p>
        </div>
      )}

      {/* Forecast Section - Tiered Access */}
      {forecast.length > 0 && (
        <div className="border-t border-zinc-800">
          <button
            onClick={() => setForecastExpanded(!forecastExpanded)}
            className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">Surf Forecast</span>
              <Badge className={`text-[10px] ${isPremiumUser ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-700 text-gray-400'}`}>
                {forecastDaysAllowed} Day{forecastDaysAllowed > 1 ? 's' : ''}
              </Badge>
            </div>
            {forecastExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          
          {forecastExpanded && (
            <div className="px-4 pb-4 space-y-3">
              {/* Forecast Days Grid */}
              <div className="space-y-2">
                {forecast.slice(0, forecastDaysAllowed).map((day, index) => {
                  const dateObj = new Date(day.date);
                  const dayName = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                  const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  
                  return (
                    <div key={day.date} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="text-center w-14">
                          <p className="text-white font-medium text-sm">{dayName}</p>
                          <p className="text-gray-500 text-[10px]">{dateStr}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Waves className="w-4 h-4 text-blue-400" />
                          <span className="text-white font-bold">{day.wave_height_min}-{day.wave_height_max}ft</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] ${conditionColors[day.label] || 'bg-gray-500'}`}>
                          {day.label}
                        </Badge>
                        {day.swell_period && (
                          <span className="text-gray-400 text-xs">{day.swell_period}s</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Premium Upsell - Show if user doesn't have premium */}
              {!isPremiumUser && forecast.length > forecastDaysAllowed && (
                <div className="p-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span className="text-white font-medium text-sm">Unlock 10-Day Forecast</span>
                  </div>
                  <p className="text-gray-400 text-xs mb-2">
                    Premium members get extended 10-day forecasts and priority buoy data.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                      {forecast.slice(forecastDaysAllowed, forecastDaysAllowed + 3).map((day, i) => (
                        <div key={i} className="w-6 h-6 rounded-full bg-zinc-700/80 backdrop-blur flex items-center justify-center border border-purple-500/30">
                          <Lock className="w-3 h-3 text-purple-400" />
                        </div>
                      ))}
                    </div>
                    <span className="text-purple-400 text-xs">+{Math.min(forecast.length - forecastDaysAllowed, 7)} more days locked</span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full mt-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs"
                    onClick={() => window.location.href = '/settings?tab=billing'}
                    data-testid="upgrade-forecast-btn"
                  >
                    <Crown className="w-3 h-3 mr-1" />
                    Upgrade to Premium
                  </Button>
                </div>
              )}
              
              <p className="text-[10px] text-gray-500">
                Forecast from Open-Meteo Marine API
              </p>
            </div>
          )}
        </div>
      )}

      {/* Community Reports Section */}
      <div className="border-t border-zinc-800">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-white">Community Reports</span>
            {reports?.report_count > 0 && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-400/30">
                {reports.report_count} today
              </Badge>
            )}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3">
            {/* Consensus */}
            {reports?.consensus_conditions && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400">Consensus:</span>
                <Badge className="bg-emerald-500/20 text-emerald-400">{reports.consensus_conditions}</Badge>
                {reports.consensus_crowd && (
                  <Badge className="bg-blue-500/20 text-blue-400">{reports.consensus_crowd}</Badge>
                )}
                {reports.average_rating && (
                  <div className="flex items-center gap-1 text-yellow-400">
                    <Star className="w-3 h-3 fill-current" />
                    {reports.average_rating}
                  </div>
                )}
              </div>
            )}

            {/* Recent Reports */}
            {reports?.reports?.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {reports.reports.slice(0, 5).map((report) => (
                  <div key={report.id} className="bg-zinc-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center">
                        {report.user_avatar ? (
                          <img src={report.user_avatar} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-gray-400">{report.user_name?.charAt(0)}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-300">{report.user_name}</span>
                      <span className="text-[10px] text-gray-500 ml-auto">
                        {new Date(report.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {report.wave_height && <Badge className="bg-blue-500/20 text-blue-300 text-[10px]">{report.wave_height}</Badge>}
                      {report.conditions && <Badge className="bg-emerald-500/20 text-emerald-300 text-[10px]">{report.conditions}</Badge>}
                      {report.crowd_level && <Badge className="bg-purple-500/20 text-purple-300 text-[10px]">{report.crowd_level}</Badge>}
                    </div>
                    {report.notes && <p className="text-xs text-gray-400 mt-1">{report.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">No reports yet today. Be the first!</p>
            )}

            {/* Submit Report Button */}
            <Button
              onClick={() => setShowReportModal(true)}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
              data-testid="submit-report-btn"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Share Your Report
            </Button>
          </div>
        )}
      </div>

      {/* Submit Report Modal */}
      <Dialog open={showReportModal} onOpenChange={setShowReportModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
              Submit Surf Report
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <p className="text-sm text-gray-400">Share current conditions at {spotName}</p>

            {/* Wave Height */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Wave Height</label>
              <Select value={reportData.wave_height} onValueChange={(v) => setReportData(prev => ({ ...prev, wave_height: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="Select wave height" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="Flat" className="text-white">Flat</SelectItem>
                  <SelectItem value="1-2ft" className="text-white">1-2ft (Ankle-Knee)</SelectItem>
                  <SelectItem value="2-3ft" className="text-white">2-3ft (Knee-Waist)</SelectItem>
                  <SelectItem value="3-4ft" className="text-white">3-4ft (Waist-Chest)</SelectItem>
                  <SelectItem value="4-5ft" className="text-white">4-5ft (Chest-Head)</SelectItem>
                  <SelectItem value="5-6ft" className="text-white">5-6ft (Head High)</SelectItem>
                  <SelectItem value="6-8ft" className="text-white">6-8ft (Overhead)</SelectItem>
                  <SelectItem value="8ft+" className="text-white">8ft+ (Double OH+)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Conditions */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Conditions</label>
              <Select value={reportData.conditions} onValueChange={(v) => setReportData(prev => ({ ...prev, conditions: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="How's it looking?" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="Glassy" className="text-white">🪞 Glassy</SelectItem>
                  <SelectItem value="Clean" className="text-white">✨ Clean</SelectItem>
                  <SelectItem value="Fair" className="text-white">👍 Fair</SelectItem>
                  <SelectItem value="Choppy" className="text-white">🌊 Choppy</SelectItem>
                  <SelectItem value="Messy" className="text-white">💨 Messy</SelectItem>
                  <SelectItem value="Blown Out" className="text-white">🌀 Blown Out</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Wind Direction */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Wind</label>
              <Select value={reportData.wind_direction} onValueChange={(v) => setReportData(prev => ({ ...prev, wind_direction: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="Wind direction" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="Offshore" className="text-white">🏄 Offshore (Good)</SelectItem>
                  <SelectItem value="Light Onshore" className="text-white">🌬️ Light Onshore</SelectItem>
                  <SelectItem value="Onshore" className="text-white">💨 Onshore</SelectItem>
                  <SelectItem value="Cross-shore" className="text-white">↔️ Cross-shore</SelectItem>
                  <SelectItem value="No Wind" className="text-white">🪶 No Wind</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Crowd Level */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Crowd</label>
              <Select value={reportData.crowd_level} onValueChange={(v) => setReportData(prev => ({ ...prev, crowd_level: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue placeholder="How crowded?" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="Empty" className="text-white">🏝️ Empty</SelectItem>
                  <SelectItem value="Light" className="text-white">👤 Light</SelectItem>
                  <SelectItem value="Moderate" className="text-white">👥 Moderate</SelectItem>
                  <SelectItem value="Crowded" className="text-white">👨‍👩‍👧‍👦 Crowded</SelectItem>
                  <SelectItem value="Packed" className="text-white">🚶‍♂️🚶‍♂️🚶 Packed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Rating */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Overall Rating</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setReportData(prev => ({ ...prev, rating: star }))}
                    className={`p-2 rounded-lg transition-colors ${
                      reportData.rating >= star ? 'text-yellow-400' : 'text-gray-600'
                    }`}
                  >
                    <Star className={`w-6 h-6 ${reportData.rating >= star ? 'fill-current' : ''}`} />
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Notes (optional)</label>
              <Textarea
                value={reportData.notes}
                onChange={(e) => setReportData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any other details..."
                className="bg-zinc-800 border-zinc-700 text-white min-h-[60px]"
              />
            </div>

            <Button
              onClick={submitReport}
              disabled={reportLoading || (!reportData.wave_height && !reportData.conditions)}
              className="w-full h-12 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold"
            >
              {reportLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Report'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Helper function
function getConditionsLabel(waveHeightFt) {
  if (waveHeightFt < 1) return "Flat";
  if (waveHeightFt < 2) return "Ankle High";
  if (waveHeightFt < 3) return "Knee High";
  if (waveHeightFt < 4) return "Waist High";
  if (waveHeightFt < 5) return "Chest High";
  if (waveHeightFt < 6) return "Head High";
  if (waveHeightFt < 8) return "Overhead";
  if (waveHeightFt < 10) return "Double Overhead";
  return "Triple Overhead+";
}

export default SpotConditions;
