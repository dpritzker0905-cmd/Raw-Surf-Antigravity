/**
 * BookingsModals GÇö Extracted from Bookings.js (v82)
 * All modal/drawer overlays for the Bookings page in a single component.
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { PhotographerDirectory } from '../PhotographerDirectory';
import { ScheduledBookingDrawer } from '../ScheduledBookingDrawer';
import LineupManagerDrawer from '../LineupManagerDrawer';
import { OnDemandRequestDrawer } from '../OnDemandRequestDrawer';
import { CrewPaymentModal } from '../CrewPaymentModal';
import { JumpInSessionModal } from '../JumpInSessionModal';
import InviteModalContent from './InviteModalContent';

const BookingsModals = ({
  // Theme
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
  inputBgClass,
  // User
  user,
  // Join Code
  showJoinCodeModal,
  setShowJoinCodeModal,
  joinCode,
  setJoinCode,
  handleJoinByCode,
  // Invite
  showInviteModal,
  setShowInviteModal,
  selectedBooking,
  copyInviteCode,
  fetchData,
  // Jump In
  showJumpInDrawer,
  setShowJumpInDrawer,
  selectedPhotographer,
  setSelectedPhotographer,
  // On-Demand
  selectedOnDemandPro,
  showOnDemandDrawer,
  setShowOnDemandDrawer,
  setSelectedOnDemandPro,
  resumeDispatchId,
  setResumeDispatchId,
  handleOnDemandSuccess,
  userLocation,
  userCreditBalance,
  // Directory
  showPhotographerDirectory,
  setShowPhotographerDirectory,
  setSelectedScheduledPhotographer,
  // Scheduled Booking Drawer
  showScheduledBookingDrawer,
  setShowScheduledBookingDrawer,
  selectedScheduledPhotographer,
  // Crew View
  showCrewViewDrawer,
  setShowCrewViewDrawer,
  selectedCrewBooking,
  setSelectedCrewBooking,
  setBookings,
  // Crew Payment
  selectedCrewInvite,
  showCrewPaymentModal,
  setShowCrewPaymentModal,
  setSelectedCrewInvite,
  setActiveTab,
}) => {
  return (
    <>
      {/* Join by Code Modal */}
      <Dialog open={showJoinCodeModal} onOpenChange={setShowJoinCodeModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-card'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Join with Invite Code</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className={textSecondaryClass}>Invite Code</Label>
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter 6-character code"
              maxLength={6}
              className={`${inputBgClass} ${textPrimaryClass} uppercase tracking-widest text-center text-xl`}
            />
            <p className={`text-sm ${textSecondaryClass} mt-2`}>
              Enter the code shared by your friend to join their session.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJoinCodeModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleJoinByCode(joinCode)}
              className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black"
            >
              Join Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Friends Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-card'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Invite Friends</DialogTitle>
          </DialogHeader>
          <InviteModalContent
            booking={selectedBooking}
            user={user}
            isLight={isLight}
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            onCopyCode={copyInviteCode}
            onClose={() => setShowInviteModal(false)}
            onRefresh={fetchData}
          />
        </DialogContent>
      </Dialog>
      
      {/* Jump In Session Modal */}
      {showJumpInDrawer && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => {
            setShowJumpInDrawer(false);
            setSelectedPhotographer(null);
          }}
          onSuccess={() => {
            setShowJumpInDrawer(false);
            setSelectedPhotographer(null);
            toast.success('Successfully joined session!');
          }}
        />
      )}
      
      {/* On-Demand Request Drawer */}
      {selectedOnDemandPro && (
        <OnDemandRequestDrawer
          photographer={selectedOnDemandPro}
          isOpen={showOnDemandDrawer}
          onClose={() => {
            setShowOnDemandDrawer(false);
            setSelectedOnDemandPro(null);
            setResumeDispatchId(null);
          }}
          onSuccess={handleOnDemandSuccess}
          userLocation={userLocation}
          userCredits={userCreditBalance || user?.credit_balance || 0}
          resumeDispatchId={resumeDispatchId}
        />
      )}
      
      {/* Photographer Directory for Scheduled Bookings */}
      <PhotographerDirectory
        isOpen={showPhotographerDirectory}
        onClose={() => setShowPhotographerDirectory(false)}
        onSelectPhotographer={(photographer) => {
          setSelectedScheduledPhotographer(photographer);
          setShowPhotographerDirectory(false);
          setShowScheduledBookingDrawer(true);
        }}
      />
      
      {/* Scheduled Booking Drawer */}
      <ScheduledBookingDrawer
        isOpen={showScheduledBookingDrawer}
        onClose={() => {
          setShowScheduledBookingDrawer(false);
          setSelectedScheduledPhotographer(null);
        }}
        photographer={selectedScheduledPhotographer}
        onSuccess={(_booking) => {
          setShowScheduledBookingDrawer(false);
          setSelectedScheduledPhotographer(null);
          fetchData();
          toast.success('Session booked! Check your scheduled sessions.');
        }}
      />

      {/* The Crew View Drawer */}
      <LineupManagerDrawer
        isOpen={showCrewViewDrawer}
        onClose={() => {
          setShowCrewViewDrawer(false);
          setSelectedCrewBooking(null);
        }}
        lineup={selectedCrewBooking}
        user={user}
        onRefresh={fetchData}
        onLineupUpdate={(updatedFields) => {
          setSelectedCrewBooking(prev => prev ? { ...prev, ...updatedFields } : null);
          setBookings(prev => prev.map(b => 
            b.id === selectedCrewBooking?.id ? { ...b, ...updatedFields } : b
          ));
        }}
      />
      
      {/* Crew Payment Modal */}
      <CrewPaymentModal
        invite={selectedCrewInvite}
        isOpen={showCrewPaymentModal}
        onClose={() => {
          setShowCrewPaymentModal(false);
          setSelectedCrewInvite(null);
        }}
        onSuccess={() => {
          fetchData();
          setShowCrewPaymentModal(false);
          setSelectedCrewInvite(null);
          setActiveTab('on_demand');
          toast.success('Check your active session below!');
        }}
      />
    </>
  );
};

export default BookingsModals;
