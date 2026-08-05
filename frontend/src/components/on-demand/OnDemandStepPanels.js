/**
 * OnDemandStepPanels.js -- Extracted from OnDemandRequestDrawer.js
 * Crew and Crew Payment step panels (~466 lines).
 */
import React from 'react';
import { X, Loader2, Check, CreditCard, MapPin, Plus, ChevronRight, Award, Wallet, Calculator } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';
import { formatDuration } from '../../utils/formatTime';
import SurfboardAvatar from './SurfboardAvatar';
import { QualityTierBadge } from '../gallery/PriceSourceBadge';

// Surfboard colors for crew visualization
const SURFBOARD_COLORS = [
  { fill: '#06b6d4', stroke: '#0891b2' },
  { fill: '#f97316', stroke: '#ea580c' },
  { fill: '#a855f7', stroke: '#9333ea' },
  { fill: '#22c55e', stroke: '#16a34a' },
  { fill: '#f43f5e', stroke: '#e11d48' },
  { fill: '#eab308', stroke: '#ca8a04' },
  { fill: '#3b82f6', stroke: '#2563eb' },
];

// EmptySeat placeholder for unfilled crew slots
const EmptySeat = ({ onClick, isLight }) => (
  <button onClick={onClick} className='relative flex flex-col items-center opacity-50 hover:opacity-80 transition-opacity' aria-label="Add crew member">
    <div className='w-10 h-20 rounded-full border-2 border-dashed border-border/40 flex items-center justify-center'>
      <Plus className='w-4 h-4 text-muted-foreground' />
    </div>
    <span className='text-[10px] text-muted-foreground mt-1'>Invite</span>
  </button>
);

