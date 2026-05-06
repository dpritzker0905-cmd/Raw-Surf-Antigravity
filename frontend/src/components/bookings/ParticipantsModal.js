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

const ParticipantsModal = (props) => {
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
                        <img loading="lazy" decoding="async" src={getFullUrl(p.avatar_url)} alt={p.name} className="w-full h-full object-cover" />
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
    </>
  );
};

export default ParticipantsModal;
