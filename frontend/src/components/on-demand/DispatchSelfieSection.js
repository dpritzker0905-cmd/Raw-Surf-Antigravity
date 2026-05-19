/**
 * DispatchSelfieSection -- Extracted from DispatchLobby.js (v81)
 * Shows selfie prompt or confirmation in the dispatch lobby.
 */
import React from 'react';
import { Camera, ChevronRight, Check } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

const DispatchSelfieSection = ({
  captainSelfieUploaded,
  selfieUrl,
  onShowSelfieModal,
  isLight,
  textPrimary,
  textSecondary,
}) => {
  if (!captainSelfieUploaded) {
    return (
      <button aria-label="div"
        onClick={onShowSelfieModal}
        className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed transition-all ${
          isLight
            ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
            : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <Camera className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 text-left">
          <p className={`font-semibold text-sm ${textPrimary}`}>
            Add Your Selfie
          </p>
          <p className={`text-xs ${textSecondary}`}>
            So the photographer can find you at the beach
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-amber-400" />
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl ${
        isLight ? 'bg-green-50' : 'bg-green-500/10'
      } border border-green-400/30`}
    >
      <img loading="lazy" decoding="async"
        src={getFullUrl(selfieUrl)}
        alt="Your selfie"
        className="w-10 h-10 rounded-full object-cover ring-2 ring-green-400 flex-shrink-0"
      />
      <div className="flex-1">
        <p className={`text-sm font-medium ${textPrimary}`}>
          Selfie uploaded
        </p>
        <p className={`text-xs ${textSecondary}`}>
          Photographer can identify you
        </p>
      </div>
      <Check className="w-5 h-5 text-green-400" />
    </div>
  );
};

export default DispatchSelfieSection;
