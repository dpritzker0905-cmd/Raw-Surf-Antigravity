import React from 'react';
import { ChevronRight, ChevronLeft, Zap, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

export const BookingFooter = ({
  step,
  isLight,
  handleNext,
  handleBack,
  handleSubmitBooking,
  loading,
  canProceedFromTime,
  canProceedFromLocation,
  canProceedFromCrew
}) => {
  if (step === 'success') return null;

  return (
    <div className={`flex-shrink-0 px-4 py-2 border-t ${isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'}`}>
      {step === 'time' && (
        <Button aria-label="Next"
          onClick={handleNext}
          disabled={!canProceedFromTime}
          className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
          data-testid="continue-to-location-btn"
        >
          Continue
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      )}
      
      {step === 'location' && (
        <div className="flex gap-2">
          <Button aria-label="Previous"
            variant="outline"
            onClick={handleBack}
            className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button aria-label="Next"
            onClick={handleNext}
            disabled={!canProceedFromLocation}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
            data-testid="continue-to-crew-btn"
          >
            Continue
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
      
      {step === 'crew' && (
        <div className="flex gap-2">
          <Button aria-label="Previous"
            variant="outline"
            onClick={handleBack}
            className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button aria-label="Next"
            onClick={handleNext}
            disabled={!canProceedFromCrew}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
            data-testid="continue-to-payment-btn"
          >
            Payment
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
      
      {step === 'payment' && (
        <div className="flex gap-2">
          <Button aria-label="Previous"
            variant="outline"
            onClick={handleBack}
            className={`flex-1 h-10 ${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button aria-label="Next"
            onClick={handleNext}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-10"
            data-testid="review-booking-btn"
          >
            Review
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
      
      {step === 'confirm' && (
        <div className="flex gap-2">
          <Button aria-label="Previous"
            variant="outline"
            onClick={handleBack}
            className="flex-1 h-10 border-zinc-700"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button aria-label="Loader2"
            onClick={handleSubmitBooking}
            disabled={loading}
            className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold h-10"
            data-testid="confirm-booking-btn"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Zap className="w-4 h-4 mr-1" />
                Confirm & Pay
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
