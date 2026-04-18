/**
 * ExactTimeSlotPicker - Precision time slot selection for scheduled bookings
 * Allows users to pick exact date + time (e.g., Tuesday at 6:45 AM)
 */

import React, { useState, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight,
  Sunrise, Sun, Sunset, Check
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

// Session categories with time windows
const SESSION_CATEGORIES = [
  { 
    id: 'dawn_patrol', 
    label: 'Dawn Patrol', 
    icon: Sunrise, 
    timeRange: '5:00 AM - 7:30 AM',
    color: 'orange',
    description: 'Early morning golden hour'
  },
  { 
    id: 'morning', 
    label: 'Morning Session', 
    icon: Sun, 
    timeRange: '7:30 AM - 11:00 AM',
    color: 'yellow',
    description: 'Prime morning conditions'
  },
  { 
    id: 'midday', 
    label: 'Midday', 
    icon: Sun, 
    timeRange: '11:00 AM - 3:00 PM',
    color: 'blue',
    description: 'Full sun session'
  },
  { 
    id: 'sunset', 
    label: 'Sunset Session', 
    icon: Sunset, 
    timeRange: '3:00 PM - 7:00 PM',
    color: 'purple',
    description: 'Golden hour magic'
  },
  { 
    id: 'full_day', 
    label: 'Full Day Trip', 
    icon: CalendarIcon, 
    timeRange: 'Custom hours',
    color: 'green',
    description: 'Multi-hour expedition'
  },
];

// Duration options
const DURATION_OPTIONS = [
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: 'Full Day (8 hrs)' },
];

// Generate time slots in 15-minute increments
const generateTimeSlots = (startHour, endHour) => {
  const slots = [];
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const time24 = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const hour12 = hour % 12 || 12;
      const ampm = hour < 12 ? 'AM' : 'PM';
      const time12 = `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`;
      slots.push({ value: time24, label: time12 });
    }
  }
  return slots;
};

// Time slots by session category
const TIME_SLOTS_BY_CATEGORY = {
  dawn_patrol: generateTimeSlots(5, 8),
  morning: generateTimeSlots(7, 11),
  midday: generateTimeSlots(11, 15),
  sunset: generateTimeSlots(15, 19),
  full_day: generateTimeSlots(5, 19),
};

/**
 * Calendar Component for date selection
 */
