import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Users,
  Link2, Copy, Send, Mail
} from 'lucide-react';

var CrewSplitModal = (props) => {
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
    generatedSplitLink, copySplitLink, newCrewInput, setNewCrewInput
  } = props;
  return (
    <>
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
                <Input aria-label="Text input"
                  value={generatedSplitLink}
                  readOnly
                  className={`flex-1 text-sm ${inputBgClass} ${textPrimaryClass}`}
                />
                <Button aria-label="Copy"
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
                <Button aria-label="Send"
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
    </>
  );
};

export default CrewSplitModal;
