/**
 * ExploreSponsorsTab.js
 * Extracted from Explore.js — Top Sponsors leaderboard tab + Quick Card overlay.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Heart, MessageCircle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';

var ExploreSponsorsTab = ({
  leaderboard,
  leaderboardLoading,
  openSponsorCard,
  selectedSponsor,
  sponsorDetails,
  closeSponsorCard,
}) => {
  const navigate = useNavigate();

  return (
    <>
      {/* Leaderboard List */}
      <div className="space-y-4" data-testid="top-sponsors-tab">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground font-bold text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            Top Sponsors This Month
          </h2>
        </div>

        {leaderboardLoading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No sponsors yet this month</p>
            <p className="text-sm mt-1">Be the first to support a Grom!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leaderboard.map((sponsor, index) => (
              <div
                key={sponsor.photographer_id}
                onClick={() => openSponsorCard(sponsor)}
                className="bg-black border-2 border-white rounded-lg p-4 cursor-pointer hover:bg-card transition-all"
                data-testid={`sponsor-card-${index}`}
              >
                <div className="flex items-center gap-4">
                  {/* Rank */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                    sponsor.rank === 1 ? 'bg-amber-500 text-black' :
                    sponsor.rank === 2 ? 'bg-gray-300 text-black' :
                    sponsor.rank === 3 ? 'bg-amber-700 text-foreground' :
                    'bg-muted text-foreground'
                  }`}>
                    {sponsor.rank}
                  </div>

                  {/* Avatar */}
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={getFullUrl(sponsor.avatar_url)} />
                    <AvatarFallback className="bg-zinc-700 text-foreground">
                      {sponsor.full_name?.[0] || '?'}
                    </AvatarFallback>
                  </Avatar>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-semibold truncate">{sponsor.full_name}</span>
                      {sponsor.is_grom_guardian && (
                        <Badge className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5">
                          Grom Guardian
                        </Badge>
                      )}
                    </div>
                    <p className="text-zinc-500 text-sm">{sponsor.role}</p>
                  </div>

                  {/* Stats */}
                  <div className="text-right">
                    <p className="text-amber-400 font-bold text-lg">
                      {sponsor.monthly_total?.toFixed(0) || 0}
                    </p>
                    <p className="text-zinc-600 text-xs">credits given</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sponsor Quick Card (Bottom Sheet) */}
      {selectedSponsor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeSponsorCard}
          />
          
          {/* Sheet */}
          <div className="relative bg-card border-t-2 border-white rounded-t-2xl w-full max-w-lg animate-slide-up">
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-4">
              <div className="w-10 h-1 bg-zinc-700 rounded-full" />
            </div>

            <div className="px-6 pb-8">
              {/* Profile Header */}
              <div className="flex items-center gap-4 mb-6">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={getFullUrl(selectedSponsor.avatar_url)} />
                  <AvatarFallback className="bg-zinc-700 text-foreground text-xl">
                    {selectedSponsor.full_name?.[0] || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-foreground font-bold text-lg">{selectedSponsor.full_name}</h3>
                    {selectedSponsor.is_grom_guardian && (
                      <Badge className="bg-amber-500 text-black text-xs">
                        Grom Guardian
                      </Badge>
                    )}
                  </div>
                  <p className="text-zinc-400 text-sm">{selectedSponsor.role}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-amber-400">#{selectedSponsor.rank}</p>
                </div>
              </div>

              {/* Impact Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-amber-400 font-bold text-xl">
                    {sponsorDetails?.monthly_total?.toFixed(0) || selectedSponsor.monthly_total?.toFixed(0) || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">This Month</p>
                </div>
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-cyan-400 font-bold text-xl">
                    {sponsorDetails?.lifetime_total?.toFixed(0) || selectedSponsor.lifetime_total?.toFixed(0) || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">Lifetime</p>
                </div>
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-green-400 font-bold text-xl">
                    {sponsorDetails?.total_groms_supported || selectedSponsor.groms_supported || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">Groms</p>
                </div>
              </div>

              {/* Athletes Supported */}
              {sponsorDetails?.supported_athletes?.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-foreground font-semibold mb-3">Athletes Supported</h4>
                  <div className="flex flex-wrap gap-2">
                    {sponsorDetails.supported_athletes.map(athlete => (
                      <div 
                        key={athlete.id}
                        className="flex items-center gap-2 bg-muted rounded-full px-3 py-1.5"
                      >
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={getFullUrl(athlete.avatar_url)} />
                          <AvatarFallback className="bg-amber-900 text-amber-400 text-xs">
                            {athlete.full_name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-foreground text-sm">{athlete.full_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/profile/${selectedSponsor.photographer_id}`)}
                  className="flex-1 bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-all"
                >
                  View Profile
                </button>
                <button aria-label="Message sponsor"
                  onClick={() => navigate(`/messages?to=${selectedSponsor.photographer_id}`)}
                  className="flex-1 bg-muted text-foreground font-semibold py-3 rounded-lg hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Message
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default React.memo(ExploreSponsorsTab);
