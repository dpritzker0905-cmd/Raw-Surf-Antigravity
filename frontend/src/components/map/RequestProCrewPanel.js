/**
 * RequestProCrewPanel - Crew/Split fare section of the booking wizard
 * Extracted from RequestProModal.js for modularization (v72)
 */
import React from 'react';
import {
  MapPin, Clock, Loader2, Plus, Award, Calculator,
  Wallet, Users, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';

// --- Surfboard colour palette (matches OnDemandRequestDrawer) ----------------
const SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow - captain/you
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#F87171', stroke: '#DC2626' }, // Red
];

const RequestProCrewPanel = ({
  crewOpen, setCrewOpen,
  crewMembers, removeCrewMember,
  showAddCrewInput, setShowAddCrewInput,
  newCrewInput, setNewCrewInput,
  friendSearchResults, setFriendSearchResults,
  searchingFriends,
  addCrewMember,
  showCaptainsHub, setShowCaptainsHub,
  totalParticipants, captainPayAmount, perPersonSplit,
  distributeEvenly, coverAll,
  handlePercentageChange, toggleCoverMember,
  user,
  SurfboardAvatar, EmptySeat,
}) => (
  <div className="bg-zinc-800/50 rounded-xl">
    {/* Toggle header */}
    <div className="flex items-center justify-between px-3 py-3">
      <div>
        <p className="text-sm font-medium text-white flex items-center gap-1.5">
          <Users className="w-4 h-4 text-cyan-400" />
          Invite Crew to Split
        </p>
        <p className="text-xs text-gray-400">10 min to accept - cost split equally</p>
      </div>
      <button
        onClick={() => setCrewOpen(v => !v)}
        role="switch"
        aria-checked={crewOpen}
        className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${crewOpen ? 'bg-cyan-400' : 'bg-zinc-600'}`}
        aria-label="Toggle crew invite"
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${crewOpen ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>

    {crewOpen && (
      <div className="border-t border-zinc-700">

        {/* -- OCEAN / LINEUP VISUALIZATION -- */}
        <div className="relative p-4 bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900 overflow-visible">
          {/* Wave SVG background */}
          <div className="absolute inset-0 opacity-20 overflow-hidden rounded-b-none">
            <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
              <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
              <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
            </svg>
          </div>

          {/* "THE LINEUP" label */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            THE LINEUP
          </div>

          {/* Surfboard arc */}
          <div className="relative pt-6">
            {/* Captain (you) - top center */}
            <div className="flex justify-center mb-2">
              <SurfboardAvatar
                member={{ name: user?.full_name || 'You', avatar_url: user?.avatar_url }}
                index={0}
                isCaptain={true}
              />
            </div>

            {/* Crew row */}
            <div className="flex justify-center items-end gap-4 flex-wrap">
              {crewMembers.map((m, idx) => (
                <SurfboardAvatar
                  key={m.id}
                  member={m}
                  index={idx + 1}
                  isCaptain={false}
                  onRemove={removeCrewMember}
                />
              ))}
              {crewMembers.length < 6 && (
                <EmptySeat onClick={() => setShowAddCrewInput(true)} />
              )}
            </div>
          </div>

          {/* Add crew input + autocomplete */}
          {showAddCrewInput && (
            <div className="mt-4 relative z-20">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input aria-label="Search by name or @username"
                    type="text"
                    value={newCrewInput}
                    onChange={e => setNewCrewInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && friendSearchResults.length === 0 && newCrewInput.trim()) addCrewMember(null); }}
                    placeholder="Search by name or @username"
                    autoFocus
                    className="w-full bg-zinc-700/80 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
                  />
                  {/* Autocomplete dropdown */}
                  {(friendSearchResults.length > 0 || searchingFriends) && (
                    <div className="absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl border border-zinc-600 bg-zinc-800" style={{ zIndex: 9999 }}>
                      {searchingFriends && (
                        <div className="p-3 flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="w-4 h-4 animate-spin" /> Searching-
                        </div>
                      )}
                      {friendSearchResults.map(friend => (
                        <button aria-label="div"
                          key={friend.id}
                          onClick={() => addCrewMember(friend)}
                          className="w-full p-3 flex items-center gap-3 text-left hover:bg-zinc-700 transition-colors"
                        >
                          <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-600 flex-shrink-0">
                            {friend.avatar_url
                              ? <img loading="lazy" decoding="async" src={getFullUrl(friend.avatar_url)} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-300">{friend.full_name?.[0]?.toUpperCase() || '?'}</div>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{friend.full_name}</p>
                            {friend.username && <p className="text-xs text-gray-400 truncate">@{friend.username}</p>}
                          </div>
                          <Plus className="w-4 h-4 text-cyan-400 shrink-0" />
                        </button>
                      ))}
                      {!searchingFriends && friendSearchResults.length === 0 && newCrewInput.length >= 2 && (
                        <div className="p-3 text-sm text-gray-400">No users found. Press Enter to add manually.</div>
                      )}
                    </div>
                  )}
                </div>
                <button aria-label="Add"
                  onClick={() => newCrewInput.trim() && addCrewMember(null)}
                  disabled={!newCrewInput.trim()}
                  className="px-3 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-black rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setShowAddCrewInput(false); setNewCrewInput(''); setFriendSearchResults([]); }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-gray-300 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* -- CAPTAIN'S HUB (only when crew present) -- */}
        {crewMembers.length > 0 && (
          <div className="p-3 space-y-3 bg-zinc-800/80">
            {/* Captain's Hub toggle header */}
            <button aria-label="Award"
              onClick={() => setShowCaptainsHub(v => !v)}
              className="w-full flex items-center justify-between text-sm font-medium text-white"
            >
              <span className="flex items-center gap-1.5">
                <Award className="w-4 h-4 text-yellow-400" />
                Captain's Hub
                <Badge className="bg-purple-500/20 text-purple-300 text-[10px] ml-1">{totalParticipants} surfers</Badge>
              </span>
              {showCaptainsHub ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {/* Summary (always visible) */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Your share</span>
              <span className="text-yellow-400 font-bold">${captainPayAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Even split</span>
              <span className="text-emerald-400 font-medium">${perPersonSplit}/person</span>
            </div>

            {/* Expandable controls */}
            {showCaptainsHub && (
              <div className="space-y-3 pt-1 border-t border-zinc-700">
                {/* Quick actions */}
                <div className="flex gap-2">
                  <button aria-label="Calculator"
                    onClick={distributeEvenly}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-gray-200 transition-colors"
                  >
                    <Calculator className="w-3.5 h-3.5" /> Even Split
                  </button>
                  <button aria-label="Wallet"
                    onClick={coverAll}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-xs text-purple-300 border border-purple-500/30 transition-colors"
                  >
                    <Wallet className="w-3.5 h-3.5" /> I'll Cover All
                  </button>
                </div>

                {/* Per-member controls */}
                {crewMembers.map((m, idx) => {
                  const share = m.share_amount || parseFloat(perPersonSplit);
                  const pct   = m.share_percentage || (100 / totalParticipants);
                  const board = SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length];
                  const isCovered = m.covered_by_captain;
                  return (
                    <div key={m.id} className="p-3 rounded-xl bg-zinc-700/50 space-y-2">
                      {/* Member header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black"
                            style={{ backgroundColor: board.fill }}
                          >
                            {(m.name || m.value)?.[0]?.toUpperCase() || 'C'}
                          </div>
                          <p className="text-sm font-medium text-white">{m.name || m.value?.split('@')[0] || `Crew ${idx + 1}`}</p>
                        </div>
                        {isCovered ? (
                          <Badge className="bg-purple-500/20 text-purple-300 text-[10px]">
                            <Wallet className="w-3 h-3 mr-1" />You Cover
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">${share.toFixed(2)}</Badge>
                        )}
                      </div>

                      {/* % slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-gray-400">Share: {pct.toFixed(0)}%</span>
                          <span className={`text-xs font-bold ${isCovered ? 'line-through text-gray-500' : 'text-white'}`}>${share.toFixed(2)}</span>
                        </div>
                        <input aria-label="Range slider"
                          type="range" min={0} max={100} value={pct}
                          onChange={e => handlePercentageChange(m.id, parseFloat(e.target.value))}
                          disabled={isCovered}
                          className="w-full h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-40"
                          style={{ background: isCovered ? '#3f3f46' : `linear-gradient(to right, ${board.fill} 0%, ${board.fill} ${pct}%, #3f3f46 ${pct}%, #3f3f46 100%)` }}
                        />
                      </div>

                      {/* "I'll cover" toggle */}
                      <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isCovered ? 'bg-purple-500/20' : 'bg-zinc-600/40'}`}>
                        <span className={`text-xs ${isCovered ? 'text-purple-300' : 'text-gray-400'}`}>I'll cover this surfer</span>
                        <button
                          onClick={() => toggleCoverMember(m.id)}
                          role="switch"
                          aria-checked={isCovered}
                          aria-label="Cover this surfer"
                          className={`w-10 h-5 rounded-full relative transition-colors ${isCovered ? 'bg-purple-500' : 'bg-zinc-600'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${isCovered ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 10-min window note */}
            <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg">
              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Crew has <strong>10 minutes</strong> to accept. Those who don't respond miss out. Cost splits among confirmed members.
              </p>
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);

export default RequestProCrewPanel;
