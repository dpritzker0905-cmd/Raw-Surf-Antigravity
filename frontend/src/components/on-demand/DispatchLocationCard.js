/**
 * DispatchLocationCard - Editable meeting point card with GPS update
 * Extracted from DispatchLobby.js for modularization (v74)
 */
import React from 'react';
import { MapPin, Edit2, Lock, Navigation, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

const DispatchLocationCard = ({
  dispatch, locationLocked,
  editingLocation, setEditingLocation,
  newLocationName, setNewLocationName,
  savingLocation, handleUpdateLocation,
  isLight, textPrimary, textSecondary,
}) => {
  return (
    <div
      className={`p-4 rounded-2xl border ${
        isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            locationLocked ? 'bg-green-500/15' : 'bg-cyan-500/15'
          }`}>
            {locationLocked
              ? <Lock className="w-4 h-4 text-green-400" />
              : <MapPin className="w-4 h-4 text-cyan-400" />
            }
          </div>
          <div>
            <p className={`text-xs font-medium ${locationLocked ? 'text-green-400' : 'text-cyan-400'}`}>
              {locationLocked ? 'Meeting Point (Locked)' : 'Meeting Point'}
            </p>
          </div>
        </div>
        {!locationLocked && !editingLocation && (
          <button aria-label="Edit"
            onClick={() => { setEditingLocation(true); setNewLocationName(dispatch?.location_name || ''); }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              isLight
                ? 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100'
                : 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
            }`}
          >
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        )}
      </div>

      {editingLocation ? (
        <div className="space-y-2">
          <input aria-label="e.g. Pier at 2nd Street"
            type="text"
            value={newLocationName}
            onChange={e => setNewLocationName(e.target.value)}
            placeholder="e.g. Pier at 2nd Street"
            className={`w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-cyan-400/50 ${
              isLight
                ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                : 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500'
            }`}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleUpdateLocation(); if (e.key === 'Escape') setEditingLocation(false); }}
          />
          <p className={`text-[10px] ${textSecondary}`}>
            Your current GPS coordinates will be used. Press Enter to save.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => setEditingLocation(false)}
              className={`flex-1 text-xs py-1.5 ${isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-800 text-zinc-400'}`}
              disabled={savingLocation}
            >Cancel</Button>
            <Button aria-label="Save"
              onClick={handleUpdateLocation}
              disabled={savingLocation || !newLocationName.trim()}
              className="flex-1 text-xs py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white font-bold"
            >
              {savingLocation ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Location'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Navigation className={`w-4 h-4 flex-shrink-0 ${isLight ? 'text-gray-400' : 'text-zinc-500'}`} />
          <p className={`text-sm font-bold ${textPrimary} truncate`}>
            {dispatch?.location_name || dispatch?.location?.name || 'On-Demand Session'}
          </p>
        </div>
      )}
    </div>
  );
};

export default DispatchLocationCard;
