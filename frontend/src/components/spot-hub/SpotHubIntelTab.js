/**
 * SpotHubIntelTab - Intelligence tab (Crowd Prediction + Optimal Surf Time)
 * Extracted from SpotHub.js for modularization (v70)
 */
import React from 'react';
import { Users, Waves, Wind, Clock, Calendar, Timer, TrendingUp, Compass, Brain, Loader2, BookOpen, ArrowRight } from 'lucide-react';
import { Badge } from '../ui/badge';

const SpotHubIntelTab = ({
  intelLoading, crowdPrediction, optimalTime,
  spot, isLight, navigate,
}) => (
  <div className="space-y-4">
    {intelLoading ? (
      <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-cyan-400" /></div>
    ) : (
      <>
        {/* Optimal Surf Time */}
        {optimalTime && optimalTime.has_data && optimalTime.optimal && (
          <div className={`p-4 rounded-xl border ${isLight ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200' : 'bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30'}`}>
            <div className="flex items-center gap-2 mb-3">
              <Timer className="w-4 h-4 text-green-400" />
              <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Best Time to Surf</span>
              {optimalTime.confidence && (
                <Badge className={`text-[9px] px-1.5 py-0 ${optimalTime.confidence === 'high' ? 'bg-green-500/20 text-green-400' : optimalTime.confidence === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {optimalTime.confidence} confidence
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              {optimalTime.optimal.best_day && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-green-400" />
                  <span className={`text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Best day:</span>
                  <span className={`text-sm font-bold ${isLight ? 'text-green-700' : 'text-green-400'}`}>{optimalTime.optimal.best_day}</span>
                  {optimalTime.optimal.best_day_avg_score && <span className="text-[10px] text-gray-500">({optimalTime.optimal.best_day_avg_score}/10)</span>}
                </div>
              )}
              {optimalTime.optimal.best_time_window && (
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-green-400" />
                  <span className={`text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Best window:</span>
                  <span className={`text-sm font-bold ${isLight ? 'text-green-700' : 'text-green-400'} capitalize`}>{optimalTime.optimal.best_time_window.replace('_', ' ')}</span>
                  {optimalTime.optimal.best_window_avg_score && <span className="text-[10px] text-gray-500">({optimalTime.optimal.best_window_avg_score}/10)</span>}
                </div>
              )}
              {optimalTime.optimal.preferred_tide && (
                <div className="flex items-center gap-2">
                  <Waves className="w-3.5 h-3.5 text-blue-400" />
                  <span className={`text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Preferred tide:</span>
                  <span className={`text-sm font-medium ${isLight ? 'text-blue-700' : 'text-blue-400'}`}>{optimalTime.optimal.preferred_tide}</span>
                </div>
              )}
              {optimalTime.optimal.preferred_wind && (
                <div className="flex items-center gap-2">
                  <Wind className="w-3.5 h-3.5 text-cyan-400" />
                  <span className={`text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>Preferred wind:</span>
                  <span className={`text-sm font-medium ${isLight ? 'text-cyan-700' : 'text-cyan-400'}`}>{optimalTime.optimal.preferred_wind}</span>
                </div>
              )}
            </div>
            <p className={`text-[10px] mt-3 ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Based on {optimalTime.data_points} logged sessions</p>
          </div>
        )}

        {/* No Data State */}
        {optimalTime && !optimalTime.has_data && (
          <div className={`p-4 rounded-xl border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/40 border-zinc-700'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Timer className="w-4 h-4 text-gray-400" />
              <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Best Time to Surf</span>
            </div>
            <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{optimalTime.message || 'Not enough data yet. Log sessions at this spot to unlock insights.'}</p>
          </div>
        )}

        {/* Crowd Prediction */}
        {crowdPrediction && crowdPrediction.current_prediction && (
          <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/60 border-zinc-700'}`}>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-orange-400" />
              <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Crowd Forecast</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Right now:</span>
              <span className={`text-sm font-bold capitalize ${
                {'low':'text-green-400','moderate':'text-yellow-400','high':'text-orange-400','packed':'text-red-400'}[crowdPrediction.current_prediction.level] || 'text-gray-400'
              }`}>{crowdPrediction.current_prediction.level}</span>
            </div>
            {crowdPrediction.today_summary && (
              <div className="space-y-1.5">
                {crowdPrediction.today_summary.peak_hour != null && (
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-red-400" />
                    <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Peak:</span>
                    <span className={`text-xs font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                      {crowdPrediction.today_summary.peak_hour > 12 ? `${crowdPrediction.today_summary.peak_hour - 12}pm` : crowdPrediction.today_summary.peak_hour === 0 ? '12am' : `${crowdPrediction.today_summary.peak_hour}am`}
                    </span>
                    <span className={`text-[10px] capitalize ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>({crowdPrediction.today_summary.peak_level})</span>
                  </div>
                )}
                {crowdPrediction.today_summary.quiet_hour != null && (
                  <div className="flex items-center gap-2">
                    <Compass className="w-3 h-3 text-green-400" />
                    <span className={`text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>Quietest:</span>
                    <span className={`text-xs font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                      {crowdPrediction.today_summary.quiet_hour > 12 ? `${crowdPrediction.today_summary.quiet_hour - 12}pm` : crowdPrediction.today_summary.quiet_hour === 0 ? '12am' : `${crowdPrediction.today_summary.quiet_hour}am`}
                    </span>
                    <span className={`text-[10px] capitalize ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>({crowdPrediction.today_summary.quiet_level})</span>
                  </div>
                )}
              </div>
            )}
            <p className={`text-[10px] mt-3 ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Based on {crowdPrediction.data_points || 0} historical data points</p>
          </div>
        )}

        {/* No intel data */}
        {!crowdPrediction && !optimalTime && (
          <div className="text-center py-8 text-gray-400">
            <Brain className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Intelligence data unavailable</p>
            <p className="text-xs">Check back when more data is available for this spot</p>
          </div>
        )}

        {/* Surf Log CTA */}
        <div
          className={`p-3.5 rounded-xl border cursor-pointer group transition-all ${
            isLight
              ? 'bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200 hover:border-cyan-400'
              : 'bg-gradient-to-r from-cyan-500/5 to-blue-500/5 border-cyan-500/20 hover:border-cyan-500/40'
          }`}
          onClick={() => navigate('/surf-log')}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isLight ? 'bg-cyan-100' : 'bg-cyan-500/15'}`}>
              <BookOpen className="w-4.5 h-4.5 text-cyan-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>Help improve this data</p>
              <p className={`text-[11px] leading-tight ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                Log your sessions at {spot?.name || 'this spot'} to make crowd & conditions intel more accurate
              </p>
            </div>
            <ArrowRight className={`w-4 h-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5 ${isLight ? 'text-cyan-500' : 'text-cyan-400'}`} />
          </div>
        </div>
      </>
    )}
  </div>
);

export default SpotHubIntelTab;
