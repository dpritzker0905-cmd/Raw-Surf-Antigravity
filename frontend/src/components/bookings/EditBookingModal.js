import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';



const EditBookingModal = (props) => {
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
    editBooking, setEditBooking, handleSaveEdit
  } = props;
  return (
    <>
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
    </>
  );
};

export default EditBookingModal;
