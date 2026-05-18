/**
 * BookingPaymentStep G Extracted from ScheduledBookingDrawer.js (v79)
 *
 * The payment method selection + credit slider + payment summary panel
 * for the scheduled booking flow.
 */
import React from 'react';
import { Wallet, CreditCard, Check } from 'lucide-react';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';

const BookingPaymentStep = ({
  crewSplitEnabled,
  captainShare,
  totalPrice,
  userCredits,
  appliedCredits,
  setAppliedCredits,
  paymentMethod,
  setPaymentMethod,
  isLight,
  textPrimary,
  textSecondary,
}) => {
  const amountToPay = crewSplitEnabled ? captainShare : totalPrice;
  const canPayFullWithCredits = userCredits >= amountToPay;

  return (
    <div className="space-y-2">
      <Label className={`font-medium text-sm ${textPrimary}`}>Payment Method</Label>
      
      {/* Option 1: Pay with Credits */}
      {userCredits > 0 && (
        <button
          onClick={() => {
            setPaymentMethod('credits');
            setAppliedCredits(Math.min(userCredits, amountToPay));
          }}
          className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
            paymentMethod === 'credits'
              ? 'border-yellow-400 bg-yellow-500/10'
              : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
          }`}
          data-testid="pay-with-credits-btn"
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            paymentMethod === 'credits' ? 'bg-yellow-400 text-black' : 'bg-zinc-700 text-gray-400'
          }`}>
            <Wallet className="w-4 h-4" />
          </div>
          <div className="flex-1 text-left">
            <div className={`font-medium text-sm ${textPrimary}`}>Account Credits</div>
            <div className={`text-xs ${textSecondary}`}>
              ${userCredits.toFixed(2)} available
              {canPayFullWithCredits && <span className="text-green-400 ml-1">(covers all!)</span>}
            </div>
          </div>
          {paymentMethod === 'credits' && (
            <Check className="w-4 h-4 text-yellow-400" />
          )}
        </button>
      )}
      
      {/* Option 2: Pay with Card */}
      <button
        onClick={() => {
          setPaymentMethod('card');
          setAppliedCredits(0);
        }}
        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
          paymentMethod === 'card'
            ? 'border-cyan-400 bg-cyan-500/10'
            : isLight ? 'border-gray-200 bg-white' : 'border-zinc-700 bg-zinc-800/50'
        }`}
        data-testid="pay-with-card-btn"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          paymentMethod === 'card' ? 'bg-cyan-400 text-white' : 'bg-zinc-700 text-gray-400'
        }`}>
          <CreditCard className="w-4 h-4" />
        </div>
        <div className="flex-1 text-left">
          <div className={`font-medium text-sm ${textPrimary}`}>Pay with Card</div>
          <div className={`text-xs ${textSecondary}`}>Secure via Stripe</div>
        </div>
        {paymentMethod === 'card' && (
          <Check className="w-4 h-4 text-cyan-400" />
        )}
      </button>
      
      {/* Credit Slider for Card */}
      {paymentMethod === 'card' && userCredits > 0 && (
        <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${textSecondary}`}>Also apply credits?</span>
            <span className="text-xs text-yellow-400">${appliedCredits.toFixed(2)}</span>
          </div>
          <Slider
            value={[appliedCredits]}
            onValueChange={([value]) => setAppliedCredits(value)}
            max={Math.min(userCredits, amountToPay)}
            min={0}
            step={0.5}
            className="w-full"
          />
        </div>
      )}
      
      {/* Payment Summary */}
      <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'} border`}>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className={textSecondary}>Session Total</span>
            <span className={textPrimary}>${amountToPay.toFixed(2)}</span>
          </div>
          {appliedCredits > 0 && (
            <div className="flex justify-between text-yellow-500">
              <span>Credits Applied</span>
              <span>-${appliedCredits.toFixed(2)}</span>
            </div>
          )}
          <div className={`flex justify-between pt-1 border-t ${isLight ? 'border-green-200' : 'border-green-500/30'} font-bold`}>
            <span className={textPrimary}>
              {paymentMethod === 'credits' && appliedCredits >= amountToPay 
                ? 'Pay with Credits' 
                : 'Card Payment via Stripe'}
            </span>
            <span className="text-green-400">
              ${Math.max(0, amountToPay - appliedCredits).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
      
      {/* Compact Protection Notice */}
      <p className={`text-xs ${textSecondary}`}>
        <Check className="w-3 h-3 inline mr-1 text-green-400" />
        Payment held until session complete. Cancel 48hrs+ for 90% refund.
      </p>
    </div>
  );
};

export default BookingPaymentStep;
