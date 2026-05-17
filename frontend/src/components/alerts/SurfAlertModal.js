/**
 * SurfAlertModal.js - Extracted from SurfAlerts.js (v102)
 * Create / Edit Surf Alert dialog with spot search, wave height,
 * time-window, tide, and advanced-condition pickers.
 */
import React from 'react';
import {
  Bell, BellRing, MapPin, Waves, Loader2, X, Check,
  Search, Target, Clock,
  ChevronDown, ChevronUp, Droplets, Settings
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { TIME_WINDOWS, TIDE_STATES, SURF_CONDITIONS } from './surfAlertConstants';

var SurfAlertModal = ({
  open,
  onOpenChange,
  isEditMode,
  newAlert,
  setNewAlert,
  spotSearchQuery,
  setSpotSearchQuery,
  showSpotResults,
  setShowSpotResults,
  filteredSpots,
  selectSpot,
  userLocation,
  showAdvanced,
  setShowAdvanced,
  toggleTimeWindow,
  toggleTideState,
  toggleCondition,
  createLoading,
  handleSaveAlert,
  resetNewAlert,
}) => {
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetNewAlert(); }}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[95vw] sm:w-full max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0 sm:rounded-2xl gap-0">
        <DialogHeader className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/95 sticky top-0 z-10 shrink-0">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <BellRing className="w-5 h-5 text-yellow-400" />
            {isEditMode ? 'Edit Surf Alert' : 'Create Surf Alert'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto p-5 space-y-5 overscroll-contain">
          {/* Spot Selection with Search & GPS */}
          <div>
            <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              Surf Spot *
              {userLocation && (
                <Badge className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0 border-green-500/30">
                  <Target className="w-3 h-3 mr-1" />
                  GPS Active
                </Badge>
              )}
            </label>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input aria-label="Text input"
                type="text"
                placeholder={userLocation ? "Search or pick nearby spot..." : "Search for a spot..."}
                value={spotSearchQuery}
                onChange={(e) => {
                   setSpotSearchQuery(e.target.value);
                  setShowSpotResults(true);
                  if (!e.target.value) {
                    setNewAlert(prev => ({ ...prev, spot_id: '', spot_name: '' }));
                  }
                }}
                onFocus={() => setShowSpotResults(true)}
                className="pl-10 pr-10 bg-zinc-950 border-zinc-800 text-white focus:ring-yellow-500/50 rounded-xl rounded-b-xl"
                data-testid="spot-search-input"
              />
              {spotSearchQuery && (
                <button
                  onClick={() => {
                    setSpotSearchQuery('');
                    setNewAlert(prev => ({ ...prev, spot_id: '', spot_name: '' }));
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400 hover:text-white" />
                </button>
              )}
            </div>
            
            {/* Spot Results Dropdown */}
            {showSpotResults && (spotSearchQuery || userLocation) && (
              <div className="mt-2 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto shadow-2xl">
                {filteredSpots.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    {spotSearchQuery ? 'No spots found' : 'Start typing to search'}
                  </div>
                ) : (
                  filteredSpots.map((spot) => (
                    <button
                      key={spot.id}
                      onClick={() => selectSpot(spot)}
                      className={`w-full flex items-center gap-3 p-3 hover:bg-zinc-800 transition-colors text-left border-b border-zinc-800/50 last:border-0 ${
                        newAlert.spot_id === spot.id ? 'bg-yellow-500/10' : ''
                      }`}
                      data-testid={`spot-option-${spot.id}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${newAlert.spot_id === spot.id ? 'bg-yellow-500/20' : 'bg-zinc-800'}`}>
                        <MapPin className={`w-4 h-4 ${newAlert.spot_id === spot.id ? 'text-yellow-400' : 'text-gray-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate text-sm flex items-center gap-2 ${newAlert.spot_id === spot.id ? 'text-yellow-400' : 'text-white'}`}>
                          {spot.name}
                          {newAlert.spot_id === spot.id && <Check className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {spot.region || spot.city || spot.country || 'Unknown location'}
                        </p>
                      </div>
                      {spot.distance !== null && spot.distance !== undefined && (
                        <div className={`text-xs font-medium px-2 py-1 rounded-md flex-shrink-0 tracking-wide ${spot.distance < 5 ? 'bg-green-500/10 text-green-400' : 'bg-zinc-800 text-gray-400'}`}>
                          {spot.distance < 0.1 ? '<0.1' : spot.distance.toFixed(1)} mi
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Wave Height Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Min Wave Height</label>
              <Select value={newAlert.min_wave_height} onValueChange={(v) => setNewAlert(prev => ({ ...prev, min_wave_height: v }))}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-white rounded-xl">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 rounded-xl">
                  <SelectItem value="2" className="text-white">2ft+</SelectItem>
                  <SelectItem value="3" className="text-white">3ft+</SelectItem>
                  <SelectItem value="4" className="text-white">4ft+</SelectItem>
                  <SelectItem value="5" className="text-white">5ft+</SelectItem>
                  <SelectItem value="6" className="text-white">6ft+ (OH)</SelectItem>
                  <SelectItem value="8" className="text-white">8ft+ (DOH)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Max Wave Height</label>
              <Select value={newAlert.max_wave_height} onValueChange={(v) => setNewAlert(prev => ({ ...prev, max_wave_height: v }))}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-white rounded-xl">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 rounded-xl">
                  <SelectItem value="4" className="text-white">Up to 4ft</SelectItem>
                  <SelectItem value="6" className="text-white">Up to 6ft</SelectItem>
                  <SelectItem value="8" className="text-white">Up to 8ft</SelectItem>
                  <SelectItem value="10" className="text-white">Up to 10ft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Time Window Preference */}
          <div>
            <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-400" />
              Preferred Time Windows
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TIME_WINDOWS.map((window) => {
                const Icon = window.icon;
                const isSelected = newAlert.time_windows.includes(window.id);
                return (
                  <button
                    key={window.id}
                    onClick={() => toggleTimeWindow(window.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-purple-500/10 border-purple-500/40 shadow-[inset_0_0_12px_rgba(168,85,247,0.15)]'
                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
                    }`}
                    data-testid={`time-window-${window.id}`}
                  >
                    <div className={`p-1.5 rounded-md ${isSelected ? 'bg-purple-500/20' : 'bg-transparent'}`}>
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-purple-400' : 'text-gray-500'}`} />
                    </div>
                    <div className="text-left flex-1">
                      <p className={`text-sm font-medium ${isSelected ? 'text-purple-300' : 'text-gray-300'}`}>{window.label}</p>
                      <p className={`text-[10px] ${isSelected ? 'text-purple-400/70' : 'text-gray-500'}`}>{window.time}</p>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-purple-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 px-1">Leave empty for any time</p>
          </div>

          {/* Tide State Preference */}
          <div>
            <label className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <Droplets className="w-4 h-4 text-cyan-400" />
              Preferred Tide
            </label>
            <div className="flex flex-wrap gap-2">
              {TIDE_STATES.map((state) => {
                const Icon = state.icon;
                const isSelected = newAlert.tide_states.includes(state.id);
                return (
                  <button
                    key={state.id}
                    onClick={() => toggleTideState(state.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)] text-cyan-300'
                        : 'bg-zinc-950 border-zinc-800 text-gray-400 hover:border-zinc-700 hover:bg-zinc-900'
                    }`}
                    data-testid={`tide-state-${state.id}`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-gray-500'}`} />
                    <span className="text-sm font-medium">{state.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 ml-1 text-cyan-400" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 px-1">Leave empty for any tide</p>
          </div>

          {/* Advanced Options Toggle */}
          <div className="pt-2">
            <button aria-label="Settings"
              aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:bg-zinc-800 transition-colors"
            >
              <div className="flex items-center gap-2 font-medium text-sm text-gray-300">
                <Settings className="w-4 h-4 text-yellow-500/70" />
                Advanced Conditions
              </div>
              {showAdvanced ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-5 px-1 animate-in slide-in-from-top-1 fade-in duration-200 block">
              <div className="bg-zinc-950/50 rounded-2xl p-4 border border-zinc-800/50">
                <label className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                  <Waves className="w-4 h-4 text-blue-400" />
                  Specific Conditions
                </label>
                <p className="text-xs text-gray-400 mb-5">Select all specific traits you require. Leave blank if you don't care.</p>
                
                {/* Surface Conditions */}
                <div className="mb-4">
                  <p className="text-[11px] text-blue-400/80 font-semibold mb-2 uppercase tracking-wider">Surface</p>
                  <div className="flex flex-wrap gap-2">
                    {SURF_CONDITIONS.filter(c => c.category === 'surface').map((condition) => (
                      <button
                        key={condition.id}
                        type="button"
                        onClick={() => toggleCondition(condition.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                          newAlert.preferred_conditions.includes(condition.id)
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                            : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <span className="text-base leading-none">{condition.emoji}</span>
                        {condition.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Wind Conditions */}
                <div className="mb-4">
                  <p className="text-[11px] text-emerald-400/80 font-semibold mb-2 uppercase tracking-wider">Wind</p>
                  <div className="flex flex-wrap gap-2">
                    {SURF_CONDITIONS.filter(c => c.category === 'wind').map((condition) => (
                      <button
                        key={condition.id}
                        type="button"
                        onClick={() => toggleCondition(condition.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                          newAlert.preferred_conditions.includes(condition.id)
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                            : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <span className="text-base leading-none">{condition.emoji}</span>
                        {condition.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Wave Quality */}
                <div className="mb-4">
                  <p className="text-[11px] text-purple-400/80 font-semibold mb-2 uppercase tracking-wider">Wave Quality</p>
                  <div className="flex flex-wrap gap-2">
                    {SURF_CONDITIONS.filter(c => c.category === 'quality').map((condition) => (
                      <button
                        key={condition.id}
                        type="button"
                        onClick={() => toggleCondition(condition.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                          newAlert.preferred_conditions.includes(condition.id)
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                            : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <span className="text-base leading-none">{condition.emoji}</span>
                        {condition.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Crowd */}
                <div>
                  <p className="text-[11px] text-amber-400/80 font-semibold mb-2 uppercase tracking-wider">Other / Vibe</p>
                  <div className="flex flex-wrap gap-2">
                    {SURF_CONDITIONS.filter(c => c.category === 'crowd').map((condition) => (
                      <button
                        key={condition.id}
                        type="button"
                        onClick={() => toggleCondition(condition.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                          newAlert.preferred_conditions.includes(condition.id)
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                            : 'bg-zinc-900 border border-zinc-800/80 text-gray-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <span className="text-base leading-none">{condition.emoji}</span>
                        {condition.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Push Toggle & Actions */}
          <div className="pt-2 pb-6 space-y-4">
            <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors">
              <div className="flex items-center gap-3">
                <div className="bg-yellow-500/10 p-2 rounded-lg">
                  <Bell className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Push Notifications</p>
                  <p className="text-[11px] text-gray-400">Get instant alerts on your phone</p>
                </div>
              </div>
              <Switch
                checked={newAlert.notify_push}
                onCheckedChange={(checked) => setNewAlert(prev => ({ ...prev, notify_push: checked }))}
                className="data-[state=checked]:bg-yellow-500"
              />
            </div>

            <Button aria-label="Loader2"
              onClick={handleSaveAlert}
              disabled={createLoading || !newAlert.spot_id}
              className="w-full h-14 rounded-xl bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold shadow-lg shadow-yellow-500/20 text-base"
              data-testid={isEditMode ? "update-alert-submit" : "create-alert-submit"}
            >
              {createLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isEditMode ? 'Update Alert Configuration' : 'Create Surf Alert')}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SurfAlertModal;
