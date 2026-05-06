import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import {
  Calendar, Clock, MapPin, Users, DollarSign, Camera, Loader2, Check, X,
  ChevronDown, ChevronRight, Plus, Settings, Image as ImageIcon, Video,
  Sparkles, Tag, Percent, AlertTriangle, Star, ArrowRight, RefreshCw
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { getFullUrl } from '../../utils/media';

const AvailabilityModal = (props) => {
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
    cardBgClass, mainBgClass
  } = props;
  return (
    <>
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
    </>
  );
};

export default AvailabilityModal;
