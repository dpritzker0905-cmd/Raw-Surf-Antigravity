import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import {
  Calendar as CalendarIcon, Users, X, ChevronLeft, Plus,
  UserPlus, Globe, Mail
} from 'lucide-react';
import { Calendar } from '../ui/calendar';
import { toast } from 'sonner';
import { NumericStepper } from '../ui/numeric-stepper';

const CreateSessionModal = (props) => {
  // Destructure all needed props from parent
  const {
    showCreateModal, setShowCreateModal, showParticipantsModal, setShowParticipantsModal,
    showPricingModal, setShowPricingModal, showCrewModal, setShowCrewModal,
    showAvailabilityModal, setShowAvailabilityModal, showEditModal, setShowEditModal,
    bookings, setBookings, selectedBooking, setSelectedBooking,
    selectedBookingForEdit, setSelectedBookingForEdit,
    crewMembers, setCrewMembers, crewSearchQuery, setCrewSearchQuery,
    availability, setAvailability, bookingPricing, setBookingPricing,
    newBooking, setNewBooking, surfSpots, editFormData, setEditFormData,
    handleCreateBooking, handleAcceptBooking, handleDeclineBooking,
    handleCancelBooking, handleUpdateBooking, handleSaveAvailability,
    handleSavePricing, handleAddCrewMember, handleRemoveCrewMember,
    loading, user, theme, navigate, isLight, isBeach,
    textPrimaryClass, textSecondaryClass, borderClass, inputBgClass,
    cardBgClass, mainBgClass,
    // --- Props needed by this modal's JSX ---
    resetCreateForm, calendarStep, setCalendarStep,
    selectedDate, setSelectedDate, selectedTime, setSelectedTime,
    isDateDisabled, timeSlots, isSlotBooked, isTimeSlotWithinLeadTime,
    newCrewInput, setNewCrewInput, calculateCrewTotal, calculatePerPersonSplit
  } = props;

  // Safe fallback — prevent crash if bookingPricing hasn't loaded yet
  const safePricing = bookingPricing || {};

  return (
    <>
      {/* Create Session Modal - STEP-BASED CALENDAR UX */}
      <Dialog open={showCreateModal} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        setShowCreateModal(open);
      }}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} sm:max-w-lg`}>
          <DialogHeader className="shrink-0 border-b border-inherit px-4 sm:px-6 pt-4 pb-3">
            <div className="flex items-center gap-2">
              {calendarStep === 2 && (
                <button aria-label="Previous" 
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
                  description={`Total: $${(newBooking.duration_hours * (safePricing.booking_hourly_rate || 0)).toFixed(0)} (${safePricing.booking_hourly_rate || 0}/hr)`}
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
                      <Input aria-label="Email or username"
                        value={newCrewInput}
                        onChange={(e) => setNewCrewInput(e.target.value)}
                        placeholder="Email or username"
                        className={`flex-1 ${inputBgClass} ${textPrimaryClass}`}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCrewMember()}
                      />
                      <Button aria-label="Add"
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
    </>
  );
};

export default CreateSessionModal;
