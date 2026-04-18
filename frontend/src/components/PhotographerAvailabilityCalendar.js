/**
 * PhotographerAvailabilityCalendar - Visual calendar showing booking slots
 * Features:
 * - Monthly/Weekly view toggle
 * - Booked slots displayed on calendar
 * - Set availability windows
 * - Block specific dates
 * - Drag-and-drop rescheduling of bookings
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  Calendar, Clock, ChevronLeft, ChevronRight, X, Check, Users, MapPin, Loader2, Eye, EyeOff, AlertTriangle, GripVertical, Move
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


// Days of week
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Time slots for availability
const TIME_SLOTS = [
  '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
];

/**
 * Get days in a month
 */
const getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

/**
 * Get first day of month (0 = Sunday)
 */
const getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};

/**
 * Format date for display
 */
const _formatDate = (date) => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Day Cell Component with Drag-and-Drop support
 */
const DayCell = ({ 
  date, 
  isCurrentMonth, 
  isToday,
  bookings,
  blockedDates,
  availabilityWindows,
  onClick,
  isLight,
  // Drag-and-drop props
  isDragEnabled,
  onDragStart,
  onDragEnd,
  onDrop,
  draggedBooking,
  isDropTarget
}) => {
  const dayNum = date.getDate();
  const dateStr = date.toISOString().split('T')[0];
  const dayBookings = bookings.filter(b => b.date === dateStr);
  const isBlocked = blockedDates.includes(dateStr);
  const hasAvailability = availabilityWindows.some(w => w.day === date.getDay() && w.enabled);
  
  // Check if this cell is a valid drop target
  const isValidDropTarget = isDragEnabled && draggedBooking && !isBlocked && hasAvailability;
  const isActiveDropTarget = isValidDropTarget && isDropTarget;
  
  const bgClass = isLight 
    ? (isToday ? 'bg-yellow-100' : isCurrentMonth ? 'bg-white' : 'bg-gray-50')
    : (isToday ? 'bg-yellow-500/20' : isCurrentMonth ? 'bg-zinc-800' : 'bg-zinc-900');
  
  const textClass = isLight
    ? (isCurrentMonth ? 'text-gray-900' : 'text-gray-400')
    : (isCurrentMonth ? 'text-white' : 'text-gray-600');
  
  const handleDragOver = (e) => {
    if (isValidDropTarget) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    if (onDrop && isValidDropTarget) {
      onDrop(date);
    }
  };
  
  return (
    <div
      onClick={() => onClick(date)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`min-h-[80px] p-1 border ${isLight ? 'border-gray-200' : 'border-zinc-700'} ${bgClass} 
        hover:border-yellow-400 transition-all relative cursor-pointer
        ${isActiveDropTarget ? 'ring-2 ring-cyan-400 bg-cyan-500/10' : ''}
        ${isBlocked ? 'opacity-50' : ''}`}
    >
      <div className={`text-sm font-medium ${textClass} ${isToday ? 'text-yellow-500' : ''}`}>
        {dayNum}
      </div>
      
      {/* Blocked indicator */}
      {isBlocked && (
        <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center pointer-events-none">
          <X className="w-6 h-6 text-red-400" />
        </div>
      )}
      
      {/* Availability indicator */}
      {!isBlocked && hasAvailability && (
        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400" />
      )}
      
      {/* Drop zone indicator when dragging */}
      {isValidDropTarget && draggedBooking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Move className="w-4 h-4 text-cyan-400 opacity-50" />
        </div>
      )}
      
      {/* Bookings - now draggable */}
      <div className="mt-1 space-y-1">
        {dayBookings.slice(0, 2).map((booking, idx) => (
          <div 
            key={booking.id || idx}
            draggable={isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending')}
            onDragStart={(e) => {
              if (isDragEnabled) {
                e.stopPropagation();
                onDragStart(booking, e);
              }
            }}
            onDragEnd={(e) => {
              if (isDragEnabled) {
                e.stopPropagation();
                onDragEnd();
              }
            }}
            className={`text-xs px-1 py-0.5 rounded truncate flex items-center gap-1 ${
              booking.status === 'Confirmed' 
                ? 'bg-green-500/20 text-green-400'
                : booking.status === 'Pending'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-gray-500/20 text-gray-400'
            } ${isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending') ? 'cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-yellow-400' : ''}`}
            data-testid={`booking-block-${booking.id}`}
          >
            {isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending') && (
              <GripVertical className="w-3 h-3 flex-shrink-0 opacity-50" />
            )}
            <span className="truncate">{booking.time} - {booking.surfer_name?.split(' ')[0] || 'Booking'}</span>
          </div>
        ))}
        {dayBookings.length > 2 && (
          <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            +{dayBookings.length - 2} more
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Availability Window Editor
 */
const AvailabilityWindowEditor = ({ 
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
          <button
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

/**
 * Main Calendar Component
 */
export const PhotographerAvailabilityCalendar = ({ photographerId }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [bookings, setBookings] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [availabilityWindows, setAvailabilityWindows] = useState(
    FULL_DAYS.map((_, idx) => ({
      day: idx,
      enabled: idx !== 0, // Default: Mon-Sat enabled, Sunday off
      start: '06:00',
      end: '18:00'
    }))
  );
  const [loading, setLoading] = useState(true);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  
  // Drag-and-drop state
  const [isDragEnabled, setIsDragEnabled] = useState(false);
  const [draggedBooking, setDraggedBooking] = useState(null);
  const [dropTargetDate, setDropTargetDate] = useState(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleData, setRescheduleData] = useState(null);
  const [rescheduling, setRescheduling] = useState(false);
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgCard = isLight ? 'bg-white' : 'bg-zinc-900';
  
  const targetId = photographerId || user?.id;
  
  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  
  // Generate calendar days
  const calendarDays = useMemo(() => {
    const days = [];
    
    // Previous month padding
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);
    
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({
        date: new Date(prevYear, prevMonth, daysInPrevMonth - i),
        isCurrentMonth: false
      });
    }
    
    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === today.toDateString()
      });
    }
    
    // Next month padding
    const remaining = 42 - days.length; // 6 rows × 7 days
    for (let i = 1; i <= remaining; i++) {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      days.push({
        date: new Date(nextYear, nextMonth, i),
        isCurrentMonth: false
      });
    }
    
    return days;
  }, [year, month, daysInMonth, firstDay]);
  
  // Fetch bookings
  useEffect(() => {
    const fetchData = async () => {
      if (!targetId) return;
      
      setLoading(true);
      try {
        // Fetch photographer's bookings for current month
        const startDate = new Date(year, month, 1).toISOString();
        const endDate = new Date(year, month + 1, 0).toISOString();
        
        const res = await apiClient.get(
          `/photographer/${targetId}/bookings-calendar?start=${startDate}&end=${endDate}`
        );
        
        // Transform bookings for calendar display
        const transformed = (res.data.bookings || []).map(b => ({
          id: b.id,
          date: b.session_date?.split('T')[0],
          time: b.session_date ? new Date(b.session_date).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
          }) : '',
          status: b.status,
          surfer_name: b.surfer_name,
          location: b.location,
          duration: b.duration
        }));
        
        setBookings(transformed);
        setBlockedDates(res.data.blocked_dates || []);
        
        if (res.data.availability_windows) {
          setAvailabilityWindows(res.data.availability_windows);
        }
        
      } catch (error) {
        logger.error('Failed to fetch calendar data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [targetId, year, month]);
  
  // Navigation
  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };
  
  const goToToday = () => {
    setCurrentDate(new Date());
  };
  
  // Day click handler
  const handleDayClick = (date) => {
    setSelectedDate(date);
    setShowDayModal(true);
  };
  
  // Block/Unblock date
  const toggleBlockDate = async (dateStr) => {
    try {
      if (blockedDates.includes(dateStr)) {
        // Unblock
        setBlockedDates(prev => prev.filter(d => d !== dateStr));
        await apiClient.post(`/photographer/${targetId}/unblock-date`, { date: dateStr });
        toast.success('Date unblocked');
      } else {
        // Block
        setBlockedDates(prev => [...prev, dateStr]);
        await apiClient.post(`/photographer/${targetId}/block-date`, { date: dateStr });
        toast.success('Date blocked - surfers cannot book this day');
      }
    } catch (error) {
      toast.error('Failed to update date');
    }
  };
  
  // Save availability windows
  const saveAvailabilityWindows = async () => {
    try {
      await apiClient.put(`/photographer/${targetId}/availability-windows`, {
        windows: availabilityWindows
      });
      toast.success('Availability saved!');
      setShowAvailabilityModal(false);
    } catch (error) {
      toast.error('Failed to save availability');
    }
  };
  
  // Drag-and-drop handlers
  const handleDragStart = useCallback((booking, e) => {
    setDraggedBooking(booking);
    e.dataTransfer.setData('text/plain', booking.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);
  
  const handleDragEnd = useCallback(() => {
    setDraggedBooking(null);
    setDropTargetDate(null);
  }, []);
  
  const handleDrop = useCallback((targetDate) => {
    if (!draggedBooking) return;
    
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const originalDateStr = draggedBooking.date;
    
    // Don't allow drop on same day
    if (targetDateStr === originalDateStr) {
      setDraggedBooking(null);
      return;
    }
    
    // Check if target date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      toast.error('Cannot reschedule to a past date');
      setDraggedBooking(null);
      return;
    }
    
    // Show confirmation modal with time picker
    setRescheduleData({
      booking: draggedBooking,
      originalDate: originalDateStr,
      newDate: targetDateStr,
      newTime: draggedBooking.time // Default to same time
    });
    setShowRescheduleModal(true);
    setDraggedBooking(null);
  }, [draggedBooking]);
  
  // Reschedule booking
  const handleRescheduleConfirm = async () => {
    if (!rescheduleData) return;
    
    setRescheduling(true);
    try {
      // Parse the new time and date
      const [hours, minutes] = rescheduleData.newTime.split(':').map(Number);
      const newDateTime = new Date(rescheduleData.newDate);
      newDateTime.setHours(hours, minutes, 0, 0);
      
      await apiClient.patch(`/photographer/bookings/${rescheduleData.booking.id}`, {
        session_date: newDateTime.toISOString()
      });
      
      toast.success('Booking rescheduled successfully!');
      
      // Update local state
      setBookings(prev => prev.map(b => 
        b.id === rescheduleData.booking.id 
          ? {
              ...b,
              date: rescheduleData.newDate,
              time: new Date(newDateTime).toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit' 
              })
            }
          : b
      ));
      
      setShowRescheduleModal(false);
      setRescheduleData(null);
    } catch (error) {
      logger.error('Failed to reschedule:', error);
      toast.error(error.response?.data?.detail || 'Failed to reschedule booking');
    } finally {
      setRescheduling(false);
    }
  };
  
  // Get bookings for selected date
  const selectedDateBookings = selectedDate 
    ? bookings.filter(b => b.date === selectedDate.toISOString().split('T')[0])
    : [];
  
  const selectedDateStr = selectedDate?.toISOString().split('T')[0] || '';
  const isSelectedDateBlocked = blockedDates.includes(selectedDateStr);
  
  return (
    <div className={`${bgCard} rounded-xl p-4`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-yellow-400" />
          <h2 className={`text-lg font-bold ${textPrimary}`}>Availability Calendar</h2>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Drag Mode Toggle */}
          <Button
            variant={isDragEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIsDragEnabled(!isDragEnabled)}
            className={isDragEnabled 
              ? 'bg-cyan-500 text-black hover:bg-cyan-600' 
              : `${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
            data-testid="toggle-drag-mode"
          >
            <Move className="w-4 h-4 mr-1" />
            {isDragEnabled ? 'Dragging On' : 'Drag to Move'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAvailabilityModal(true)}
            className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
          >
            <Clock className="w-4 h-4 mr-1" />
            Set Hours
          </Button>
        </div>
      </div>
      
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={goToPrevMonth}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        
        <div className="flex items-center gap-3">
          <h3 className={`text-lg font-semibold ${textPrimary}`}>
            {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <Button variant="outline" size="sm" onClick={goToToday} className="text-xs">
            Today
          </Button>
        </div>
        
        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className={textSecondary}>Available</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500/20" />
          <span className={textSecondary}>Confirmed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-500/20" />
          <span className={textSecondary}>Pending</span>
        </div>
        <div className="flex items-center gap-1">
          <X className="w-3 h-3 text-red-400" />
          <span className={textSecondary}>Blocked</span>
        </div>
        {isDragEnabled && (
          <div className="flex items-center gap-1 ml-auto">
            <GripVertical className="w-3 h-3 text-cyan-400" />
            <span className="text-cyan-400">Drag bookings to reschedule</span>
          </div>
        )}
      </div>
      
      {/* Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-0">
          {/* Day headers */}
          {DAYS.map(day => (
            <div 
              key={day} 
              className={`p-2 text-center text-sm font-medium ${textSecondary} border-b ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}
            >
              {day}
            </div>
          ))}
          
          {/* Day cells */}
          {calendarDays.map((day, idx) => (
            <DayCell
              key={idx}
              date={day.date}
              isCurrentMonth={day.isCurrentMonth}
              isToday={day.isToday}
              bookings={bookings}
              blockedDates={blockedDates}
              availabilityWindows={availabilityWindows}
              onClick={handleDayClick}
              isLight={isLight}
              // Drag-and-drop props
              isDragEnabled={isDragEnabled}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              draggedBooking={draggedBooking}
              isDropTarget={dropTargetDate === day.date.toISOString().split('T')[0]}
            />
          ))}
        </div>
      )}
      
      {/* Day Detail Modal */}
      <Dialog open={showDayModal} onOpenChange={setShowDayModal}>
        <DialogContent className={`${bgCard} border-zinc-800 max-w-md`}>
          <DialogHeader>
            <DialogTitle className={textPrimary}>
              {selectedDate?.toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric' 
              })}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Block/Unblock Toggle */}
            <div className="flex items-center justify-between">
              <span className={textPrimary}>Block this date</span>
              <Button
                variant={isSelectedDateBlocked ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => toggleBlockDate(selectedDateStr)}
              >
                {isSelectedDateBlocked ? (
                  <>
                    <EyeOff className="w-4 h-4 mr-1" />
                    Blocked
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-1" />
                    Available
                  </>
                )}
              </Button>
            </div>
            
            {/* Bookings for this day */}
            <div>
              <Label className={textPrimary}>Bookings ({selectedDateBookings.length})</Label>
              
              {selectedDateBookings.length === 0 ? (
                <p className={`text-sm ${textSecondary} mt-2`}>
                  No bookings for this day
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {selectedDateBookings.map((booking, idx) => (
                    <div 
                      key={idx}
                      className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-400" />
                          <span className={textPrimary}>{booking.time}</span>
                        </div>
                        <Badge className={
                          booking.status === 'Confirmed' 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-yellow-500/20 text-yellow-400'
                        }>
                          {booking.status}
                        </Badge>
                      </div>
                      
                      <div className={`text-sm ${textSecondary} mt-1`}>
                        <Users className="w-3 h-3 inline mr-1" />
                        {booking.surfer_name || 'Surfer'}
                      </div>
                      
                      {booking.location && (
                        <div className={`text-sm ${textSecondary}`}>
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {booking.location}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDayModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Availability Windows Modal */}
      <Dialog open={showAvailabilityModal} onOpenChange={setShowAvailabilityModal}>
        <DialogContent className={`${bgCard} border-zinc-800 max-w-lg max-h-[80vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={textPrimary}>Set Weekly Availability</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <AvailabilityWindowEditor
              windows={availabilityWindows}
              onUpdate={setAvailabilityWindows}
              isLight={isLight}
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAvailabilityModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveAvailabilityWindows}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              Save Availability
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Reschedule Confirmation Modal */}
      <Dialog open={showRescheduleModal} onOpenChange={(open) => {
        if (!open) {
          setShowRescheduleModal(false);
          setRescheduleData(null);
        }
      }}>
        <DialogContent className={`${bgCard} border-zinc-800 max-w-md`}>
          <DialogHeader>
            <DialogTitle className={textPrimary}>
              <Move className="w-5 h-5 inline mr-2 text-cyan-400" />
              Reschedule Booking
            </DialogTitle>
          </DialogHeader>
          
          {rescheduleData && (
            <div className="space-y-4 py-4">
              {/* Booking Info */}
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-gray-400" />
                  <span className={textPrimary}>{rescheduleData.booking.surfer_name || 'Surfer'}</span>
                </div>
                <div className={`text-sm ${textSecondary}`}>
                  {rescheduleData.booking.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {rescheduleData.booking.location}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Date Change Info */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 text-center">
                  <p className={`text-xs ${textSecondary} mb-1`}>From</p>
                  <div className={`p-2 rounded ${isLight ? 'bg-red-50' : 'bg-red-500/10'}`}>
                    <p className="text-red-400 font-medium text-sm">
                      {new Date(rescheduleData.originalDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
                
                <ChevronRight className={`w-5 h-5 ${textSecondary}`} />
                
                <div className="flex-1 text-center">
                  <p className={`text-xs ${textSecondary} mb-1`}>To</p>
                  <div className={`p-2 rounded ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
                    <p className="text-green-400 font-medium text-sm">
                      {new Date(rescheduleData.newDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Time Picker */}
              <div>
                <Label className={textPrimary}>Session Time</Label>
                <select
                  value={rescheduleData.newTime?.split(':').slice(0, 2).join(':') || '09:00'}
                  onChange={(e) => setRescheduleData(prev => ({ ...prev, newTime: e.target.value }))}
                  className={`w-full mt-2 p-2 rounded border ${
                    isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700'
                  } ${textPrimary}`}
                  data-testid="reschedule-time-picker"
                >
                  {TIME_SLOTS.map(t => (
                    <option key={t} value={t}>
                      {new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Warning */}
              <div className={`flex items-start gap-2 p-3 rounded-lg ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'}`}>
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className={`text-xs ${textSecondary}`}>
                  The surfer will be notified about this schedule change. Please ensure you've communicated with them if necessary.
                </p>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowRescheduleModal(false);
                setRescheduleData(null);
              }}
              disabled={rescheduling}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleRescheduleConfirm}
              disabled={rescheduling}
              className="bg-cyan-500 hover:bg-cyan-600 text-black"
              data-testid="confirm-reschedule-btn"
            >
              {rescheduling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Rescheduling...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Confirm Reschedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PhotographerAvailabilityCalendar;
