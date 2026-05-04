/**
 * useBookingManagerActions.js � Extracted from PhotographerBookingsManager.js
 * Booking management handlers: accept, reject, reschedule, pricing.
 * ~498 lines, 22 handlers.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { useEffect } from 'react';

const useBookingManagerActions = ({
  user, selectedBooking, bookingTab,
  setActiveTab,
  setAvailability,
  setAvailabilityForm,
  setBookingPricing,
  setBookings,
  setCalendarStep,
  setCreateForm,
  setCrewMembers,
  setEditBooking,
  setExistingBookedSlots,
  setGeneratedSplitLink,
  setGridDragMode,
  setHours,
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
}) => {

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

  return {
    handleGridCellStart,
    handleGridCellEnter,
    handleGridDragEnd,
    handleSaveGridAvailability,
    fetchBookedSlots,
    calculateCrewTotal,
    calculatePerPersonSplit,
    updatedBooking,
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
  };
};

export default useBookingManagerActions;