export const CrewStepPanel = ({ booking, crewMembers, handleRemoveCrewMember, handleAddCrewMember, getFullUrl: getFullUrlFn }) => {
  const {
    step, setStep, isLight, textPrimary, textSecondary,
    user, recentBuddies, following, showAddCrewInput, setShowAddCrewInput,
    newCrewInput, setNewCrewInput, friendSearchResults, setFriendSearchResults,
    searchingFriends, handleSelectFriend, maxCrew,
    totalParticipants, requestDuration, baseSessionPrice, crewAdditionalCost,
    totalPrice, perSurferFee, perPersonSplit,
  } = booking || {};
  return (
    <>
        {step === 'crew' && (
          <div className="p-4 sm:p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('split_choice')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <h2 className={`text-xl font-bold ${textPrimary}`}>Your Crew</h2>
            </div>
            
            {/* Ocean Background with Surfboards */}
            <div className={`relative p-4 sm:p-6 rounded-2xl overflow-visible ${isLight ? 'bg-gradient-to-b from-cyan-100 via-blue-50 to-white' : 'bg-gradient-to-b from-cyan-900/30 via-blue-900/20 to-zinc-900'}`}>
 {/* Wave pattern background -- pointer-events-none so quick-add pills remain clickable */}
              <div className="absolute inset-0 opacity-20 overflow-hidden rounded-2xl pointer-events-none">
                <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="none">
                  <path d="M0,100 Q50,80 100,100 T200,100 T300,100 T400,100 V200 H0 Z" fill="currentColor" className="text-cyan-500" opacity="0.3" />
                  <path d="M0,120 Q50,100 100,120 T200,120 T300,120 T400,120 V200 H0 Z" fill="currentColor" className="text-blue-500" opacity="0.2" />
                </svg>
              </div>
              
              {/* "PEAK" Label */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-cyan-400 font-medium flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                THE LINEUP
              </div>
              
              {/* Crew Members in Arc Layout */}
              <div className="relative pt-6">
                {/* Captain at center top */}
                <div className="flex justify-center mb-2">
                  <SurfboardAvatar 
                    member={{ 
                      name: user?.full_name || 'You', 
                      avatar_url: user?.avatar_url 
                    }} 
                    index={0} 
                    isCaptain={true}
                    isLight={isLight}
                  />
                </div>
                
                {/* Crew Members in row */}
                <div className="flex justify-center items-end gap-4 flex-wrap">
                  {crewMembers.map((member, idx) => (
                    <SurfboardAvatar 
                      key={member.id}
                      member={member} 
                      index={idx + 1} 
                      isCaptain={false}
                      onRemove={handleRemoveCrewMember}
                      isLight={isLight}
                    />
                  ))}
                  
                  {/* Empty Seats */}
                  {crewMembers.length < 6 && (
                    <EmptySeat onClick={() => setShowAddCrewInput(true)} isLight={isLight} />
                  )}
                </div>
              </div>
              
              {/* Add Crew Input with Autocomplete OR Quick Add suggestions */}
              {!showAddCrewInput ? (
                /* Quick Add suggestions - always visible when no search open */
                (() => {
                  const usedIds = new Set([user?.id, ...crewMembers.map(m => m.user_id || m.id)]);
                  const suggestions = [...recentBuddies, ...following]
                    .filter((p, idx, self) =>
                      idx === self.findIndex(t => t.id === p.id) && !usedIds.has(p.id)
                    ).slice(0, 8);
                  return (
                    <div className="mt-4 space-y-2">
                      <p className={`text-xs font-medium ${textSecondary} flex items-center gap-1`}>
                        <span>?</span> Quick Add
                      </p>
                      {suggestions.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {suggestions.map((person) => (
                            <button
                              key={person.id}
                              onClick={() => handleSelectFriend(person)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-full ${
                                isLight ? 'bg-gray-100 hover:bg-cyan-50' : 'bg-zinc-800 hover:bg-zinc-700'
                              } hover:ring-2 ring-cyan-500/50 transition-all`}
                            >
                              <div className="w-6 h-6 rounded-full overflow-hidden bg-gradient-to-br from-cyan-400 to-blue-500 flex-shrink-0">
                                {person.avatar_url ? (
                                  <img loading="lazy" decoding="async" src={getFullUrl(person.avatar_url)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="w-full h-full flex items-center justify-center text-white font-bold text-xs">
                                    {(person.full_name || '?')[0].toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <span className={`text-sm ${textPrimary}`}>{person.full_name?.split(' ')[0]}</span>
                              <Plus className="w-3 h-3 text-cyan-400" />
                            </button>
                          ))}
                        </div>
                      ) : (
 <p className={`text-xs ${textSecondary}`}>No recent connections -- use the search to find crew members.</p>
                      )}
                    </div>
                  );
                })()
              ) : null}

              {/* Add Crew Input with Autocomplete */}
              {showAddCrewInput && (
                <div className="mt-4 relative" style={{ zIndex: 50 }}>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input aria-label="Search by name or @username..."
                        value={newCrewInput}
                        onChange={(e) => setNewCrewInput(e.target.value)}
                        placeholder="Search by name or @username..."
                        className={`w-full ${isLight ? 'bg-white' : 'bg-card/80'}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && friendSearchResults.length === 0) {
                            handleAddCrewMember();
                          }
                        }}
                        autoFocus
                        data-testid="crew-search-input"
                      />
 {/* Autocomplete Dropdown -- API results OR inline following list */}
                      {(friendSearchResults.length > 0 || searchingFriends || (newCrewInput.length > 0 && !searchingFriends)) && (
                        <div 
                          className={`absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl border ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-800 border-zinc-600'}`}
                          style={{ zIndex: 9999 }}
                          data-testid="crew-autocomplete-dropdown"
                        >
                          {searchingFriends && (
                            <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Searching...
                            </div>
                          )}
                          {friendSearchResults.map((friend) => (
                            <button
                              key={friend.id}
                              onClick={() => handleSelectFriend(friend)}
                              className={`w-full p-3 flex items-center gap-3 text-left transition-colors ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-700'}`}
                              data-testid={`crew-friend-option-${friend.id}`}
                            >
                              <div className="w-9 h-9 rounded-full overflow-hidden bg-muted flex-shrink-0">
                                {friend.avatar_url ? (
                                  <img loading="lazy" decoding="async" src={getFullUrl(friend.avatar_url)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
                                    {friend.full_name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${textPrimary}`}>{friend.full_name}</p>
                                {friend.username && (
                                  <p className={`text-xs truncate ${textSecondary}`}>@{friend.username}</p>
                                )}
                              </div>
                              <Plus className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                            </button>
                          ))}
                          {!searchingFriends && friendSearchResults.length === 0 && newCrewInput.length >= 1 && (
                            <div className="p-3 text-sm text-muted-foreground">
                              No matches found. Press Enter or tap + to add by username.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <Button aria-label="Add" 
                      onClick={handleAddCrewMember} 
                      size="sm" 
                      className="bg-cyan-500 hover:bg-cyan-600 flex-shrink-0"
                      disabled={!newCrewInput.trim()}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button 
                      onClick={() => {
                        setShowAddCrewInput(false);
                        setNewCrewInput('');
                        setFriendSearchResults([]);
                      }} 
                      size="sm" 
                      variant="outline"
                      className="flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Crew Count & Price Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-purple-50 to-cyan-50' : 'bg-gradient-to-r from-purple-500/10 to-cyan-500/10'} border border-purple-400/30`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-yellow-400" />
                  <span className={`font-medium ${textPrimary}`}>Captain's Split</span>
                </div>
                <Badge className="bg-purple-500 text-foreground">{totalParticipants} surfer{totalParticipants > 1 ? 's' : ''}</Badge>
              </div>
              
              {/* Quality Tier Badge - On-Demand is always Standard */}
              <div className="mb-3">
                <QualityTierBadge serviceType="on_demand" className="w-full justify-center" />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className={textSecondary}>Session ({formatDuration(requestDuration)})</span>
                  <span className={textPrimary}>${baseSessionPrice.toFixed(2)}</span>
                </div>
                {crewMembers.length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className={textSecondary}>+{crewMembers.length} crew @ ${perSurferFee}/ea</span>
                    <span className={textPrimary}>+${crewAdditionalCost.toFixed(2)}</span>
                  </div>
                )}
                <div className={`flex justify-between pt-2 border-t ${isLight ? 'border-purple-200' : 'border-purple-500/30'}`}>
                  <span className={`font-bold ${textPrimary}`}>Session Total</span>
                  <span className="font-bold text-amber-400">${totalPrice.toFixed(2)}</span>
                </div>
                {crewMembers.length > 0 && (
                  <div className="flex justify-between text-green-400 font-medium">
                    <span>Even split</span>
                    <span>${perPersonSplit}/person</span>
                  </div>
                )}
              </div>
            </div>
            

          </div>
        )}
        
        {/* ============ STEP 2.5: CREW PAYMENT SPLITS ============ */}
    </>
  );
};

export const CrewPaymentStepPanel = ({ booking, crewMembers, getFullUrl: getFullUrlFn }) => {
  const {
    step, setStep, isLight, textPrimary, textSecondary,
    totalPrice, captainPayAmount, crewCoversAmount, totalParticipants, perPersonSplit,
    handleDistributeEvenly, handleCoverAllCrew, handleCrewPercentageChange, handleToggleCoverMember,
    localCredits, paymentMethod, setPaymentMethod,
  } = booking || {};
  return (
    <>
        {step === 'crew_payment' && crewMembers.length > 0 && (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => setStep('crew')} className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-muted'}`} aria-label="Next">
                <ChevronRight className={`w-5 h-5 ${textSecondary} rotate-180`} />
              </button>
              <div>
                <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
                  <Award className="w-5 h-5 text-yellow-400" />
                  Captain's Hub
                </h2>
                <p className={`text-xs ${textSecondary}`}>Control how the crew splits the cost</p>
              </div>
            </div>
            
            {/* Real-Time Balance Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-br from-cyan-50 to-blue-50' : 'bg-gradient-to-br from-cyan-500/10 to-blue-500/10'} border border-cyan-400/30`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`font-bold ${textPrimary}`}>Session Total</span>
                <span className="text-2xl font-bold text-cyan-400">${totalPrice.toFixed(2)}</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
 <span className={textSecondary}>Your Share (Captain) G {totalPrice > 0 ? ((captainPayAmount / totalPrice) * 100).toFixed(0) : 0}%</span>
                  <span className="font-medium text-yellow-400">${captainPayAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
 <span className={textSecondary}>Crew Covers G {totalPrice > 0 ? ((crewCoversAmount / totalPrice) * 100).toFixed(0) : 0}%</span>
                  <span className={textPrimary}>${crewCoversAmount.toFixed(2)}</span>
                </div>
              </div>
              {/* Visual percentage bar */}
              <div className={`mt-2 h-2 rounded-full overflow-hidden ${isLight ? 'bg-gray-200' : 'bg-zinc-800'}`}>
                <div 
                  className="h-full bg-gradient-to-r from-yellow-400 to-amber-500 transition-all duration-300 rounded-full"
                  style={{ width: `${totalPrice > 0 ? (captainPayAmount / totalPrice) * 100 : 0}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className={`text-[10px] ${textSecondary}`}>You</span>
                <span className={`text-[10px] ${textSecondary}`}>Crew</span>
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="flex gap-2">
              <Button aria-label="Calculator"
                size="sm"
                variant="outline"
                onClick={handleDistributeEvenly}
                className={`flex-1 ${isLight ? 'border-gray-300' : 'border-zinc-600'}`}
              >
                <Calculator className="w-4 h-4 mr-1" />
                Even Split
              </Button>
              <Button aria-label="Wallet"
                size="sm"
                variant="outline"
                onClick={handleCoverAllCrew}
                className={`flex-1 ${isLight ? 'border-purple-300 text-purple-600' : 'border-purple-500/50 text-purple-400'}`}
              >
                <Wallet className="w-4 h-4 mr-1" />
                I'll Cover All
              </Button>
            </div>
            
            {/* Crew Member Payment Controls */}
            <div className="space-y-3">
              <h4 className={`text-sm font-medium ${textSecondary}`}>Crew Payment Controls</h4>
              
              {crewMembers.map((member, idx) => {
                const memberShare = member.share_amount ?? parseFloat(perPersonSplit);
                const memberPercentage = member.share_percentage ?? (100 / totalParticipants);
                const isCovered = member.covered_by_captain || false;
                
                return (
                  <div 
                    key={member.id}
                    className={`p-4 rounded-xl ${isLight ? 'bg-gray-50 border border-gray-100' : 'bg-muted/50 border border-zinc-700/50'}`}
                  >
                    {/* Member Header with Surfboard Color */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-foreground"
                          style={{ backgroundColor: SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill }}
                        >
                          {(member.name || member.value)?.[0]?.toUpperCase() || 'C'}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${textPrimary}`}>
                            {member.name || member.value?.split('@')[0] || `Crew ${idx + 1}`}
                          </p>
                          <p className={`text-xs ${textSecondary}`}>
                            {member.type === 'email' ? 'Email invite' : 'Username invite'}
                          </p>
                        </div>
                      </div>
                      
                      {isCovered ? (
                        <Badge className="bg-purple-500/20 text-purple-400">
                          <Wallet className="w-3 h-3 mr-1" />
                          You Cover
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/20 text-amber-400">
                          ${memberShare.toFixed(2)}
                        </Badge>
                      )}
                    </div>

                    {/* Payment Controls */}
                    <div className="space-y-3">
                      {/* Percentage Slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs ${textSecondary}`}>
                            Share: {memberPercentage.toFixed(0)}%
                          </span>
                          <span className={`text-sm font-bold ${isCovered ? 'line-through text-gray-500' : textPrimary}`}>
                            ${memberShare.toFixed(2)}
                          </span>
                        </div>
                        <input aria-label="Range slider"
                          type="range"
                          min={0}
                          max={100}
                          value={memberPercentage}
                          onChange={(e) => handleCrewPercentageChange(member.id, parseFloat(e.target.value))}
                          disabled={isCovered}
                          className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-50"
                          style={{
                            background: isCovered ? '#3f3f46' : `linear-gradient(to right, ${SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill} 0%, ${SURFBOARD_COLORS[(idx + 1) % SURFBOARD_COLORS.length].fill} ${memberPercentage}%, #3f3f46 ${memberPercentage}%, #3f3f46 100%)`
                          }}
                        />
                      </div>

                      {/* "I'll Cover This Member" Toggle */}
                      <div className={`flex items-center justify-between p-2 rounded-lg ${isCovered ? (isLight ? 'bg-purple-100' : 'bg-purple-500/20') : (isLight ? 'bg-gray-100' : 'bg-card')}`}>
                        <div className="flex items-center gap-2">
                          <Wallet className={`w-4 h-4 ${isCovered ? 'text-purple-400' : textSecondary}`} />
                          <span className={`text-sm ${isCovered ? 'text-purple-400' : textSecondary}`}>
                            I'll cover this surfer
                          </span>
                        </div>
                        <button
                          role="switch"
                          aria-checked={isCovered}
                          aria-label="Cover this surfer"
                          onClick={() => handleToggleCoverMember(member.id)}
                          className={`w-10 h-5 rounded-full transition-colors ${isCovered ? 'bg-purple-500' : 'bg-zinc-600'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${isCovered ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Final Summary */}
            <div className={`p-4 rounded-xl ${isLight ? 'bg-yellow-50' : 'bg-yellow-500/10'} border border-yellow-400/30`}>
              <div className="flex justify-between items-center">
                <div>
                  <p className={`text-sm ${textSecondary}`}>You'll pay now</p>
                  <p className="text-2xl font-bold text-yellow-400">${captainPayAmount.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs ${textSecondary}`}>Crew will be notified</p>
                  <p className={`text-sm ${textPrimary}`}>{crewMembers.filter(m => !m.covered_by_captain).length} payment requests</p>
                </div>
              </div>
            </div>
            
            {/* Payment Method Selection - Also in crew_payment step */}
            <div className="space-y-3">
              <p className={`text-sm font-medium ${textPrimary}`}>Payment Method</p>
              
              {localCredits > 0 && (
                <button
                  onClick={() => setPaymentMethod('credits')}
                  className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                    paymentMethod === 'credits' 
                      ? 'border-amber-400 bg-amber-500/10' 
                      : `border-border ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted/50'}`
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`font-medium ${textPrimary}`}>Surf Credits</p>
                    <p className={`text-xs ${textSecondary}`}>Balance: ${localCredits.toFixed(2)}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'credits' ? 'border-amber-400 bg-amber-400' : 'border-zinc-500'}`}>
                    {paymentMethod === 'credits' && <Check className="w-3 h-3 text-black" />}
                  </div>
                </button>
              )}
              
              <button
                onClick={() => setPaymentMethod('card')}
                className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 transition-all ${
                  paymentMethod === 'card' 
                    ? 'border-cyan-400 bg-cyan-500/10' 
                    : `border-border ${isLight ? 'hover:bg-gray-50' : 'hover:bg-muted/50'}`
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className={`font-medium ${textPrimary}`}>Credit/Debit Card</p>
                  <p className={`text-xs ${textSecondary}`}>Pay with Stripe</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'card' ? 'border-cyan-400 bg-cyan-400' : 'border-zinc-500'}`}>
                  {paymentMethod === 'card' && <Check className="w-3 h-3 text-black" />}
                </div>
              </button>
            </div>
            

          </div>
        )}
        
        {/* ============ STEP 3: CONFIRM & PAY ============ */}
    </>
  );
};
