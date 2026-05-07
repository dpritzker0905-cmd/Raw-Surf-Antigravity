/**
 * RequestProConfirmStep - Confirm & Pay step panel
 * Extracted from RequestProModal.js for modularization (v71)
 */
import React from 'react';
import {
  Camera, MapPin, Clock, Check, Wallet, Users, CreditCard,
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

const RequestProConfirmStep = ({
  isDark, selectedPro, duration, totalCost,
  captainPayAmount, totalParticipants, isShared,
  hourlyRate, depositAmount, nearestSpot,
  localCredits, hasEnoughCredits, paymentMethod, setPaymentMethod,
}) => (
  <>
    {/* Session Summary Card */}
    <div className={`p-4 rounded-2xl ${isDark ? 'bg-zinc-800/60' : 'bg-gray-50'}`}>
      <div className="flex items-center gap-4 mb-3">
        <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-cyan-400">
          {selectedPro?.avatar_url ? (
            <img loading="lazy" decoding="async" src={getFullUrl(selectedPro.avatar_url)} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`}>
              <Camera className="w-5 h-5 text-cyan-400" />
            </div>
          )}
        </div>
        <div className="flex-1">
          <p className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {selectedPro?.full_name || 'Auto-Match (Nearest Pro)'}
          </p>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {duration * 60} min session
          </p>
        </div>
        <div className="text-right">
          <p className="text-cyan-400 font-bold">${totalCost.toFixed(0)}</p>
          {isShared && (
            <p className="text-xs text-green-400">You: ${captainPayAmount.toFixed(0)}</p>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${isDark ? 'border-zinc-700' : 'border-gray-200'}`}>
        <div className="text-center">
          <MapPin className="w-4 h-4 mx-auto text-yellow-400 mb-1" />
          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Location</p>
          <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'} truncate`}>
            {nearestSpot?.name || 'GPS'}
          </p>
        </div>
        <div className="text-center">
          <Clock className="w-4 h-4 mx-auto text-cyan-400 mb-1" />
          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Duration</p>
          <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{duration * 60} min</p>
        </div>
        <div className="text-center">
          <Users className="w-4 h-4 mx-auto text-purple-400 mb-1" />
          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Surfers</p>
          <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{totalParticipants}</p>
        </div>
      </div>
    </div>

    {/* Price Breakdown */}
    <div className={`${isDark ? 'bg-gradient-to-r from-cyan-900/30 to-blue-900/30 border-cyan-500/25' : 'bg-gradient-to-r from-cyan-50 to-blue-50 border-cyan-200'} rounded-xl border overflow-hidden`}>
      <div className="px-3 pt-3 pb-2 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Rate</span>
          <span className={isDark ? 'text-white' : 'text-gray-900'}>${hourlyRate}/hr &times; {duration}h</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Session Total</span>
          <span className={`${isDark ? 'text-white' : 'text-gray-900'} font-semibold`}>${totalCost.toFixed(0)}</span>
        </div>
        {isShared && (
          <div className={`flex items-center justify-between text-sm pt-1 border-t ${isDark ? 'border-zinc-700/50' : 'border-gray-200'}`}>
            <span className="text-emerald-400">Your Share ({totalParticipants} split)</span>
            <span className="text-emerald-400 font-semibold">~${captainPayAmount.toFixed(0)}</span>
          </div>
        )}
      </div>
      <div className={`px-3 py-2.5 border-t ${isDark ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-cyan-200 bg-cyan-50'} flex items-center justify-between`}>
        <span className="text-cyan-600 dark:text-cyan-400 font-medium text-sm">
          {isShared ? "Captain's Share" : 'Amount Due'}
        </span>
        <span className="text-cyan-600 dark:text-cyan-400 font-bold text-base">${depositAmount}</span>
      </div>
    </div>

    {/* Payment Method Selection */}
    <div className="space-y-3">
      <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Method</p>

      {localCredits > 0 && (
        <button aria-label="Pay with credits"
          onClick={() => setPaymentMethod('credits')}
          className={`w-full p-4 rounded-xl border-2 flex items-center justify-between transition-all ${
            paymentMethod === 'credits'
              ? 'border-amber-400 bg-amber-500/10'
              : isDark ? 'border-zinc-700' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-left">
              <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Surf Credits</p>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Balance: ${localCredits.toFixed(2)}
                {!hasEnoughCredits && ' (insufficient)'}
              </p>
            </div>
          </div>
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'credits' ? 'border-amber-400 bg-amber-400' : isDark ? 'border-zinc-500' : 'border-gray-400'}`}>
            {paymentMethod === 'credits' && <Check className="w-3 h-3 text-black" />}
          </div>
        </button>
      )}

      <button aria-label="Pay with card"
        onClick={() => setPaymentMethod('card')}
        className={`w-full p-4 rounded-xl border-2 flex items-center justify-between transition-all ${
          paymentMethod === 'card'
            ? 'border-cyan-400 bg-cyan-500/10'
            : isDark ? 'border-zinc-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-left">
            <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Card Payment</p>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Visa, Mastercard, etc.</p>
          </div>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'card' ? 'border-cyan-400 bg-cyan-400' : isDark ? 'border-zinc-500' : 'border-gray-400'}`}>
          {paymentMethod === 'card' && <Check className="w-3 h-3 text-black" />}
        </div>
      </button>
    </div>

    {/* Escrow Disclaimer */}
    <p className="text-[10px] text-gray-500 text-center">
      {isShared
        ? 'Crew members have 10 minutes to accept. Your share is charged now.'
        : 'Full payment held in escrow. Refundable to credits until a Pro accepts and starts traveling.'}
    </p>
  </>
);

export default RequestProConfirmStep;
