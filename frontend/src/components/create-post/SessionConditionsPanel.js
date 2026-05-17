/**
 * SessionConditionsPanel.js - Extracted from CreatePost.js (v61)
 * Collapsible session conditions form: wave height, period, direction, wind, tide.
 */
import React from 'react';
import { Waves, ChevronDown, Navigation, Loader2, Check, Wind, ArrowUpDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const SessionConditionsPanel = ({
  showSessionData, setShowSessionData,
  sessionDate, setSessionDate,
  sessionStartTime, setSessionStartTime,
  sessionEndTime, setSessionEndTime,
  waveHeightFt, setWaveHeightFt,
  wavePeriodSec, setWavePeriodSec,
  waveDirection, setWaveDirection,
  waveDirectionDegrees, setWaveDirectionDegrees,
  windSpeedMph, setWindSpeedMph,
  windDirection, setWindDirection,
  tideStatus, setTideStatus,
  tideHeightFt, setTideHeightFt,
  conditionsLoading, conditionsSource,
  fetchConditionsByLocation,
  cardBg, cardBorder, toggleInactive,
  bgInput, borderInput, textInput, labelClass,
  isLight,
}) => {
  const selectContentBg = isLight ? 'bg-white' : 'bg-zinc-800';

  return (
    <>
            {/* Session Conditions Toggle */}
            <button aria-label="Waves"
              aria-expanded={showSessionData} onClick={() => setShowSessionData(!showSessionData)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                showSessionData 
                  ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' 
                  : toggleInactive
              }`}
            >
              <div className="flex items-center gap-2">
                <Waves className="w-5 h-5" />
                <span className="font-medium">Add Session Conditions</span>
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform ${showSessionData ? 'rotate-180' : ''}`} />
            </button>

            {/* Session Data Fields */}
            {showSessionData && (
              <div className={`space-y-4 p-4 ${cardBg} rounded-lg border ${cardBorder}`}>
                {/* Auto-fetch Button */}
                <Button aria-label="Loader2"
                  onClick={fetchConditionsByLocation}
                  disabled={conditionsLoading}
                  variant="outline"
                  className="w-full border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                >
                  {conditionsLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Navigation className="w-4 h-4 mr-2" />
                  )}
                  Auto-fill from Current Location
                </Button>

                {/* Session Time */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={`text-xs ${labelClass} block mb-1`}>Date</label>
                    <Input
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`text-xs ${labelClass} block mb-1`}>Start</label>
                    <Input
                      type="time"
                      value={sessionStartTime}
                      onChange={(e) => setSessionStartTime(e.target.value)}
                      className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`text-xs ${labelClass} block mb-1`}>End</label>
                    <Input
                      type="time"
                      value={sessionEndTime}
                      onChange={(e) => setSessionEndTime(e.target.value)}
                      className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                    />
                  </div>
                </div>

                {/* Wave Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Waves className="w-4 h-4" />
                    <span className="text-sm font-medium">Wave Conditions</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Height (ft)</label>
                      <Input
                        type="number"
                        step="0.5"
                        value={waveHeightFt}
                        onChange={(e) => setWaveHeightFt(e.target.value)}
                        placeholder="3.5"
                        className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                      />
                    </div>
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Period (sec)</label>
                      <Input
                        type="number"
                        value={wavePeriodSec}
                        onChange={(e) => setWavePeriodSec(e.target.value)}
                        placeholder="12"
                        className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                      />
                    </div>
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Direction</label>
                      <Select value={waveDirection} onValueChange={setWaveDirection}>
                        <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm h-9`}>
                          <SelectValue placeholder="Dir" />
                        </SelectTrigger>
                        <SelectContent className={selectContentBg}>
                          {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(dir => (
                            <SelectItem key={dir} value={dir} className={textInput}>{dir}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Wind Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Wind className="w-4 h-4" />
                    <span className="text-sm font-medium">Wind</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Speed (mph)</label>
                      <Input
                        type="number"
                        value={windSpeedMph}
                        onChange={(e) => setWindSpeedMph(e.target.value)}
                        placeholder="8"
                        className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                      />
                    </div>
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Direction</label>
                      <Select value={windDirection} onValueChange={setWindDirection}>
                        <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm h-9`}>
                          <SelectValue placeholder="Direction" />
                        </SelectTrigger>
                        <SelectContent className={selectContentBg}>
                          {['Offshore', 'Onshore', 'Cross-shore', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(dir => (
                            <SelectItem key={dir} value={dir} className={textInput}>{dir}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Tide Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-blue-400">
                    <ArrowUpDown className="w-4 h-4" />
                    <span className="text-sm font-medium">Tide</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Status</label>
                      <Select value={tideStatus} onValueChange={setTideStatus}>
                        <SelectTrigger className={`${bgInput} ${borderInput} ${textInput} text-sm h-9`}>
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent className={selectContentBg}>
                          {['High', 'Low', 'Rising', 'Falling', 'Mid'].map(status => (
                            <SelectItem key={status} value={status} className={textInput}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className={`text-xs ${labelClass} block mb-1`}>Height (ft)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={tideHeightFt}
                        onChange={(e) => setTideHeightFt(e.target.value)}
                        placeholder="2.5"
                        className={`${bgInput} ${borderInput} ${textInput} text-sm`}
                      />
                    </div>
                  </div>
                </div>

                {conditionsSource === 'auto' && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <Check className="w-3 h-3" />
                    <span>Conditions auto-filled from weather data</span>
                  </div>
                )}
              </div>
            )}
    </>
  );
};

export default SessionConditionsPanel;
