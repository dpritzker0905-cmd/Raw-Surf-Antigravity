
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
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

import { DAYS, FULL_DAYS, TIME_SLOTS, getDaysInMonth, getFirstDayOfMonth } from './calendar/constants';
import { DayCell } from './calendar/DayCell';
import { AvailabilityWindowEditor } from './calendar/AvailabilityWindowEditor';


export var PhotographerAvailabilityCalendar = ({ photographerId }) => {
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
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  
  const calendarDays = useMemo(() => {
    const days = [];
    
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);
    
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({
        date: new Date(prevYear, prevMonth, daysInPrevMonth - i),
        isCurrentMonth: false
      });
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === today.toDateString()
      });
    }
    
    const remaining = 42 - days.length; // 6 rows ? 7 days
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
        const startDate = new Date(year, month, 1).toISOString();
        const endDate = new Date(year, month + 1, 0).toISOString();
        
        const res = await apiClient.get(
          `/photographer/${targetId}/bookings-calendar?start=${startDate}&end=${endDate}`
        );
        
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
  
  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };
  
  const goToToday = () => {
    setCurrentDate(new Date());
  };
  
  const handleDayClick = (date) => {
    setSelectedDate(date);
    setShowDayModal(true);
  };
  
  const toggleBlockDate = async (dateStr) => {
    try {
      if (blockedDates.includes(dateStr)) {
        setBlockedDates(prev => prev.filter(d => d !== dateStr));
        await apiClient.post(`/photographer/${targetId}/unblock-date`, { date: dateStr });
        toast.success('Date unblocked');
      } else {
        setBlockedDates(prev => [...prev, dateStr]);
        await apiClient.post(`/photographer/${targetId}/block-date`, { date: dateStr });
        toast.success('Date blocked - surfers cannot book this day');
      }
    } catch (error) {
      toast.error('Failed to update date');
    }
  };
  
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
  
  const handleDragStart = useCallback((booking, e) => {
    setDraggedBooking(booking); e.dataTransfer.setData('text/plain', booking.id); e.dataTransfer.effectAllowed = 'move';
  }, []);
  const handleDragEnd = useCallback(() => { setDraggedBooking(null); setDropTargetDate(null); }, []);
  
  const handleDrop = useCallback((targetDate) => {
    if (!draggedBooking) return;
    
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const originalDateStr = draggedBooking.date;
    
    if (targetDateStr === originalDateStr) {
      setDraggedBooking(null);
      return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) {
      toast.error('Cannot reschedule to a past date');
      setDraggedBooking(null);
      return;
    }
    
    setRescheduleData({
      booking: draggedBooking,
      originalDate: originalDateStr,
      newDate: targetDateStr,
      newTime: draggedBooking.time // Default to same time
    });
    setShowRescheduleModal(true);
    setDraggedBooking(null);
  }, [draggedBooking]);
  
  const handleRescheduleConfirm = async () => {
    if (!rescheduleData) return;
    
    setRescheduling(true);
    try {
      const [hours, minutes] = rescheduleData.newTime.split(':').map(Number);
      const newDateTime = new Date(rescheduleData.newDate);
      newDateTime.setHours(hours, minutes, 0, 0);
      
      await apiClient.patch(`/photographer/bookings/${rescheduleData.booking.id}`, {
        session_date: newDateTime.toISOString()
      });
      
      toast.success('Booking rescheduled successfully!');
      
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
  
  const selectedDateBookings = selectedDate 
    ? bookings.filter(b => b.date === selectedDate.toISOString().split('T')[0])
    : [];
  
  const selectedDateStr = selectedDate?.toISOString().split('T')[0] || '';
  const isSelectedDateBlocked = blockedDates.includes(selectedDateStr);
  
  return (
    <div className={`${bgCard} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-yellow-400" />
          <h2 className={`text-lg font-bold ${textPrimary}`}>Availability Calendar</h2>
        </div>
        
        <div className="flex items-center gap-2">
          <Button aria-label="Move"
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
          <Button aria-label="Clock"
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
      
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={goToPrevMonth} aria-label="Previous">
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
        
        <Button variant="ghost" size="sm" onClick={goToNextMonth} aria-label="Next">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs">
        {[['bg-green-400', 'Available'], ['bg-green-500/20', 'Confirmed'], ['bg-yellow-500/20', 'Pending']].map(([bg, label]) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 ${bg.includes('/') ? 'rounded' : 'rounded-full'} ${bg}`} />
            <span className={textSecondary}>{label}</span>
          </div>
        ))}
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
      
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-0">
          {DAYS.map(day => (
            <div 
              key={day} 
              className={`p-2 text-center text-sm font-medium ${textSecondary} border-b ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}
            >
              {day}
            </div>
          ))}
          
          {calendarDays.map((day, idx) => (
            <DayCell
              key={idx}
              date={day.date} isCurrentMonth={day.isCurrentMonth} isToday={day.isToday}
              bookings={bookings} blockedDates={blockedDates}
              availabilityWindows={availabilityWindows}
              onClick={handleDayClick} isLight={isLight}
              isDragEnabled={isDragEnabled} onDragStart={handleDragStart}
              onDragEnd={handleDragEnd} onDrop={handleDrop}
              draggedBooking={draggedBooking}
              isDropTarget={dropTargetDate === day.date.toISOString().split('T')[0]}
            />
          ))}
        </div>
      )}
      
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
            <div className="flex items-center justify-between">
              <span className={textPrimary}>Block this date</span>
              <Button aria-label="Hide"
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
            <Button aria-label="Loader2" 
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
