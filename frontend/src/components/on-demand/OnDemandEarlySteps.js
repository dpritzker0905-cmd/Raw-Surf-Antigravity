/**
 * OnDemandEarlySteps.js — Extracted step panels for the On-Demand booking flow.
 *
 * Contains: TimingStep, LocationStep, DurationStep, SplitChoiceStep
 * All steps receive the `booking` object from useOnDemandBooking hook.
 * Extracted from OnDemandRequestDrawer.js (v59) to reduce file from 1,230→~700 lines.
 */
import React from 'react';
import { MapPin, Camera, Zap, Clock, ChevronRight, Plus, Check, Bell, Search, Navigation, History } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { getFullUrl } from '../../utils/media';
import { Loader2 } from 'lucide-react';

// ============ STEP 0: START TIME SELECTION ============
export const TimingStep = ({ booking, photographer }) => {
  const { step, setStep, startTimeOption, setStartTimeOption, isLight, textPrimary, textSecondary, isPro } = booking;
  if (step !== 'timing') return null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium mb-3">
          <Zap className="w-3 h-3" />
          ON-DEMAND SESSION
        </div>
        <h2 className={`text-2xl font-bold ${textPrimary}`}>When do you want to surf?</h2>
        <p className={`text-sm ${textSecondary} mt-1`}>
          Choose when you'd like the photographer to arrive
        </p>
      </div>
      
      {/* Photographer Preview */}
      <div className={`flex items-center gap-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
        <div className={`w-12 h-12 rounded-full overflow-hidden ${isPro ? 'ring-2 ring-amber-400' : 'ring-2 ring-cyan-400/50'}`}>
          {photographer?.avatar_url ? (
            <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
              <Camera className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <span className={`font-semibold ${textPrimary}`}>{photographer?.full_name}</span>
          <p className={`text-xs ${textSecondary}`}>{photographer?.distance?.toFixed(1) || '?'} mi away</p>
        </div>
        <div className="text-right">
          <span className="text-xs text-green-400 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Available
          </span>
        </div>
      </div>
      
      {/* Timing Options */}
      <div className="space-y-3">
        {[
          { value: 30, label: '30 minutes', desc: 'Quick session - photographer arrives soon' },
          { value: 60, label: '1 hour', desc: 'Standard - time to prep and get there' },
          { value: 90, label: '90 minutes', desc: 'Relaxed - no rush for either party' }
        ].map((option) => {
          const startTime = new Date(Date.now() + option.value * 60000);
          const timeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          
          return (
            <button
              key={option.value}
              onClick={() => setStartTimeOption(option.value)}
              className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                startTimeOption === option.value
                  ? 'border-amber-400 bg-amber-500/10'
                  : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-amber-400/50`
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                startTimeOption === option.value 
                  ? 'bg-amber-500 text-black' 
                  : `${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`
              }`}>
                <Clock className="w-6 h-6" />
              </div>
              <div className="flex-1 text-left">
                <p className={`font-bold ${textPrimary}`}>{option.label}</p>
                <p className={`text-xs ${textSecondary}`}>{option.desc}</p>
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-bold">{timeStr}</p>
                <p className={`text-xs ${textSecondary}`}>arrival</p>
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Info note */}
      <div className={`flex items-start gap-3 p-3 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} border border-blue-400/30`}>
        <Bell className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className={`text-sm ${textSecondary}`}>
          The photographer will see this timeframe and can accept if they can make it. You'll be notified when they confirm.
        </p>
      </div>
    </div>
  );
};


// ============ STEP 1: DURATION SELECTION ============
export const DurationStep = ({ booking, photographer }) => {
  const {
    step, setStep, startTimeOption, selectedSpot, customLocationName,
    isLight, textPrimary, textSecondary, isPro,
    hourlyRate, photosIncluded, estimatedResponse,
    minDuration, maxDuration, requestDuration, setRequestDuration,
    formatDuration,
  } = booking;
  if (step !== 'duration') return null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setStep('location')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
          <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
        </button>
        <div>
          <h2 className={`text-xl font-bold ${textPrimary}`}>Session Duration</h2>
          <p className={`text-xs ${textSecondary}`}>
            Starting in {startTimeOption} min - {selectedSpot?.name || customLocationName || 'Current Location'} - {photographer?.full_name}
          </p>
        </div>
      </div>
      
      {/* Photographer Card */}
      <div className={`flex items-center gap-4 p-4 rounded-2xl ${isLight ? 'bg-gray-50' : 'bg-muted/50'}`}>
        <div className={`w-14 h-14 rounded-full overflow-hidden ${isPro ? 'ring-2 ring-amber-400' : 'ring-2 ring-cyan-400/50'}`}>
          {photographer?.avatar_url ? (
            <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
              <Camera className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${textPrimary}`}>{photographer?.full_name}</span>
            {isPro && <Badge className="bg-amber-500 text-black text-xs">PRO</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Online
            </span>
            <span className={`text-xs ${textSecondary}`}>~{estimatedResponse} min ETA</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-amber-400 font-bold text-lg">${hourlyRate}</p>
          <p className={`text-xs ${textSecondary}`}>/hour</p>
        </div>
      </div>
      
      {/* Duration Slider */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className={`text-sm font-medium ${textPrimary}`}>Session Duration</p>
          <div className="text-right">
            <span className="text-xl font-bold text-amber-400">{formatDuration(requestDuration)}</span>
            <p className={`text-xs ${textSecondary}`}>${(hourlyRate * requestDuration).toFixed(0)} base</p>
          </div>
        </div>
        
        <div className="px-2">
          <input aria-label="Range slider"
            type="range"
            min={minDuration}
            max={maxDuration}
            step={0.5}
            value={requestDuration}
            onChange={(e) => setRequestDuration(parseFloat(e.target.value))}
            className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            style={{
              background: `linear-gradient(to right, #F59E0B 0%, #F59E0B ${((requestDuration - minDuration) / (maxDuration - minDuration)) * 100}%, #3f3f46 ${((requestDuration - minDuration) / (maxDuration - minDuration)) * 100}%, #3f3f46 100%)`
            }}
          />
          <div className="flex justify-between mt-1">
            <span className={`text-xs ${textSecondary}`}>{formatDuration(minDuration)}</span>
            <span className={`text-xs ${textSecondary}`}>{formatDuration(maxDuration)}</span>
          </div>
        </div>
        
        {/* Quick Duration Buttons */}
        <div className="flex gap-2 flex-wrap">
          {[0.5, 1, 2, 3].filter(d => d >= minDuration && d <= maxDuration).map((d) => (
            <button
              key={d}
              onClick={() => setRequestDuration(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                requestDuration === d
                  ? 'bg-amber-500 text-black'
                  : `${isLight ? 'bg-gray-100 text-gray-600' : 'bg-muted text-muted-foreground'} hover:bg-amber-500/20 hover:text-amber-400`
              }`}
            >
              {formatDuration(d)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Photos Included */}
      <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} border border-cyan-400/30`}>
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <span className={`text-sm ${textPrimary}`}>Photos included</span>
        </div>
        <span className="text-cyan-400 font-bold">{photosIncluded} photos</span>
      </div>
    </div>
  );
};


// ============ STEP 1.5: SPLIT CHOICE ============
export const SplitChoiceStep = ({ booking, photographer }) => {
  const {
    step, setStep, isLight, textPrimary, textSecondary,
    splitEnabled, setSplitEnabled, crewMembers, setCrewMembers,
    totalPrice, perPersonSplit, formatDuration, requestDuration,
  } = booking;
  if (step !== 'split_choice') return null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setStep('duration')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
          <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
        </button>
        <div>
          <h2 className={`text-xl font-bold ${textPrimary}`}>Just you, or bringing crew?</h2>
          <p className={`text-xs ${textSecondary}`}>{formatDuration(requestDuration)} session - {photographer?.full_name}</p>
        </div>
      </div>

      {/* Two big choice cards */}
      <div className="space-y-3">
        {/* Solo */}
        <button
          onClick={() => { setSplitEnabled(false); setCrewMembers([]); }}
          className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all text-left ${
            !splitEnabled
              ? 'border-amber-400 bg-amber-500/10'
              : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-amber-400/50`
          }`}
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${
            !splitEnabled ? 'bg-amber-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
          }`}>{String.fromCodePoint(0x1F4F8)}</div>
          <div className="flex-1">
            <p className={`font-bold text-base ${textPrimary}`}>Just Me</p>
            <p className={`text-sm ${textSecondary}`}>Solo session - I'll pay the full rate</p>
            <p className="text-amber-400 font-bold mt-1">${totalPrice.toFixed(2)}</p>
          </div>
          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            !splitEnabled ? 'border-amber-400 bg-amber-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
          }`}>
            {!splitEnabled && <Check className="w-4 h-4 text-black" />}
          </div>
        </button>

        {/* Split with Crew */}
        <button
          onClick={() => setSplitEnabled(true)}
          className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all text-left ${
            splitEnabled
              ? 'border-cyan-400 bg-cyan-500/10'
              : `${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-muted/30'} hover:border-cyan-400/50`
          }`}
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${
            splitEnabled ? 'bg-cyan-500' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
          }`}>{String.fromCodePoint(0x1F4F8)}</div>
          <div className="flex-1">
            <p className={`font-bold text-base ${textPrimary}`}>Split with Crew</p>
            <p className={`text-sm ${textSecondary}`}>Share the session cost with friends</p>
            <p className="text-cyan-400 font-bold mt-1">
              {crewMembers.length > 0 ? `$${perPersonSplit}/person` : 'Add crew \u2192 split the cost'}
            </p>
          </div>
          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            splitEnabled ? 'border-cyan-400 bg-cyan-400' : isLight ? 'border-gray-300' : 'border-zinc-600'
          }`}>
            {splitEnabled && <Check className="w-4 h-4 text-black" />}
          </div>
        </button>
      </div>

      {/* Tip */}
      <div className={`flex items-start gap-3 p-3 rounded-xl ${
        isLight ? 'bg-blue-50' : 'bg-blue-500/10'
      } border border-blue-400/30`}>
        <Bell className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className={`text-xs ${textSecondary}`}>
          {splitEnabled
            ? "You'll add crew in the next step. You can cover any percentage of a friend's share."
            : 'You can switch to crew split anytime by going back.'}
        </p>
      </div>
    </div>
  );
};
