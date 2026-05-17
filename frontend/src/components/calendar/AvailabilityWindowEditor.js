import React from 'react';
import { Check, X } from 'lucide-react';
import { Label } from '../ui/label';
import { FULL_DAYS, TIME_SLOTS } from './constants';

export var AvailabilityWindowEditor = ({ 
  windows, 
  onUpdate, 
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  const toggleDay = (dayIndex) => {
    const updated = [...windows];
    updated[dayIndex] = { 
      ...updated[dayIndex], 
      enabled: !updated[dayIndex].enabled 
    };
    onUpdate(updated);
  };
  
  const updateTime = (dayIndex, field, value) => {
    const updated = [...windows];
    updated[dayIndex] = { ...updated[dayIndex], [field]: value };
    onUpdate(updated);
  };
  
  return (
    <div className="space-y-3">
      <Label className={textPrimary}>Weekly Availability</Label>
      <p className={`text-xs ${textSecondary}`}>
        Set your regular shooting hours. Surfers can only book during these windows.
      </p>
      
      {FULL_DAYS.map((day, idx) => (
        <div 
          key={day}
          className={`flex items-center gap-3 p-2 rounded-lg ${
            windows[idx]?.enabled 
              ? (isLight ? 'bg-green-50' : 'bg-green-500/10')
              : (isLight ? 'bg-gray-100' : 'bg-zinc-800')
          }`}
        >
          <button aria-label="Confirm"
            onClick={() => toggleDay(idx)}
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              windows[idx]?.enabled 
                ? 'bg-green-500 text-white' 
                : 'bg-gray-300 text-gray-600'
            }`}
          >
            {windows[idx]?.enabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          
          <span className={`w-20 text-sm ${textPrimary}`}>{day}</span>
          
          {windows[idx]?.enabled && (
            <div className="flex items-center gap-2">
              <select
                value={windows[idx]?.start || '06:00'}
                onChange={(e) => updateTime(idx, 'start', e.target.value)}
                className={`text-sm p-1 rounded border ${isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700'} ${textPrimary}`}
              >
                {TIME_SLOTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className={textSecondary}>to</span>
              <select
                value={windows[idx]?.end || '18:00'}
                onChange={(e) => updateTime(idx, 'end', e.target.value)}
                className={`text-sm p-1 rounded border ${isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700'} ${textPrimary}`}
              >
                {TIME_SLOTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
