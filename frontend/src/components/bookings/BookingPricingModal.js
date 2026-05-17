import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { MapPin, Users, Camera, Check, X,
  Navigation
} from 'lucide-react';
import { toast } from 'sonner';
import { NumericStepper } from '../ui/numeric-stepper';

var BookingPricingModal = (props) => {
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
    handleSaveBookingPricing
  } = props;

  // Safe fallback — prevent crash if bookingPricing hasn't loaded yet
  const safePricing = bookingPricing || {};

  return (
    <>
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
                  value={safePricing.booking_hourly_rate}
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
                  value={safePricing.booking_min_hours}
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
                  value={safePricing.booking_price_web}
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
                  value={safePricing.booking_price_standard}
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
                  value={safePricing.booking_price_high}
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
                  checked={safePricing.booking_full_gallery}
                  onCheckedChange={(checked) => setBookingPricing({ ...bookingPricing, booking_full_gallery: checked })}
                />
              </div>
              
              {!safePricing.booking_full_gallery && (
                <NumericStepper
                  value={safePricing.booking_photos_included}
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
                Formula: Base Session Price + (Per Surfer ? Additional Crew)
              </p>
              <NumericStepper
                label="Price Per Additional Surfer"
                value={safePricing.price_per_additional_surfer}
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
                  value={safePricing.group_discount_2_plus || 0}
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
                  value={safePricing.group_discount_3_plus || 0}
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
                  value={safePricing.group_discount_5_plus || 0}
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
                  value={safePricing.service_radius_miles || 25}
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
                        {safePricing.home_latitude && safePricing.home_longitude 
                          ? `${safePricing.home_latitude.toFixed(4)}, ${safePricing.home_longitude.toFixed(4)}`
                          : 'Required for distance-based pricing'
                        }
                      </p>
                    </div>
                    {safePricing.home_latitude && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                        <Check className="w-3 h-3 mr-1" />
                        Set
                      </Badge>
                    )}
                  </div>
                  
                  {/* Location Name Display */}
                  {safePricing.home_location_name && (
                    <p className={`text-sm ${textPrimaryClass} mb-2 flex items-center gap-1`}>
                      <MapPin className="w-3 h-3 text-orange-400" />
                      {safePricing.home_location_name}
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
                    {safePricing.home_latitude && (
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
                      <Input aria-label="e.g., San Diego, CA or Uluwatu, Bali"
                        placeholder="e.g., San Diego, CA or Uluwatu, Bali"
                        value={safePricing.location_search || ''}
                        onChange={(e) => setBookingPricing({ ...bookingPricing, location_search: e.target.value })}
                        className={`flex-1 text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'} ${textPrimaryClass}`}
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          const query = safePricing.location_search;
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
                  {!safePricing.home_latitude && (
                    <div className={`mt-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'} border border-amber-500/30`}>
                      <p className={`text-xs ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
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
                    checked={safePricing.charges_travel_fees || false}
                    onCheckedChange={(checked) => setBookingPricing({ ...bookingPricing, charges_travel_fees: checked })}
                  />
                </div>
                
                {/* Travel Surcharge Tiers */}
                {safePricing.charges_travel_fees && (
                  <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-sm font-medium ${textPrimaryClass} mb-3`}>Travel Fee Tiers</p>
                    <div className="space-y-2">
                      {(safePricing.travel_surcharges || []).map((tier, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className={`text-xs ${textSecondaryClass} w-24`}>
                            {tier.min_miles}-{tier.max_miles} mi:
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-yellow-400 text-sm">+$</span>
                            <Input aria-label="Numeric input"
                              type="number"
                              value={tier.surcharge}
                              onChange={(e) => {
                                const newTiers = [...(safePricing.travel_surcharges || [])];
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
                        const tiers = safePricing.travel_surcharges || [];
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
    </>
  );
};

export default BookingPricingModal;