const MiniCalendar = ({ selectedDate, onSelectDate, _minDate }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const days = useMemo(() => {
    const result = [];
    // Add empty cells for days before the first of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      result.push(null);
    }
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      result.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
    }
    return result;
  }, [currentMonth, daysInMonth, firstDayOfMonth]);
  
  const isDateDisabled = (date) => {
    if (!date) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };
  
  const isDateSelected = (date) => {
    if (!date || !selectedDate) return false;
    return date.toDateString() === selectedDate.toDateString();
  };
  
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  
  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
  
  return (
    <div className="space-y-1">
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={prevMonth} className="h-7 w-7 p-0">
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className={`font-medium text-sm ${textPrimary}`}>
          {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </span>
        <Button variant="ghost" size="sm" onClick={nextMonth} className="h-7 w-7 p-0">
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
      
      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <span key={i} className={`text-[10px] ${textSecondary} font-medium py-0.5`}>
            {day}
          </span>
        ))}
      </div>
      
      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((date, index) => (
          <button
            key={index}
            onClick={() => date && !isDateDisabled(date) && onSelectDate(date)}
            disabled={isDateDisabled(date)}
            className={cn(
              'h-7 w-7 rounded-full text-xs transition-colors',
              !date && 'invisible',
              date && isDateDisabled(date) && 'text-gray-600 cursor-not-allowed',
              date && !isDateDisabled(date) && !isDateSelected(date) && `${textPrimary} hover:bg-zinc-700`,
              date && isDateSelected(date) && 'bg-yellow-500 text-black font-bold'
            )}
          >
            {date?.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Main ExactTimeSlotPicker Component
 */
export const ExactTimeSlotPicker = ({ 
  selectedDate, 
  selectedTime, 
  selectedCategory,
  selectedDuration,
  onDateChange, 
  onTimeChange,
  onCategoryChange,
  onDurationChange,
  _photographerAvailability = []
}) => {
  const { theme } = useTheme();
  const [_step, setStep] = useState(1); // 1: Category, 2: Date, 3: Time, 4: Duration
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  
  // Get available time slots based on category
  const availableTimeSlots = useMemo(() => {
    if (!selectedCategory) return [];
    return TIME_SLOTS_BY_CATEGORY[selectedCategory] || [];
  }, [selectedCategory]);
  
  // Format selected date
  const formattedDate = selectedDate 
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;
  
  // Get category info
  const categoryInfo = SESSION_CATEGORIES.find(c => c.id === selectedCategory);
  
  return (
    <div className="space-y-3">
      {/* Step 1: Session Category */}
      <div>
        <label className={`text-xs font-medium ${textSecondary} mb-1.5 block`}>
          1. Select Session Type
        </label>
        <div className="grid grid-cols-1 gap-1.5 max-h-[140px] overflow-y-auto">
          {SESSION_CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.id;
            
            return (
              <button
                key={category.id}
                onClick={() => {
                  onCategoryChange(category.id);
                  setStep(2);
                }}
                className={cn(
                  'p-2 rounded-lg border transition-all text-left w-full',
                  isSelected 
                    ? 'border-yellow-500 bg-yellow-500/10' 
                    : 'border-zinc-700 hover:border-zinc-600'
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn(
                    'w-3.5 h-3.5 flex-shrink-0',
                    isSelected ? 'text-yellow-400' : 'text-gray-400'
                  )} />
                  <span className={cn(
                    'font-medium text-xs flex-1 truncate',
                    isSelected ? 'text-yellow-400' : textPrimary
                  )}>
                    {category.label}
                  </span>
                  <span className={`text-[10px] ${textSecondary} flex-shrink-0`}>{category.timeRange}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Step 2: Date Selection */}
      {selectedCategory && (
        <div>
          <label className={`text-xs font-medium ${textSecondary} mb-1.5 block`}>
            2. Select Date
          </label>
          <div className={`${cardBg} rounded-lg p-2`}>
            <MiniCalendar
              selectedDate={selectedDate}
              onSelectDate={(date) => {
                onDateChange(date);
                setStep(3);
              }}
            />
          </div>
        </div>
      )}
      
      {/* Step 3: Exact Time Selection */}
      {selectedDate && (
        <div>
          <label className={`text-xs font-medium ${textSecondary} mb-1.5 block flex items-center gap-1.5`}>
            <Clock className="w-3.5 h-3.5" />
            3. Start Time
            <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px] px-1.5 py-0">
              {formattedDate}
            </Badge>
          </label>
          <div className={`${cardBg} rounded-lg p-2`}>
            <div className="grid grid-cols-4 gap-1 max-h-28 overflow-y-auto">
              {availableTimeSlots.map((slot) => {
                const isSelected = selectedTime === slot.value;
                return (
                  <button
                    key={slot.value}
                    onClick={() => {
                      onTimeChange(slot.value);
                      setStep(4);
                    }}
                    className={cn(
                      'px-1 py-1.5 rounded text-[11px] font-medium transition-all',
                      isSelected 
                        ? 'bg-yellow-500 text-black' 
                        : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                    )}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      
      {/* Step 4: Duration Selection */}
      {selectedTime && (
        <div>
          <label className={`text-xs font-medium ${textSecondary} mb-1.5 block`}>
            4. Duration
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {DURATION_OPTIONS.map((duration) => {
              const isSelected = selectedDuration === duration.value;
              return (
                <Button
                  key={duration.value}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onDurationChange(duration.value)}
                  className={cn(
                    'text-[10px] h-8 px-2',
                    isSelected 
                      ? 'bg-yellow-500 text-black hover:bg-yellow-600' 
                      : 'border-zinc-700'
                  )}
                >
                  {duration.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Summary */}
      {selectedDate && selectedTime && selectedDuration && (
        <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-lg p-2">
          <h4 className={`font-medium text-xs ${textPrimary} mb-0.5`}>Summary</h4>
          <p className={`text-[10px] ${textSecondary}`}>
            <strong className={textPrimary}>{categoryInfo?.label}</strong> • {formattedDate} • <strong className="text-yellow-400">{availableTimeSlots.find(s => s.value === selectedTime)?.label}</strong> • {DURATION_OPTIONS.find(d => d.value === selectedDuration)?.label}
          </p>
        </div>
      )}
    </div>
  );
};

export default ExactTimeSlotPicker;
