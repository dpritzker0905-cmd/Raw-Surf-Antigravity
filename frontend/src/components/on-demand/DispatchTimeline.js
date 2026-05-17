/**
 * DispatchTimeline - Session progress timeline with step indicators
 * Extracted from DispatchLobby.js for modularization (v74)
 */
import React from 'react';
import { Check, Camera, Users, Radio, MapPin, Zap } from 'lucide-react';

// --- Timeline Step ---
var TimelineStep = ({ icon: Icon, label, sub, done, active, isLight }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  return (
    <div className={`flex items-center gap-3 transition-opacity ${!done && !active ? 'opacity-40' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
          done
            ? 'bg-green-500/20'
            : active
            ? 'bg-amber-500/20 animate-pulse'
            : 'bg-zinc-700/50'
        }`}
      >
        <Icon
          className={`w-4 h-4 ${done ? 'text-green-400' : active ? 'text-amber-400' : 'text-zinc-500'}`}
        />
      </div>
      <div>
        <p className={`text-sm font-medium ${textPrimary}`}>{label}</p>
        {sub && <p className={`text-xs ${textSecondary}`}>{sub}</p>}
      </div>
    </div>
  );
};

var DispatchTimeline = ({
  dispatch, captainSelfieUploaded, crewAllPaid,
  crewLineup, paidCount, photographerAccepted, eta,
  isLight, textPrimary,
}) => {
  return (
    <div
      className={`p-4 rounded-2xl space-y-3 ${
        isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-800'
      }`}
    >
      <h3 className={`text-sm font-bold ${textPrimary} flex items-center gap-2`}>
        <Zap className="w-4 h-4 text-amber-400" /> Session Progress
      </h3>
      <div className="space-y-2.5">
        <TimelineStep
          icon={Check}
          label="Session Booked"
          sub="Request created & payment secured"
          done
          isLight={isLight}
        />
        <TimelineStep
          icon={Camera}
          label="Add Your Selfie"
          sub="So the photographer can find you"
          done={captainSelfieUploaded}
          active={!captainSelfieUploaded}
          isLight={isLight}
        />
        <TimelineStep
          icon={Users}
          label="Crew Paying"
          sub={
            crewLineup.length > 0
              ? `${paidCount}/${crewLineup.length} crew members confirmed`
              : 'Solo session - no crew to wait for'
          }
          done={crewAllPaid}
          active={!crewAllPaid && captainSelfieUploaded}
          isLight={isLight}
        />
        <TimelineStep
          icon={Radio}
          label="Photographer Confirming"
          sub="Waiting for them to accept your request"
          done={photographerAccepted}
          active={crewAllPaid && !photographerAccepted}
          isLight={isLight}
        />
        <TimelineStep
          icon={MapPin}
          label="Photographer En Route"
          sub={
            photographerAccepted && eta
              ? `~${eta} min away`
              : 'Pending confirmation'
          }
          done={['en_route', 'arrived', 'completed'].includes(dispatch?.status)}
          active={dispatch?.status === 'accepted'}
          isLight={isLight}
        />
      </div>
    </div>
  );
};

export default DispatchTimeline;
