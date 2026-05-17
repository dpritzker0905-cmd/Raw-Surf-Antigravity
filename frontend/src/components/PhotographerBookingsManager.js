import React, { useState, useEffect, useMemo, useRef } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';


import { Calendar as CalendarIcon, MapPin, Users, DollarSign, Clock, Check, X, CalendarCheck, CalendarX, History, Plus, Copy, Share2, UserPlus, Settings, Sunrise, Sunset, Sun, LayoutGrid, Unlock, Lock } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

import { Button } from './ui/button';

import { Badge } from './ui/badge';








import { toast } from 'sonner';
import useBookingManagerActions from '../hooks/useBookingManagerActions';

import { PhotographerAvailabilityCalendar } from './PhotographerAvailabilityCalendar';

import { PhotographerSessionManager } from './PhotographerSessionManager';

import EditBookingModal from './bookings/EditBookingModal';
import AvailabilityModal from './bookings/AvailabilityModal';
import CrewSplitModal from './bookings/CrewSplitModal';
import BookingPricingModal from './bookings/BookingPricingModal';
import ParticipantsModal from './bookings/ParticipantsModal';
import CreateSessionModal from './bookings/CreateSessionModal';



export var PhotographerBookingsManager = () => {
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
  // ============ HANDLERS EXTRACTED ============

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

  const {
    handleGridCellStart,
    handleGridCellEnter,
    handleGridDragEnd,
    handleSaveGridAvailability,
    fetchBookedSlots,
    calculateCrewTotal,
    calculatePerPersonSplit,

    fetchAvailability,
    handleSaveAvailability,
    handleDeleteAvailability,
    handleTimePresetSelect,
    toggleRecurringDay,
    fetchBookingPricing,
    handleSaveBookingPricing,
    fetchBookings,
    handleCreateBooking,
    handleAddCrewMember,
    handleRemoveCrewMember,
    handleUpdateStatus,
    openEditModal,
    handleSaveEdit,
    isDateDisabled,
    isSlotBooked,
    isTimeSlotWithinLeadTime,
    copySplitLink,
    resetAvailabilityForm,
    resetCreateForm,
    generateSplitLink,
  } = useBookingManagerActions({
    user, selectedBooking, bookings, crewMembers, editBooking,
    selectedDate, selectedTime, newBooking, newAvailability,
    weeklyGrid, availability, bookingPricing, newCrewInput, existingBookedSlots,
    gridDragMode, isGridDragging, generatedSplitLink, highlightedSessionId, sessionRefs,
    weekDays, gridHours,
    setActiveTab,
    setAvailability,
    setBookingPricing,
    setBookings,
    setCalendarStep,
    setCrewMembers,
    setEditBooking,
    setExistingBookedSlots,
    setGeneratedSplitLink,
    setGridDragMode,
    setIsGridDragging,
    setLoading,
    setNewAvailability,
    setNewBooking,
    setNewCrewInput,
    setSelectedBooking,
    setSelectedDate,
    setSelectedTime,
    setShowAvailabilityModal,
    setShowCreateModal,
    setShowCrewModal,
    setShowEditModal,
    setShowPricingModal,
    setShowSessionManager,
    setWeeklyGrid,
  });

  const filteredBookings = bookings.filter(b => {
    if (activeTab === 'pending') return b.status === 'Pending';
    if (activeTab === 'confirmed') return b.status === 'Confirmed';
    if (activeTab === 'completed') return b.status === 'Completed';
    if (activeTab === 'cancelled') return b.status === 'Cancelled';
    return true;
  });


  // Safety timeout: prevent infinite spinner if API is unreachable
  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => setLoading(false), 10000);
      return () => clearTimeout(timeout);
    }
  }, [loading]);
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
          <h1 className={`text-2xl font-bold ${textPrimaryClass} font-oswald`} >
            Bookings Manager
          </h1>
          <div className="flex items-center gap-2">
            <Button aria-label="Calendar Icon"
              variant="outline"
              onClick={() => setShowAvailabilityModal(true)}
              className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
              data-testid="set-availability-btn"
            >
              <CalendarIcon className="w-4 h-4 mr-2" />
              Set Availability
            </Button>
            <Button aria-label="Add"
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
              <Button aria-label="Settings" 
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
                  {bookingPricing.booking_full_gallery ? '8 Full' : bookingPricing.booking_photos_included}
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
              <button aria-label="Icon"
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
                      <Button aria-label="Copy"
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
                      <Button aria-label="Confirm"
                        onClick={() => handleUpdateStatus(booking.id, 'Confirmed')}
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                        size="sm"
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Confirm
                      </Button>
                      <Button aria-label="Settings"
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
                      <Button aria-label="Unlock"
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
                      <Button aria-label="Users"
                        variant="outline"
                        className={`${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                        size="sm"
                        onClick={() => viewParticipants(booking)}
                      >
                        <Users className="w-4 h-4 mr-1" />
                        ({booking.current_participants})
                      </Button>
                      <Button aria-label="Settings"
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

      {/* Extracted Modal Components */}
      <CreateSessionModal {...{ showCreateModal, setShowCreateModal, newBooking, setNewBooking, calendarStep, setCalendarStep, selectedDate, setSelectedDate, selectedTime, setSelectedTime, existingBookedSlots, timeSlots, handleCreateBooking, fetchBookedSlots, resetCreateForm, isDateDisabled, isSlotBooked, isTimeSlotWithinLeadTime, crewMembers, setCrewMembers, newCrewInput, setNewCrewInput, handleAddCrewMember, handleRemoveCrewMember, calculateCrewTotal, calculatePerPersonSplit, generatedSplitLink, generateSplitLink, copySplitLink, user, isLight, isBeach, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass }} />
      <ParticipantsModal {...{ showParticipantsModal, setShowParticipantsModal, selectedBooking, isLight, textPrimaryClass, textSecondaryClass, borderClass }} />
      <BookingPricingModal {...{ showPricingModal, setShowPricingModal, bookingPricing, setBookingPricing, handleSaveBookingPricing, user, isLight, isBeach, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass }} />
      <CrewSplitModal {...{ showCrewModal, setShowCrewModal, selectedBooking, crewMembers, setCrewMembers, newCrewInput, setNewCrewInput, handleAddCrewMember, handleRemoveCrewMember, calculateCrewTotal, calculatePerPersonSplit, generatedSplitLink, generateSplitLink, copySplitLink, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass }} />
      <AvailabilityModal {...{ showAvailabilityModal, setShowAvailabilityModal, availability, setAvailability, newAvailability, setNewAvailability, availabilityView, setAvailabilityView, weeklyGrid, setWeeklyGrid, handleSaveAvailability, handleDeleteAvailability, handleSaveGridAvailability, handleTimePresetSelect, toggleRecurringDay, handleGridCellStart, handleGridCellEnter, handleGridDragEnd, resetAvailabilityForm, isGridDragging, timePresets, weekDays, gridHours, isLight, isBeach, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass, cardBgClass }} />
      <EditBookingModal {...{ showEditModal, setShowEditModal, editBooking, setEditBooking, handleSaveEdit, isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass }} />

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
