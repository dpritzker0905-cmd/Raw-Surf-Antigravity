import React, { useState, useEffect, useMemo, useRef } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { Calendar as CalendarIcon, MapPin, Users, DollarSign, Clock, Check, X, CalendarCheck, CalendarX, History, Plus, Copy, Share2, UserPlus, Globe, Settings, Camera, ChevronLeft, Mail, Link2, Send, Sunrise, Sunset, Sun, Repeat, LayoutGrid, Unlock, Lock, Navigation } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Input } from './ui/input';

import { Label } from './ui/label';

import { Textarea } from './ui/textarea';

import { Switch } from './ui/switch';

import { NumericStepper } from './ui/numeric-stepper';

import { Calendar } from './ui/calendar';

import { toast } from 'sonner';

import { PhotographerAvailabilityCalendar } from './PhotographerAvailabilityCalendar';

import { PhotographerSessionManager } from './PhotographerSessionManager';

import logger from '../utils/logger';

const getFullUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url;
  return `\\`;
};



export const PhotographerBookingsManager = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const _navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('pending');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showCrewModal, setShowCrewModal] = useState(false);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [editBooking, setEditBooking] = useState(null);
  const [showSessionManager, setShowSessionManager] = useState(false);
  
  // Session highlight from URL parameter
  const highlightedSessionId = searchParams.get('session');
  const sessionRefs = useRef({});
  
  // Step-Based Calendar State
  const [calendarStep, setCalendarStep] = useState(1); // 1 = Select Date, 2 = Select Time
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [existingBookedSlots, setExistingBookedSlots] = useState([]);
  
  // Crew / Split State
  const [crewMembers, setCrewMembers] = useState([]);
  const [newCrewInput, setNewCrewInput] = useState('');
  const [generatedSplitLink, setGeneratedSplitLink] = useState('');
  
  // ============ AVAILABILITY STATE ============
  const [availability, setAvailability] = useState([]);
  const [newAvailability, setNewAvailability] = useState({
    dates: [], // Array of selected dates
    time_preset: 'custom', // morning, afternoon, evening, all_day, custom
    start_time: '07:00',
    end_time: '17:00',
    is_recurring: false,
    recurring_days: [] // 0=Sun, 1=Mon, etc.
  });
  
  const [bookingPricing, setBookingPricing] = useState({
    booking_hourly_rate: 75,
    booking_min_hours: 1,
    // Resolution-tiered pricing (parity with On-Demand/Live)
    booking_price_web: 3,
    booking_price_standard: 5,
    booking_price_high: 10,
    booking_photos_included: 3,
    booking_full_gallery: false,
    // Crew split pricing
    price_per_additional_surfer: 15,
    // Group discounts
    group_discount_2_plus: 0,
    group_discount_3_plus: 0,
    group_discount_5_plus: 0,
    // Service Area & Travel Fees (Photographer-controlled for scheduled bookings)
    service_radius_miles: 25,
    charges_travel_fees: false,
    travel_surcharges: [
      { min_miles: 0, max_miles: 10, surcharge: 0 },
      { min_miles: 10, max_miles: 25, surcharge: 25 },
      { min_miles: 25, max_miles: 50, surcharge: 50 }
    ],
    home_latitude: null,
    home_longitude: null,
    home_location_name: null,
    location_search: ''
  });
  const [newBooking, setNewBooking] = useState({
    location: '',
    session_date: '',
    duration_hours: 1, // Changed to hours for clarity
    max_participants: 5,
    price_per_person: 25,
    description: '',
    allow_splitting: true,
    split_mode: 'friends_only',
    // Crew fields
    crew_emails: [],
    base_session_price: 75
  });

  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-900';

  // ============ TIME SLOT GENERATION ============
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 5; hour <= 19; hour++) { // 5 AM to 7 PM
      for (let minute = 0; minute < 60; minute += 30) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const label = new Date(`2000-01-01T${time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        slots.push({ value: time, label });
      }
    }
    return slots;
  }, []);

  // ============ AVAILABILITY TIME PRESETS ============
  const timePresets = [
    { id: 'early_morning', label: 'Early Morning', icon: Sunrise, start: '05:00', end: '09:00', color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
    { id: 'morning', label: 'Morning', icon: Sun, start: '08:00', end: '12:00', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
    { id: 'afternoon', label: 'Afternoon', icon: Sun, start: '12:00', end: '17:00', color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
    { id: 'evening', label: 'Evening', icon: Sunset, start: '16:00', end: '19:00', color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
    { id: 'all_day', label: 'All Day', icon: Clock, start: '06:00', end: '18:00', color: 'text-green-400', bgColor: 'bg-green-500/10' },
    { id: 'custom', label: 'Custom', icon: Settings, start: '07:00', end: '17:00', color: 'text-gray-400', bgColor: 'bg-gray-500/10' }
  ];

  const weekDays = [
    { id: 0, short: 'S', full: 'Sunday' },
    { id: 1, short: 'M', full: 'Monday' },
    { id: 2, short: 'T', full: 'Tuesday' },
    { id: 3, short: 'W', full: 'Wednesday' },
    { id: 4, short: 'T', full: 'Thursday' },
    { id: 5, short: 'F', full: 'Friday' },
    { id: 6, short: 'S', full: 'Saturday' }
  ];

  // ============ WEEKLY TIME GRID (Google Calendar Style) ============
  const gridHours = useMemo(() => {
    const hours = [];
    for (let hour = 5; hour <= 19; hour++) {
      const label = hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;
      hours.push({ hour, label });
    }
    return hours;
  }, []);

  // State for the weekly grid selection
  const [weeklyGrid, setWeeklyGrid] = useState(() => {
    // Initialize empty grid: weeklyGrid[dayId][hour] = true/false
    const grid = {};
    weekDays.forEach(day => {
      grid[day.id] = {};
      gridHours.forEach(h => {
        grid[day.id][h.hour] = false;
      });
    });
    return grid;
  });

  const [isGridDragging, setIsGridDragging] = useState(false);
  const [gridDragMode, setGridDragMode] = useState(null); // 'select' or 'deselect'
  const [availabilityView, setAvailabilityView] = useState('presets'); // 'presets' or 'grid'

  // Handle grid cell click/drag
  const handleGridCellStart = (dayId, hour) => {
    const newValue = !weeklyGrid[dayId][hour];
    setGridDragMode(newValue ? 'select' : 'deselect');
    setIsGridDragging(true);
    setWeeklyGrid(prev => ({
      ...prev,
      [dayId]: { ...prev[dayId], [hour]: newValue }
    }));
  };

  const handleGridCellEnter = (dayId, hour) => {
    if (!isGridDragging) return;
    setWeeklyGrid(prev => ({
      ...prev,
      [dayId]: { ...prev[dayId], [hour]: gridDragMode === 'select' }
    }));
  };

  const handleGridDragEnd = () => {
    setIsGridDragging(false);
    setGridDragMode(null);
  };

  // Convert grid to availability data
  const convertGridToAvailability = () => {
    const slots = [];
    weekDays.forEach(day => {
      const selectedHours = gridHours
        .filter(h => weeklyGrid[day.id][h.hour])
        .map(h => h.hour);
      
      if (selectedHours.length === 0) return;
      
      // Find continuous ranges
      let rangeStart = selectedHours[0];
      let rangeEnd = selectedHours[0];
      
      for (let i = 1; i <= selectedHours.length; i++) {
        if (selectedHours[i] === rangeEnd + 1) {
          rangeEnd = selectedHours[i];
        } else {
          slots.push({
            day: day.id,
            start_time: `${rangeStart.toString().padStart(2, '0')}:00`,
            end_time: `${(rangeEnd + 1).toString().padStart(2, '0')}:00`
          });
          if (i < selectedHours.length) {
            rangeStart = selectedHours[i];
            rangeEnd = selectedHours[i];
          }
        }
      }
    });
    return slots;
  };

  // Save grid-based availability
  const handleSaveGridAvailability = async () => {
    const slots = convertGridToAvailability();
    if (slots.length === 0) {
      toast.error('Please select at least one time slot');
      return;
    }

    try {
      // Group slots by day and save as recurring
      const groupedByDay = {};
      slots.forEach(slot => {
        if (!groupedByDay[slot.day]) groupedByDay[slot.day] = [];
        groupedByDay[slot.day].push(slot);
      });

      // Create recurring availability for each day
      for (const [dayId, daySlots] of Object.entries(groupedByDay)) {
        for (const slot of daySlots) {
          await apiClient.post(`/photographer/${user?.id}/availability`, {
            is_recurring: true,
            recurring_days: [parseInt(dayId)],
            start_time: slot.start_time,
            end_time: slot.end_time,
            time_preset: 'grid'
          });
        }
      }
      
      toast.success(`Saved ${slots.length} availability block(s)!`);
      fetchAvailability();
      setShowAvailabilityModal(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save availability');
    }
  };

  // Check if a date is in the past or violates 24-hour lead time
  // Scheduled bookings require 24-hour minimum lead time
  const isDateDisabled = (date) => {
    const now = new Date();
    const minBookingDate = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // +24 hours
    minBookingDate.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return date < minBookingDate;
  };

  // Check if a time slot is within the 24-hour lead time window
  const isTimeSlotWithinLeadTime = (date, timeStr) => {
    if (!date || !timeStr) return false;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const slotDateTime = new Date(date);
    slotDateTime.setHours(hours, minutes, 0, 0);
    const now = new Date();
    const minBookingTime = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // +24 hours
    return slotDateTime < minBookingTime;
  };

  // Check if a time slot is already booked
  const isSlotBooked = (date, time) => {
    if (!date || !time) return false;
    const dateStr = date.toISOString().split('T')[0];
    return existingBookedSlots.some(slot => 
      slot.date === dateStr && slot.time === time
    );
  };

  // Get booked slots for selected date
  const fetchBookedSlots = async (date) => {
    if (!date || !user?.id) return;
    try {
      const dateStr = date.toISOString().split('T')[0];
      const response = await apiClient.get(`/photographer/${user.id}/booked-slots`, {
        params: { date: dateStr }
      });
      setExistingBookedSlots(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch booked slots:', error);
      setExistingBookedSlots([]);
    }
  };

  // Calculate total crew price
  const calculateCrewTotal = () => {
    const basePrice = newBooking.base_session_price || bookingPricing.booking_hourly_rate;
    const additionalSurfers = crewMembers.length;
    const perSurferPrice = bookingPricing.price_per_additional_surfer || 15;
    return basePrice + (perSurferPrice * additionalSurfers);
  };

  // Calculate per-person split amount
  const calculatePerPersonSplit = () => {
    const total = calculateCrewTotal();
    const participants = crewMembers.length + 1; // +1 for primary surfer
    return (total / participants).toFixed(2);
  };

  useEffect(() => {
    if (user?.id) {
      fetchBookings();
      fetchBookingPricing();
      fetchAvailability();
    }
  }, [user?.id]);

  // Fetch booked slots when date is selected
  useEffect(() => {
    if (selectedDate) {
      fetchBookedSlots(selectedDate);
    }
  }, [selectedDate]);

  // Auto-open session manager from URL parameter
  // Combined effect: Find booking, switch tab, and open session manager immediately
  useEffect(() => {
    if (!highlightedSessionId || bookings.length === 0) return;
    
    // Find the booking that matches the highlighted session ID
    const targetBooking = bookings.find(b => b.id === highlightedSessionId);
    
    if (!targetBooking) {
      logger.debug('[SessionNav] Booking not found for ID:', highlightedSessionId);
      return;
    }
    
    logger.debug('[SessionNav] Found booking:', targetBooking.id, targetBooking.status);
    
    // Switch to the correct tab based on booking status
    const statusToTab = {
      'Pending': 'pending',
      'Confirmed': 'confirmed',
      'Completed': 'completed',
      'Cancelled': 'cancelled'
    };
    const targetTab = statusToTab[targetBooking.status] || 'pending';
    setActiveTab(targetTab);
    
    // Immediately open the session manager (no delay needed for the modal)
    setSelectedBooking(targetBooking);
    setShowSessionManager(true);
    
    // Scroll to the booking card after a short delay (for visual reference when modal closes)
    setTimeout(() => {
      if (sessionRefs.current[highlightedSessionId]) {
        sessionRefs.current[highlightedSessionId].scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    }, 300);
  }, [highlightedSessionId, bookings]);

  // Sync selectedBooking with latest bookings data when bookings update
  useEffect(() => {
    if (bookings.length > 0) {
      setSelectedBooking(prev => {
        if (!prev) return null;
        const updatedBooking = bookings.find(b => b.id === prev.id);
        return updatedBooking || prev;
      });
    }
  }, [bookings]);

  // ============ AVAILABILITY FUNCTIONS ============
  const fetchAvailability = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user?.id}/availability`);
      setAvailability(response.data || []);
    } catch (error) {
      logger.error('Error fetching availability:', error);
      setAvailability([]);
    }
  };

  const handleSaveAvailability = async () => {
    if (newAvailability.dates.length === 0 && !newAvailability.is_recurring) {
      toast.error('Please select at least one date or enable recurring');
      return;
    }
    
    if (newAvailability.is_recurring && newAvailability.recurring_days.length === 0) {
      toast.error('Please select at least one recurring day');
      return;
    }

    try {
      await apiClient.post(`/photographer/${user?.id}/availability`, newAvailability);
      toast.success('Availability saved!');
      fetchAvailability();
      setShowAvailabilityModal(false);
      resetAvailabilityForm();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save availability');
    }
  };

  const handleDeleteAvailability = async (availabilityId) => {
    try {
      await apiClient.delete(`/photographer/${user?.id}/availability/${availabilityId}`);
      toast.success('Availability removed');
      fetchAvailability();
    } catch (error) {
      toast.error('Failed to delete availability');
    }
  };

  const resetAvailabilityForm = () => {
    setNewAvailability({
      dates: [],
      time_preset: 'custom',
      start_time: '07:00',
      end_time: '17:00',
      is_recurring: false,
      recurring_days: []
    });
  };

  const handleTimePresetSelect = (preset) => {
    setNewAvailability(prev => ({
      ...prev,
      time_preset: preset.id,
      start_time: preset.start,
      end_time: preset.end
    }));
  };

  const toggleRecurringDay = (dayId) => {
    setNewAvailability(prev => ({
      ...prev,
      recurring_days: prev.recurring_days.includes(dayId)
        ? prev.recurring_days.filter(d => d !== dayId)
        : [...prev.recurring_days, dayId]
    }));
  };

  const fetchBookingPricing = async () => {
    try {
      const res = await apiClient.get(`/photographer/${user?.id}/pricing`);
      setBookingPricing({
        booking_hourly_rate: res.data.booking_hourly_rate || 75,
        booking_min_hours: res.data.booking_min_hours || 1,
        // Resolution-tiered pricing
        booking_price_web: res.data.booking_price_web || 3,
        booking_price_standard: res.data.booking_price_standard || 5,
        booking_price_high: res.data.booking_price_high || 10,
        booking_photos_included: res.data.booking_photos_included || 3,
        booking_full_gallery: res.data.booking_full_gallery || false,
        price_per_additional_surfer: res.data.price_per_additional_surfer || 15,
        // Group discounts
        group_discount_2_plus: res.data.group_discount_2_plus || 0,
        group_discount_3_plus: res.data.group_discount_3_plus || 0,
        group_discount_5_plus: res.data.group_discount_5_plus || 0,
        // Service Area & Travel Fees
        service_radius_miles: res.data.service_radius_miles || 25,
        charges_travel_fees: res.data.charges_travel_fees || false,
        travel_surcharges: res.data.travel_surcharges || [
          { min_miles: 0, max_miles: 10, surcharge: 0 },
          { min_miles: 10, max_miles: 25, surcharge: 25 },
          { min_miles: 25, max_miles: 50, surcharge: 50 }
        ],
        home_latitude: res.data.home_latitude || null,
        home_longitude: res.data.home_longitude || null,
        home_location_name: res.data.home_location_name || null,
        location_search: ''
      });
      // Also update the newBooking default price based on fetched hourly rate
      setNewBooking(prev => ({
        ...prev,
        price_per_person: res.data.booking_hourly_rate || 75,
        base_session_price: res.data.booking_hourly_rate || 75
      }));
    } catch (e) {
      logger.error('Error fetching booking pricing:', e);
    }
  };

  const handleSaveBookingPricing = async () => {
    try {
      await apiClient.put(`/photographer/${user?.id}/pricing`, bookingPricing);
      toast.success('Booking rates updated!');
      setShowPricingModal(false);
      // Update new booking default price
      setNewBooking(prev => ({
        ...prev,
        price_per_person: bookingPricing.booking_hourly_rate,
        base_session_price: bookingPricing.booking_hourly_rate
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update pricing');
    }
  };

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/photographer/${user?.id}/bookings`);
      setBookings(response.data || []);
    } catch (error) {
      logger.error('Error fetching bookings:', error);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBooking = async () => {
    if (!newBooking.location || !selectedDate || !selectedTime) {
      toast.error('Please fill in location, date and time');
      return;
    }

    // Combine date and time into ISO string
    const dateStr = selectedDate.toISOString().split('T')[0];
    const sessionDateTime = `${dateStr}T${selectedTime}:00`;

    try {
      await apiClient.post(`/photographer/${user?.id}/bookings`, {
        ...newBooking,
        session_date: sessionDateTime,
        duration: newBooking.duration_hours * 60, // Convert hours to minutes for API
        crew_emails: crewMembers.map(c => c.email || c),
        total_split_amount: calculateCrewTotal(),
        split_participants_count: crewMembers.length + 1,
        per_person_split_amount: parseFloat(calculatePerPersonSplit())
      });
      toast.success('Session created successfully!');
      setShowCreateModal(false);
      resetCreateForm();
      fetchBookings();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create session');
    }
  };

  const resetCreateForm = () => {
    setNewBooking({
      location: '',
      session_date: '',
      duration_hours: 1,
      max_participants: 5,
      price_per_person: bookingPricing.booking_hourly_rate,
      description: '',
      allow_splitting: true,
      split_mode: 'friends_only',
      crew_emails: [],
      base_session_price: bookingPricing.booking_hourly_rate
    });
    setSelectedDate(null);
    setSelectedTime(null);
    setCalendarStep(1);
    setCrewMembers([]);
  };

  // Add crew member by email/username
  const handleAddCrewMember = () => {
    if (!newCrewInput.trim()) return;
    
    // Basic email validation
    const isEmail = newCrewInput.includes('@');
    const member = {
      id: Date.now(),
      value: newCrewInput.trim(),
      type: isEmail ? 'email' : 'username',
      status: 'pending'
    };
    
    setCrewMembers(prev => [...prev, member]);
    setNewCrewInput('');
    toast.success(`Added ${member.value} to crew`);
  };

  const handleRemoveCrewMember = (memberId) => {
    setCrewMembers(prev => prev.filter(m => m.id !== memberId));
  };

  // Generate split payment link
  const generateSplitLink = () => {
    const bookingId = selectedBooking?.id || 'preview';
    const amount = calculatePerPersonSplit();
    const link = `${window.location.origin}/join-session/${bookingId}?split=true&amount=${amount}`;
    setGeneratedSplitLink(link);
    return link;
  };

  const copySplitLink = () => {
    const link = generatedSplitLink || generateSplitLink();
    navigator.clipboard.writeText(link);
    toast.success('Split payment link copied!');
  };

  // Open crew modal for existing booking
  const _openCrewModal = (booking) => {
    setSelectedBooking(booking);
    setShowCrewModal(true);
    generateSplitLink();
  };

  const handleUpdateStatus = async (bookingId, status) => {
    try {
      await apiClient.patch(`/bookings/${bookingId}/status`, { status });
      toast.success(`Booking ${status.toLowerCase()}`);
      fetchBookings();
    } catch (error) {
      toast.error('Failed to update booking');
    }
  };

  // Open edit modal for a booking
  const openEditModal = (booking) => {
    setEditBooking({
      id: booking.id,
      location: booking.location || '',
      session_date: booking.session_date ? new Date(booking.session_date) : null,
      duration: booking.duration || 60,
      max_participants: booking.max_participants || 1,
      description: booking.description || '',
      price_per_person: booking.price_per_person || bookingPricing.booking_hourly_rate
    });
    setShowEditModal(true);
  };

  // Save edited booking
  const handleSaveEdit = async () => {
    if (!editBooking) return;
    
    try {
      await apiClient.patch(`/bookings/${editBooking.id}`, {
        location: editBooking.location,
        session_date: editBooking.session_date?.toISOString(),
        duration: editBooking.duration,
        max_participants: editBooking.max_participants,
        description: editBooking.description
      });
      
      toast.success('Booking updated!');
      setShowEditModal(false);
      setEditBooking(null);
      fetchBookings();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update booking');
    }
  };

  const copyInviteCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Invite code copied!');
  };

  const viewParticipants = (booking) => {
    setSelectedBooking(booking);
    setShowParticipantsModal(true);
  };

  const tabs = [
    { id: 'calendar', label: 'Calendar', icon: LayoutGrid, count: null },
    { id: 'pending', label: 'Pending', icon: Clock, count: bookings.filter(b => b.status === 'Pending').length },
    { id: 'confirmed', label: 'Confirmed', icon: CalendarCheck, count: bookings.filter(b => b.status === 'Confirmed').length },
    { id: 'completed', label: 'Completed', icon: History, count: bookings.filter(b => b.status === 'Completed').length },
    { id: 'cancelled', label: 'Cancelled', icon: CalendarX, count: bookings.filter(b => b.status === 'Cancelled').length },
  ];

  const filteredBookings = bookings.filter(b => {
    if (activeTab === 'pending') return b.status === 'Pending';
    if (activeTab === 'confirmed') return b.status === 'Confirmed';
    if (activeTab === 'completed') return b.status === 'Completed';
    if (activeTab === 'cancelled') return b.status === 'Cancelled';
    return true;
  });

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="photographer-bookings-page">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-2xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
            Bookings Manager
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAvailabilityModal(true)}
              className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
              data-testid="set-availability-btn"
            >
              <CalendarIcon className="w-4 h-4 mr-2" />
              Set Availability
            </Button>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-black font-medium"
              data-testid="create-session-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Session
            </Button>
          </div>
        </div>

        {/* Current Availability Display */}
        {availability.length > 0 && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-sm font-medium ${textSecondaryClass}`}>Your Availability</CardTitle>
                <Badge className="bg-green-500 text-white text-xs">{availability.length} slots</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {availability.slice(0, 5).map((slot, idx) => (
                  <div key={slot.id || idx} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
                    <span className={`text-xs ${textPrimaryClass}`}>
                      {slot.is_recurring 
                        ? `${slot.recurring_days?.map(d => weekDays[d]?.short).join(', ')}`
                        : new Date(slot.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      }
                    </span>
                    <span className="text-xs text-green-400">
                      {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                    </span>
                    <button 
                      onClick={() => handleDeleteAvailability(slot.id)}
                      className="text-red-400 hover:text-red-300 ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {availability.length > 5 && (
                  <span className={`text-xs ${textSecondaryClass} self-center`}>+{availability.length - 5} more</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Booking Pricing Card */}
        <Card className={`mb-6 ${cardBgClass}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className={`text-lg ${textPrimaryClass}`}>Booking Rates</CardTitle>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowPricingModal(true)}
                className={isLight ? 'border-gray-300' : 'border-zinc-700'}
                data-testid="edit-booking-pricing-btn"
              >
                <Settings className="w-4 h-4 mr-2" />
                Edit Rates
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                <p className={`text-xs ${textSecondaryClass} mb-1`}>Hourly Rate</p>
                <p className="text-xl font-bold text-yellow-400">${bookingPricing.booking_hourly_rate}/hr</p>
                <p className={`text-xs ${textSecondaryClass}`}>per person</p>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                <p className={`text-xs ${textSecondaryClass} mb-1`}>Photos Included</p>
                <p className={`text-xl font-bold ${bookingPricing.booking_full_gallery ? 'text-green-400' : textPrimaryClass}`}>
                  {bookingPricing.booking_full_gallery ? '∞ Full' : bookingPricing.booking_photos_included}
                </p>
                <p className={`text-xs ${textSecondaryClass}`}>{bookingPricing.booking_full_gallery ? 'gallery' : 'photos'}</p>
              </div>
            </div>
            
            {/* Resolution Pricing Tiers */}
            <div className={`p-3 rounded-lg ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/30'}`}>
              <p className={`text-xs font-medium ${textSecondaryClass} mb-2`}>Photo Resolution Pricing</p>
              <div className="flex items-center justify-between gap-2">
                <div className="text-center flex-1">
                  <p className="text-sm font-bold text-cyan-400">${bookingPricing.booking_price_web}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>Web</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-sm font-bold text-blue-400">${bookingPricing.booking_price_standard}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>Standard</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-sm font-bold text-purple-400">${bookingPricing.booking_price_high}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>High-Res</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className={`flex border-b ${borderClass} mb-6 overflow-x-auto`}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                  isActive ? textPrimaryClass : textSecondaryClass
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                    isActive ? 'bg-cyan-400 text-black' : isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-300'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-400 to-blue-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Calendar View */}
        {activeTab === 'calendar' && (
          <div className="mt-4">
            <PhotographerAvailabilityCalendar photographerId={user?.id} />
          </div>
        )}

        {/* Bookings List */}
        {activeTab !== 'calendar' && (
        <div className="space-y-4">
          {filteredBookings.length === 0 ? (
            <Card className={`${cardBgClass} transition-colors duration-300`}>
              <CardContent className="py-12 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                  <CalendarIcon className={`w-8 h-8 ${textSecondaryClass}`} />
                </div>
                <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No {activeTab} bookings</h3>
                <p className={`${textSecondaryClass}`}>
                  {activeTab === 'pending' ? 'New booking requests will appear here.' : `Your ${activeTab} sessions will appear here.`}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredBookings.map((booking) => (
              <div
                key={booking.id}
                ref={(el) => sessionRefs.current[booking.id] = el}
                className={`transition-all duration-500 ${
                  highlightedSessionId === booking.id 
                    ? 'ring-2 ring-pink-400 ring-offset-2 ring-offset-zinc-900 rounded-xl' 
                    : ''
                }`}
              >
              <Card className={`${cardBgClass} transition-colors duration-300`} data-testid={`booking-${booking.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className={`font-medium ${textPrimaryClass}`}>Surf Photo Session</h3>
                      <div className={`flex items-center gap-2 mt-1 text-sm ${textSecondaryClass}`}>
                        <MapPin className="w-4 h-4" />
                        <span>{booking.location}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {booking.allow_splitting && (
                        <Badge variant="outline" className="text-cyan-400 border-cyan-400/50">
                          <Share2 className="w-3 h-3 mr-1" />
                          {booking.split_mode === 'open_nearby' ? 'Open' : 'Friends'}
                        </Badge>
                      )}
                      <Badge variant={
                        booking.status === 'Confirmed' ? 'default' :
                        booking.status === 'Pending' ? 'outline' :
                        booking.status === 'Completed' ? 'secondary' : 'destructive'
                      }>
                        {booking.status}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className={`flex items-center gap-4 text-sm ${textSecondaryClass} mb-3`}>
                    <div className="flex items-center gap-1">
                      <CalendarIcon className="w-4 h-4" />
                      <span>{new Date(booking.session_date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      <span>{new Date(booking.session_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>{booking.duration} min</span>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-900/50'} mb-3`}>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4 text-cyan-400" />
                        <span className={`text-sm ${textSecondaryClass}`}>
                          {booking.current_participants}/{booking.max_participants} spots
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4 text-green-400" />
                        <span className={`text-sm ${textSecondaryClass}`}>
                          ${booking.price_per_person}/person
                        </span>
                      </div>
                    </div>
                    <span className={`font-bold text-green-400`}>
                      ${((booking.current_participants || 0) * booking.price_per_person).toFixed(2)}
                    </span>
                  </div>

                  {/* Invite Code Section */}
                  {booking.allow_splitting && booking.invite_code && booking.status === 'Confirmed' && (
                    <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} mb-3`}>
                      <div className="flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-cyan-400" />
                        <span className={`text-sm ${textSecondaryClass}`}>Invite Code:</span>
                        <span className={`font-mono font-bold ${textPrimaryClass}`}>{booking.invite_code}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyInviteCode(booking.invite_code)}
                        className="text-cyan-400 hover:text-cyan-300"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {/* Action Buttons for Pending */}
                  {booking.status === 'Pending' && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleUpdateStatus(booking.id, 'Confirmed')}
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                        size="sm"
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Confirm
                      </Button>
                      <Button
                        onClick={() => openEditModal(booking)}
                        variant="outline"
                        className={`border-zinc-600 ${textSecondaryClass}`}
                        size="sm"
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={() => handleUpdateStatus(booking.id, 'Cancelled')}
                        variant="outline"
                        className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                        size="sm"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {/* View participants for confirmed */}
                  {booking.status === 'Confirmed' && (
                    <div className="flex gap-2">
                      {/* Manage Session - Opens new PhotographerSessionManager */}
                      <Button
                        className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white"
                        size="sm"
                        onClick={() => {
                          setSelectedBooking(booking);
                          setShowSessionManager(true);
                        }}
                        data-testid={`manage-session-btn-${booking.id}`}
                      >
                        {booking.lineup_status === 'open' ? <Unlock className="w-4 h-4 mr-1" /> : <Lock className="w-4 h-4 mr-1" />}
                        Manage Session
                      </Button>
                      <Button
                        variant="outline"
                        className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                        size="sm"
                        onClick={() => viewParticipants(booking)}
                      >
                        <Users className="w-4 h-4 mr-1" />
                        ({booking.current_participants})
                      </Button>
                      <Button
                        variant="outline"
                        className={`border-zinc-600 ${textSecondaryClass}`}
                        size="sm"
                        onClick={() => openEditModal(booking)}
                        data-testid={`edit-booking-btn-${booking.id}`}
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            ))
          )}
        </div>
        )}
      </div>

      {/* Create Session Modal - STEP-BASED CALENDAR UX */}
      <Dialog open={showCreateModal} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        setShowCreateModal(open);
      }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} sm:max-w-lg`}>
          <DialogHeader className="shrink-0 border-b border-inherit px-4 sm:px-6 pt-4 pb-3">
            <div className="flex items-center gap-2">
              {calendarStep === 2 && (
                <button 
                  onClick={() => setCalendarStep(1)}
                  className={`p-1 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'}`}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <DialogTitle className={textPrimaryClass}>
                {calendarStep === 1 ? 'Select Date' : 'Select Time'}
              </DialogTitle>
            </div>
            {/* Step indicator */}
            <div className="flex items-center gap-2 mt-2">
              <div className={`h-1 flex-1 rounded ${calendarStep >= 1 ? 'bg-cyan-400' : isLight ? 'bg-gray-200' : 'bg-zinc-700'}`} />
              <div className={`h-1 flex-1 rounded ${calendarStep >= 2 ? 'bg-cyan-400' : isLight ? 'bg-gray-200' : 'bg-zinc-700'}`} />
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {/* STEP 1: Date Selection */}
            {calendarStep === 1 && (
              <div className="space-y-4">
                {/* Location Input */}
                <div>
                  <Label className={textSecondaryClass}>Location *</Label>
                  <Input
                    value={newBooking.location}
                    onChange={(e) => setNewBooking({ ...newBooking, location: e.target.value })}
                    placeholder="e.g., Pipeline, North Shore"
                    className={`${inputBgClass} ${textPrimaryClass}`}
                    data-testid="booking-location-input"
                  />
                </div>

                {/* Calendar - Full Width Grid */}
                <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      if (date) {
                        setCalendarStep(2);
                      }
                    }}
                    disabled={isDateDisabled}
                    className={`${isLight ? 'bg-white' : 'bg-zinc-900'} w-full`}
                    classNames={{
                      months: "w-full",
                      month: "w-full",
                      table: "w-full border-collapse",
                      head_row: "flex w-full",
                      head_cell: `flex-1 text-center ${textSecondaryClass} text-sm font-medium py-2`,
                      row: "flex w-full",
                      cell: "flex-1 text-center relative p-0 focus-within:relative",
                      day: `w-full h-12 text-base font-medium hover:bg-cyan-400/20 rounded-lg transition-colors ${textPrimaryClass}`,
                      day_selected: "bg-cyan-400 text-black hover:bg-cyan-500",
                      day_today: `ring-2 ring-cyan-400 ${textPrimaryClass}`,
                      day_disabled: `opacity-30 cursor-not-allowed ${textSecondaryClass}`,
                      day_outside: "opacity-50",
                    }}
                  />
                </div>

                {/* Duration Stepper */}
                <NumericStepper
                  label="Session Duration"
                  value={newBooking.duration_hours}
                  onChange={(val) => setNewBooking({ ...newBooking, duration_hours: val })}
                  min={0.5}
                  max={8}
                  step={0.5}
                  suffix="hours"
                  description={`Total: $${(newBooking.duration_hours * bookingPricing.booking_hourly_rate).toFixed(0)} (${bookingPricing.booking_hourly_rate}/hr)`}
                  theme={theme}
                />
              </div>
            )}

            {/* STEP 2: Time Slot Selection */}
            {calendarStep === 2 && (
              <div className="space-y-4">
                {/* Selected Date Display */}
                <div className={`p-3 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-cyan-400" />
                    <span className={textPrimaryClass}>
                      {selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                  <Badge className="bg-cyan-400 text-black">
                    {newBooking.duration_hours}hr session
                  </Badge>
                </div>

                {/* Time Slots Grid - Mobile-First Full Width */}
                <div>
                  <Label className={`${textSecondaryClass} mb-3 block`}>Select Start Time</Label>
                  <p className={`text-xs ${textSecondaryClass} mb-2`}>
                    24-hour minimum lead time required for scheduled bookings
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
                    {timeSlots.map((slot) => {
                      const booked = isSlotBooked(selectedDate, slot.value);
                      const withinLeadTime = isTimeSlotWithinLeadTime(selectedDate, slot.value);
                      const isDisabled = booked || withinLeadTime;
                      const isSelected = selectedTime === slot.value;
                      
                      return (
                        <button
                          key={slot.value}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => setSelectedTime(slot.value)}
                          className={`p-3 rounded-xl text-center transition-all ${
                            isDisabled 
                              ? `${isLight ? 'bg-gray-100 text-gray-400' : 'bg-zinc-800 text-zinc-600'} cursor-not-allowed ${booked ? 'line-through' : ''}`
                              : isSelected
                                ? 'bg-cyan-400 text-black font-semibold'
                                : `${isLight ? 'bg-gray-50 hover:bg-cyan-50' : 'bg-zinc-800 hover:bg-cyan-500/20'} ${textPrimaryClass}`
                          }`}
                          data-testid={`time-slot-${slot.value}`}
                        >
                          <span className="text-sm">{slot.label}</span>
                          {booked && <span className="block text-xs mt-0.5">Booked</span>}
                          {withinLeadTime && !booked && <span className="block text-xs mt-0.5 text-amber-400">24hr min</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Max Participants */}
                <NumericStepper
                  label="Max Participants"
                  value={newBooking.max_participants}
                  onChange={(val) => setNewBooking({ ...newBooking, max_participants: val })}
                  min={1}
                  max={20}
                  step={1}
                  suffix="surfers"
                  theme={theme}
                />

                {/* Splitting Options */}
                <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <Label className={textPrimaryClass}>Allow Crew Splitting</Label>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        Let surfers invite friends to split costs
                      </p>
                    </div>
                    <Switch
                      checked={newBooking.allow_splitting}
                      onCheckedChange={(checked) => setNewBooking({ ...newBooking, allow_splitting: checked })}
                    />
                  </div>
                  
                  {newBooking.allow_splitting && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewBooking({ ...newBooking, split_mode: 'friends_only' })}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          newBooking.split_mode === 'friends_only'
                            ? 'border-cyan-400 bg-cyan-400/10'
                            : `${borderClass} ${isLight ? 'bg-white' : 'bg-zinc-900'}`
                        }`}
                      >
                        <UserPlus className={`w-5 h-5 mx-auto mb-1 ${newBooking.split_mode === 'friends_only' ? 'text-cyan-400' : textSecondaryClass}`} />
                        <p className={`text-xs font-medium ${newBooking.split_mode === 'friends_only' ? 'text-cyan-400' : textPrimaryClass}`}>
                          Friends Only
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewBooking({ ...newBooking, split_mode: 'open_nearby' })}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          newBooking.split_mode === 'open_nearby'
                            ? 'border-cyan-400 bg-cyan-400/10'
                            : `${borderClass} ${isLight ? 'bg-white' : 'bg-zinc-900'}`
                        }`}
                      >
                        <Globe className={`w-5 h-5 mx-auto mb-1 ${newBooking.split_mode === 'open_nearby' ? 'text-cyan-400' : textSecondaryClass}`} />
                        <p className={`text-xs font-medium ${newBooking.split_mode === 'open_nearby' ? 'text-cyan-400' : textPrimaryClass}`}>
                          Open Nearby
                        </p>
                      </button>
                    </div>
                  )}
                </div>

                {/* Add Crew Members Section */}
                {newBooking.allow_splitting && newBooking.split_mode === 'friends_only' && (
                  <div className={`p-4 rounded-xl ${isLight ? 'bg-purple-50 border border-purple-200' : 'bg-purple-500/10 border border-purple-500/30'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-purple-400" />
                      <Label className={textPrimaryClass}>Add Crew Members</Label>
                    </div>
                    
                    <div className="flex gap-2 mb-3">
                      <Input
                        value={newCrewInput}
                        onChange={(e) => setNewCrewInput(e.target.value)}
                        placeholder="Email or username"
                        className={`flex-1 ${inputBgClass} ${textPrimaryClass}`}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCrewMember()}
                      />
                      <Button
                        type="button"
                        onClick={handleAddCrewMember}
                        size="sm"
                        className="bg-purple-500 hover:bg-purple-600 text-white"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Crew Members List */}
                    {crewMembers.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {crewMembers.map((member) => (
                          <div key={member.id} className={`flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-white' : 'bg-zinc-900'}`}>
                            <div className="flex items-center gap-2">
                              {member.type === 'email' ? (
                                <Mail className="w-4 h-4 text-purple-400" />
                              ) : (
                                <UserPlus className="w-4 h-4 text-cyan-400" />
                              )}
                              <span className={`text-sm ${textPrimaryClass}`}>{member.value}</span>
                              <Badge variant="outline" className="text-xs">
                                {member.status}
                              </Badge>
                            </div>
                            <button
                              onClick={() => handleRemoveCrewMember(member.id)}
                              className="text-red-400 hover:text-red-300"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Split Cost Preview */}
                    {crewMembers.length > 0 && (
                      <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className={textSecondaryClass}>Total Session Cost:</span>
                          <span className="font-bold text-green-400">${calculateCrewTotal()}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className={textSecondaryClass}>Split ({crewMembers.length + 1} people):</span>
                          <span className="font-bold text-green-400">${calculatePerPersonSplit()}/person</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                <div>
                  <Label className={textSecondaryClass}>Description (optional)</Label>
                  <Textarea
                    value={newBooking.description}
                    onChange={(e) => setNewBooking({ ...newBooking, description: e.target.value })}
                    placeholder="Describe the session..."
                    className={`${inputBgClass} ${textPrimaryClass}`}
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            {calendarStep === 1 ? (
              <Button
                onClick={() => {
                  if (!newBooking.location) {
                    toast.error('Please enter a location');
                    return;
                  }
                  if (!selectedDate) {
                    toast.error('Please select a date');
                    return;
                  }
                  setCalendarStep(2);
                }}
                className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
              >
                Next: Select Time
              </Button>
            ) : (
              <Button
                onClick={handleCreateBooking}
                disabled={!selectedTime}
                className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black disabled:opacity-50"
              >
                Create Session
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Participants Modal */}
      <Dialog open={showParticipantsModal} onOpenChange={setShowParticipantsModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Session Participants</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {selectedBooking?.participants?.length === 0 ? (
              <p className={`text-center ${textSecondaryClass}`}>No participants yet</p>
            ) : (
              selectedBooking?.participants?.map((p) => (
                <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} flex items-center justify-center overflow-hidden`}>
                      {p.avatar_url ? (
                        <img src={getFullUrl(p.avatar_url)} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className={textSecondaryClass}>{p.name?.[0] || '?'}</span>
                      )}
                    </div>
                    <div>
                      <p className={textPrimaryClass}>{p.name || 'Unknown'}</p>
                      <p className={`text-xs ${textSecondaryClass}`}>{p.status}</p>
                    </div>
                  </div>
                  <Badge variant={p.payment_status === 'Paid' ? 'default' : 'outline'}>
                    {p.payment_status}
                  </Badge>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowParticipantsModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Booking Pricing Modal - NUMERIC STEPPERS (no sliders) */}
      <Dialog open={showPricingModal} onOpenChange={setShowPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Booking Rates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Set your default booking rates. These apply to private sessions booked in advance.
            </p>
            
            {/* Session Pricing - NUMERIC STEPPERS */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-4`}>Session Pricing</h4>
              <div className="space-y-4">
                <NumericStepper
                  label="Hourly Rate"
                  value={bookingPricing.booking_hourly_rate}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_hourly_rate: val })}
                  min={10}
                  max={500}
                  step={5}
                  prefix="$"
                  suffix="/hr"
                  description="Your rate per hour for booked sessions"
                  theme={theme}
                />
                <NumericStepper
                  label="Minimum Hours"
                  value={bookingPricing.booking_min_hours}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_min_hours: val })}
                  min={0.5}
                  max={8}
                  step={0.5}
                  suffix="hr"
                  description="Minimum booking duration"
                  theme={theme}
                />
              </div>
            </div>
            
            {/* Resolution-Tiered Photo Pricing - NUMERIC STEPPERS */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/30'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <Camera className="w-4 h-4 text-cyan-400" />
                Photo Resolution Pricing
              </h4>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>
                Set different prices per resolution tier. Matches On-Demand & Live Session pricing.
              </p>
              <div className="space-y-3">
                <NumericStepper
                  label="Web-Res"
                  value={bookingPricing.booking_price_web}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_price_web: val })}
                  min={0}
                  max={50}
                  step={1}
                  prefix="$"
                  size="sm"
                  theme={theme}
                />
                <NumericStepper
                  label="Standard"
                  value={bookingPricing.booking_price_standard}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_price_standard: val })}
                  min={0}
                  max={100}
                  step={1}
                  prefix="$"
                  size="sm"
                  theme={theme}
                />
                <NumericStepper
                  label="High-Res"
                  value={bookingPricing.booking_price_high}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_price_high: val })}
                  min={0}
                  max={200}
                  step={1}
                  prefix="$"
                  size="sm"
                  theme={theme}
                />
              </div>
            </div>
            
            {/* Photos Included - NUMERIC STEPPER */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3`}>Photos Included in Buy-In</h4>
              
              {/* Full Gallery Toggle */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className={textPrimaryClass}>Full Gallery Access</p>
                  <p className={`text-xs ${textSecondaryClass}`}>All photos included - unlimited downloads</p>
                </div>
                <Switch
                  checked={bookingPricing.booking_full_gallery}
                  onCheckedChange={(checked) => setBookingPricing({ ...bookingPricing, booking_full_gallery: checked })}
                />
              </div>
              
              {!bookingPricing.booking_full_gallery && (
                <NumericStepper
                  value={bookingPricing.booking_photos_included}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, booking_photos_included: val })}
                  min={0}
                  max={999}
                  step={1}
                  description="Photos included free with booking. Additional charged per resolution tier."
                  theme={theme}
                />
              )}
            </div>

            {/* Crew Split Pricing */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-purple-50 border border-purple-200' : 'bg-purple-500/10 border border-purple-500/30'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <Users className="w-4 h-4 text-purple-400" />
                Crew Split Pricing
              </h4>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>
                Formula: Base Session Price + (Per Surfer × Additional Crew)
              </p>
              <NumericStepper
                label="Price Per Additional Surfer"
                value={bookingPricing.price_per_additional_surfer}
                onChange={(val) => setBookingPricing({ ...bookingPricing, price_per_additional_surfer: val })}
                min={0}
                max={100}
                step={5}
                prefix="$"
                description="Added to base price for each additional crew member"
                theme={theme}
              />
            </div>
            
            {/* Group Booking Discounts */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-blue-50 border border-blue-200' : 'bg-blue-500/10 border border-blue-500/30'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <Users className="w-4 h-4 text-blue-400" />
                Group Booking Discounts
              </h4>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>
                Offer percentage discounts for groups to encourage crew bookings
              </p>
              <div className="space-y-3">
                <NumericStepper
                  label="2+ Surfers Discount"
                  value={bookingPricing.group_discount_2_plus || 0}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, group_discount_2_plus: val })}
                  min={0}
                  max={50}
                  step={5}
                  suffix="% off"
                  description="Discount when 2 or more surfers book"
                  theme={theme}
                />
                <NumericStepper
                  label="3+ Surfers Discount"
                  value={bookingPricing.group_discount_3_plus || 0}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, group_discount_3_plus: val })}
                  min={0}
                  max={50}
                  step={5}
                  suffix="% off"
                  description="Discount when 3 or more surfers book"
                  theme={theme}
                />
                <NumericStepper
                  label="5+ Surfers Discount"
                  value={bookingPricing.group_discount_5_plus || 0}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, group_discount_5_plus: val })}
                  min={0}
                  max={50}
                  step={5}
                  suffix="% off"
                  description="Discount when 5 or more surfers book"
                  theme={theme}
                />
              </div>
            </div>
            
            {/* Service Area & Travel Fees */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-orange-50 border border-orange-200' : 'bg-orange-500/10 border border-orange-500/30'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <MapPin className="w-4 h-4 text-orange-400" />
                Service Area & Travel Fees
              </h4>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>
                Set how far you're willing to travel for scheduled bookings and any travel surcharges.
              </p>
              
              {/* Service Radius */}
              <div className="space-y-4">
                <NumericStepper
                  label="Service Radius"
                  value={bookingPricing.service_radius_miles || 25}
                  onChange={(val) => setBookingPricing({ ...bookingPricing, service_radius_miles: val })}
                  min={5}
                  max={100}
                  step={5}
                  suffix=" miles"
                  description="Maximum distance you'll travel for bookings"
                  theme={theme}
                />
                
                {/* Set Home Location - Enhanced with GPS and City search */}
                <div className={`p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800/50 border border-zinc-700'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className={`font-medium text-sm ${textPrimaryClass}`}>Home Location (Base)</p>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        {bookingPricing.home_latitude && bookingPricing.home_longitude 
                          ? `${bookingPricing.home_latitude.toFixed(4)}, ${bookingPricing.home_longitude.toFixed(4)}`
                          : 'Required for distance-based pricing'
                        }
                      </p>
                    </div>
                    {bookingPricing.home_latitude && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                        <Check className="w-3 h-3 mr-1" />
                        Set
                      </Badge>
                    )}
                  </div>
                  
                  {/* Location Name Display */}
                  {bookingPricing.home_location_name && (
                    <p className={`text-sm ${textPrimaryClass} mb-2 flex items-center gap-1`}>
                      <MapPin className="w-3 h-3 text-orange-400" />
                      {bookingPricing.home_location_name}
                    </p>
                  )}
                  
                  {/* Option 1: GPS Button */}
                  <div className="flex gap-2 mb-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (navigator.geolocation) {
                          navigator.geolocation.getCurrentPosition(
                            (position) => {
                              setBookingPricing({ 
                                ...bookingPricing, 
                                home_latitude: position.coords.latitude,
                                home_longitude: position.coords.longitude,
                                home_location_name: 'Current Location (GPS)'
                              });
                              toast.success('Location set via GPS!');
                            },
                            () => toast.error('Could not get GPS location')
                          );
                        }
                      }}
                      className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
                    >
                      <Navigation className="w-4 h-4 mr-1 text-green-400" />
                      Use GPS
                    </Button>
                    
                    {/* Clear location */}
                    {bookingPricing.home_latitude && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setBookingPricing({ 
                            ...bookingPricing, 
                            home_latitude: null,
                            home_longitude: null,
                            home_location_name: null
                          });
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  
                  {/* Option 2: City/Place Search */}
                  <div className="space-y-2">
                    <p className={`text-xs ${textSecondaryClass}`}>Or search by city/place:</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., San Diego, CA or Uluwatu, Bali"
                        value={bookingPricing.location_search || ''}
                        onChange={(e) => setBookingPricing({ ...bookingPricing, location_search: e.target.value })}
                        className={`flex-1 text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'} ${textPrimaryClass}`}
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          const query = bookingPricing.location_search;
                          if (!query) return;
                          
                          try {
                            // Use Nominatim (OpenStreetMap) for free geocoding
                            const response = await fetch(
                              `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
                              { headers: { 'User-Agent': 'RawSurfOS/1.0' } }
                            );
                            const results = await response.json();
                            
                            if (results.length > 0) {
                              const { lat, lon, display_name } = results[0];
                              setBookingPricing({
                                ...bookingPricing,
                                home_latitude: parseFloat(lat),
                                home_longitude: parseFloat(lon),
                                home_location_name: display_name.split(',').slice(0, 2).join(','),
                                location_search: ''
                              });
                              toast.success(`Location set: ${display_name.split(',').slice(0, 2).join(',')}`);
                            } else {
                              toast.error('Location not found. Try a different search.');
                            }
                          } catch (error) {
                            toast.error('Search failed. Please try again.');
                          }
                        }}
                        className="bg-orange-500 hover:bg-orange-600 text-black"
                      >
                        Search
                      </Button>
                    </div>
                  </div>
                  
                  {/* Warning if not set */}
                  {!bookingPricing.home_latitude && (
                    <div className={`mt-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border border-amber-500/30`}>
                      <p className={`text-xs ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
                        ⚠️ Set your location so surfers can see if you're in their area and calculate travel fees.
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Charge Travel Fees Toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className={`font-medium text-sm ${textPrimaryClass}`}>Charge Travel Fees</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Add surcharges based on distance</p>
                  </div>
                  <Switch
                    checked={bookingPricing.charges_travel_fees || false}
                    onCheckedChange={(checked) => setBookingPricing({ ...bookingPricing, charges_travel_fees: checked })}
                  />
                </div>
                
                {/* Travel Surcharge Tiers */}
                {bookingPricing.charges_travel_fees && (
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-sm font-medium ${textPrimaryClass} mb-3`}>Travel Fee Tiers</p>
                    <div className="space-y-2">
                      {(bookingPricing.travel_surcharges || []).map((tier, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className={`text-xs ${textSecondaryClass} w-24`}>
                            {tier.min_miles}-{tier.max_miles} mi:
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-yellow-400 text-sm">+$</span>
                            <Input
                              type="number"
                              value={tier.surcharge}
                              onChange={(e) => {
                                const newTiers = [...(bookingPricing.travel_surcharges || [])];
                                newTiers[idx] = { ...newTiers[idx], surcharge: parseFloat(e.target.value) || 0 };
                                setBookingPricing({ ...bookingPricing, travel_surcharges: newTiers });
                              }}
                              className={`w-20 h-8 text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'} ${textPrimaryClass}`}
                              min={0}
                              step={5}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const tiers = bookingPricing.travel_surcharges || [];
                        const lastMax = tiers.length > 0 ? tiers[tiers.length - 1].max_miles : 0;
                        setBookingPricing({
                          ...bookingPricing,
                          travel_surcharges: [
                            ...tiers,
                            { min_miles: lastMax, max_miles: lastMax + 25, surcharge: 0 }
                          ]
                        });
                      }}
                      className="mt-2 text-orange-400"
                    >
                      + Add Tier
                    </Button>
                  </div>
                )}
              </div>
            </div>
            
            <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'}`}>
              <p className={`text-sm ${textSecondaryClass}`}>
                <strong className="text-amber-400">Platform fee:</strong> 20% is deducted from bookings. You receive 80% of the total.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveBookingPricing}
              className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black"
            >
              Save Rates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crew Split Modal - For existing bookings */}
      <Dialog open={showCrewModal} onOpenChange={setShowCrewModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Users className="w-5 h-5 text-purple-400" />
              Invite Crew Members
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Booking Summary */}
            {selectedBooking && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={textSecondaryClass}>Session:</span>
                  <span className={textPrimaryClass}>{selectedBooking.location}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className={textSecondaryClass}>Date:</span>
                  <span className={textPrimaryClass}>
                    {new Date(selectedBooking.session_date).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={textSecondaryClass}>Total Price:</span>
                  <span className="font-bold text-green-400">${selectedBooking.total_price || selectedBooking.price_per_person}</span>
                </div>
              </div>
            )}

            {/* Split Link */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/30'}`}>
              <Label className={`${textPrimaryClass} flex items-center gap-2 mb-3`}>
                <Link2 className="w-4 h-4 text-cyan-400" />
                Share Split Payment Link
              </Label>
              <div className="flex gap-2">
                <Input
                  value={generatedSplitLink}
                  readOnly
                  className={`flex-1 text-sm ${inputBgClass} ${textPrimaryClass}`}
                />
                <Button
                  onClick={copySplitLink}
                  className="bg-cyan-400 hover:bg-cyan-500 text-black"
                  size="sm"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className={`text-xs ${textSecondaryClass} mt-2`}>
                Share this link with crew members to collect their split payment
              </p>
            </div>

            {/* Add by Email/Username */}
            <div>
              <Label className={`${textSecondaryClass} mb-2 block`}>Or invite directly</Label>
              <div className="flex gap-2">
                <Input
                  value={newCrewInput}
                  onChange={(e) => setNewCrewInput(e.target.value)}
                  placeholder="Email or username"
                  className={`flex-1 ${inputBgClass} ${textPrimaryClass}`}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCrewMember()}
                />
                <Button
                  onClick={handleAddCrewMember}
                  className="bg-purple-500 hover:bg-purple-600 text-white"
                  size="sm"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Pending Invites */}
            {crewMembers.length > 0 && (
              <div>
                <Label className={`${textSecondaryClass} mb-2 block`}>Pending Invites</Label>
                <div className="space-y-2">
                  {crewMembers.map((member) => (
                    <div key={member.id} className={`flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-purple-400" />
                        <span className={`text-sm ${textPrimaryClass}`}>{member.value}</span>
                      </div>
                      <Badge variant="outline" className="text-amber-400 border-amber-400/50">
                        Pending
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCrewModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Availability Modal */}
      <Dialog open={showAvailabilityModal} onOpenChange={(open) => {
        if (!open) resetAvailabilityForm();
        setShowAvailabilityModal(open);
      }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-h-[90vh] overflow-y-auto ${availabilityView === 'grid' ? 'max-w-4xl' : 'max-w-lg'}`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <CalendarIcon className="w-5 h-5 text-cyan-400" />
              Set Your Availability
            </DialogTitle>
          </DialogHeader>

          {/* View Toggle */}
          <div className="flex gap-2 mb-2">
            <Button
              variant={availabilityView === 'presets' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAvailabilityView('presets')}
              className={availabilityView === 'presets' ? 'bg-cyan-400 text-black' : ''}
            >
              Quick Presets
            </Button>
            <Button
              variant={availabilityView === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAvailabilityView('grid')}
              className={availabilityView === 'grid' ? 'bg-cyan-400 text-black' : ''}
            >
              Weekly Grid
            </Button>
          </div>

          <div className="space-y-6 py-4">
            {/* ============ WEEKLY TIME GRID VIEW ============ */}
            {availabilityView === 'grid' && (
              <div 
                className="select-none"
                onMouseUp={handleGridDragEnd}
                onMouseLeave={handleGridDragEnd}
              >
                <p className={`text-sm ${textSecondaryClass} mb-4`}>
                  Click and drag to mark your available hours. Green = Available.
                </p>
                
                {/* Grid Header - Days */}
                <div className="grid grid-cols-8 gap-1 mb-1">
                  <div className={`text-xs font-medium ${textSecondaryClass} text-center`}>Time</div>
                  {weekDays.map(day => (
                    <div key={day.id} className={`text-xs font-medium ${textPrimaryClass} text-center`}>
                      {day.short}
                    </div>
                  ))}
                </div>
                
                {/* Grid Body - Hours */}
                <div className="max-h-[400px] overflow-y-auto">
                  {gridHours.map(({ hour, label }) => (
                    <div key={hour} className="grid grid-cols-8 gap-1 mb-1">
                      <div className={`text-xs ${textSecondaryClass} text-right pr-2 py-2`}>
                        {label}
                      </div>
                      {weekDays.map(day => (
                        <button
                          key={`${day.id}-${hour}`}
                          type="button"
                          onMouseDown={() => handleGridCellStart(day.id, hour)}
                          onMouseEnter={() => handleGridCellEnter(day.id, hour)}
                          className={`h-8 rounded transition-colors ${
                            weeklyGrid[day.id][hour]
                              ? 'bg-green-500 hover:bg-green-600'
                              : isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'
                          }`}
                          data-testid={`grid-cell-${day.id}-${hour}`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                
                {/* Grid Legend */}
                <div className="flex items-center gap-4 mt-4 justify-center">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500" />
                    <span className={`text-xs ${textSecondaryClass}`}>Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`} />
                    <span className={`text-xs ${textSecondaryClass}`}>Unavailable</span>
                  </div>
                </div>
              </div>
            )}

            {/* ============ PRESETS VIEW ============ */}
            {availabilityView === 'presets' && (
              <>
                {/* Time Presets - Grid of common time ranges */}
                <div>
                  <Label className={`${textSecondaryClass} mb-3 block`}>When are you available?</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {timePresets.map((preset) => {
                      const Icon = preset.icon;
                      const isSelected = newAvailability.time_preset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleTimePresetSelect(preset)}
                          className={`p-3 rounded-xl border-2 transition-all text-center ${
                            isSelected
                              ? `border-cyan-400 ${preset.bgColor}`
                              : `${borderClass} ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`
                          }`}
                          data-testid={`time-preset-${preset.id}`}
                        >
                          <Icon className={`w-5 h-5 mx-auto mb-1 ${isSelected ? preset.color : textSecondaryClass}`} />
                          <p className={`text-xs font-medium ${isSelected ? preset.color : textPrimaryClass}`}>
                            {preset.label}
                          </p>
                          <p className={`text-xs ${textSecondaryClass}`}>
                            {preset.start.slice(0, 5)} - {preset.end.slice(0, 5)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

            {/* Custom Time Range */}
            {newAvailability.time_preset === 'custom' && (
              <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <Label className={`${textSecondaryClass} mb-3 block`}>Custom Time Range</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className={`text-xs ${textSecondaryClass}`}>Start Time</Label>
                    <Input
                      type="time"
                      value={newAvailability.start_time}
                      onChange={(e) => setNewAvailability(prev => ({ ...prev, start_time: e.target.value }))}
                      className={`${inputBgClass} ${textPrimaryClass}`}
                    />
                  </div>
                  <div>
                    <Label className={`text-xs ${textSecondaryClass}`}>End Time</Label>
                    <Input
                      type="time"
                      value={newAvailability.end_time}
                      onChange={(e) => setNewAvailability(prev => ({ ...prev, end_time: e.target.value }))}
                      className={`${inputBgClass} ${textPrimaryClass}`}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Recurring Toggle */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-purple-50 border border-purple-200' : 'bg-purple-500/10 border border-purple-500/30'}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-purple-400" />
                  <div>
                    <Label className={textPrimaryClass}>Recurring Weekly</Label>
                    <p className={`text-xs ${textSecondaryClass}`}>Repeat these hours every week</p>
                  </div>
                </div>
                <Switch
                  checked={newAvailability.is_recurring}
                  onCheckedChange={(checked) => setNewAvailability(prev => ({ ...prev, is_recurring: checked, dates: checked ? [] : prev.dates }))}
                />
              </div>

              {/* Recurring Days Selection */}
              {newAvailability.is_recurring && (
                <div>
                  <Label className={`text-xs ${textSecondaryClass} mb-2 block`}>Select Days</Label>
                  <div className="flex gap-2">
                    {weekDays.map((day) => {
                      const isSelected = newAvailability.recurring_days.includes(day.id);
                      return (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => toggleRecurringDay(day.id)}
                          className={`w-9 h-9 rounded-full text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-purple-500 text-white'
                              : `${isLight ? 'bg-gray-200' : 'bg-zinc-700'} ${textSecondaryClass}`
                          }`}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Date Selection (for non-recurring) */}
            {!newAvailability.is_recurring && (
              <div>
                <Label className={`${textSecondaryClass} mb-3 block`}>Select Specific Dates</Label>
                <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
                  <Calendar
                    mode="multiple"
                    selected={newAvailability.dates}
                    onSelect={(dates) => setNewAvailability(prev => ({ ...prev, dates: dates || [] }))}
                    disabled={isDateDisabled}
                    className={`${isLight ? 'bg-white' : 'bg-zinc-900'} w-full`}
                    classNames={{
                      months: "w-full",
                      month: "w-full",
                      table: "w-full border-collapse",
                      head_row: "flex w-full",
                      head_cell: `flex-1 text-center ${textSecondaryClass} text-sm font-medium py-2`,
                      row: "flex w-full",
                      cell: "flex-1 text-center relative p-0 focus-within:relative",
                      day: `w-full h-10 text-sm font-medium hover:bg-cyan-400/20 rounded-lg transition-colors ${textPrimaryClass}`,
                      day_selected: "bg-cyan-400 text-black hover:bg-cyan-500",
                      day_today: `ring-2 ring-cyan-400 ${textPrimaryClass}`,
                      day_disabled: `opacity-30 cursor-not-allowed ${textSecondaryClass}`,
                      day_outside: "opacity-50",
                    }}
                  />
                </div>
                {newAvailability.dates.length > 0 && (
                  <p className={`text-xs ${textSecondaryClass} mt-2`}>
                    {newAvailability.dates.length} date(s) selected
                  </p>
                )}
              </div>
            )}

            {/* Summary - Only for presets view */}
            <div className={`p-3 rounded-xl ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
              <div className="flex items-center gap-2 text-green-400">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {newAvailability.is_recurring 
                    ? `Available ${newAvailability.recurring_days.length} day(s)/week, ${newAvailability.start_time?.slice(0, 5)} - ${newAvailability.end_time?.slice(0, 5)}`
                    : `${newAvailability.dates.length} date(s), ${newAvailability.start_time?.slice(0, 5)} - ${newAvailability.end_time?.slice(0, 5)}`
                  }
                </span>
              </div>
            </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAvailabilityModal(false)}>
              Cancel
            </Button>
            {availabilityView === 'grid' ? (
              <Button
                onClick={handleSaveGridAvailability}
                className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
              >
                Save Weekly Schedule
              </Button>
            ) : (
              <Button
                onClick={handleSaveAvailability}
                className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
              >
                Save Availability
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Booking Modal */}
      <Dialog open={showEditModal} onOpenChange={(open) => {
        if (!open) setEditBooking(null);
        setShowEditModal(open);
      }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Edit Booking</DialogTitle>
          </DialogHeader>

          {editBooking && (
            <div className="space-y-4 py-4">
              {/* Location */}
              <div>
                <Label className={textSecondaryClass}>Location</Label>
                <Input
                  value={editBooking.location}
                  onChange={(e) => setEditBooking(prev => ({ ...prev, location: e.target.value }))}
                  className={`${inputBgClass} ${textPrimaryClass}`}
                  placeholder="e.g., Pipeline, North Shore"
                />
              </div>

              {/* Date & Time */}
              <div>
                <Label className={textSecondaryClass}>Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={editBooking.session_date ? new Date(editBooking.session_date.getTime() - editBooking.session_date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setEditBooking(prev => ({ ...prev, session_date: new Date(e.target.value) }))}
                  className={`${inputBgClass} ${textPrimaryClass}`}
                />
              </div>

              {/* Duration */}
              <div>
                <Label className={textSecondaryClass}>Duration (minutes)</Label>
                <select
                  value={editBooking.duration}
                  onChange={(e) => setEditBooking(prev => ({ ...prev, duration: parseInt(e.target.value) }))}
                  className={`w-full p-2 rounded-lg border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                >
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>Full Day (8 hours)</option>
                </select>
              </div>

              {/* Max Participants */}
              <div>
                <Label className={textSecondaryClass}>Max Participants</Label>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  value={editBooking.max_participants}
                  onChange={(e) => setEditBooking(prev => ({ ...prev, max_participants: parseInt(e.target.value) }))}
                  className={`${inputBgClass} ${textPrimaryClass}`}
                />
              </div>

              {/* Description */}
              <div>
                <Label className={textSecondaryClass}>Description / Notes</Label>
                <Textarea
                  value={editBooking.description}
                  onChange={(e) => setEditBooking(prev => ({ ...prev, description: e.target.value }))}
                  className={`${inputBgClass} ${textPrimaryClass}`}
                  placeholder="Any special instructions or notes..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Manager Drawer - Enhanced Photographer Control Panel */}
      <PhotographerSessionManager
        isOpen={showSessionManager}
        onClose={() => {
          setShowSessionManager(false);
          setSelectedBooking(null);
        }}
        booking={selectedBooking}
        user={user}
        theme={theme}
        onRefresh={fetchBookings}
        onBookingUpdate={(updates) => {
          // Immediately update selectedBooking with new values
          setSelectedBooking(prev => {
            if (!prev) return null;
            // Also update in bookings array using the prev.id to avoid stale closure
            setBookings(currentBookings => currentBookings.map(b => 
              b.id === prev.id ? { ...b, ...updates } : b
            ));
            return { ...prev, ...updates };
          });
        }}
      />
    </div>
  );
};
