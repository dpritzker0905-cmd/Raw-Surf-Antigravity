/**
 * PhotographerProfileContent.js
 * Extracted from UnifiedSpotDrawer.js — Photographer profile views (scrollable content + full drawer).
 */
import React, { useState, useEffect } from 'react';
import { MapPin, Camera, ArrowLeft, Star, Loader2, Calendar, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';
import { StarRating, ReviewsCarousel } from './SpotDrawerHelpers';

// Photographer Profile Content - SCROLLABLE CONTENT ONLY (for vaul drawer)
export var PhotographerProfileContent = React.memo(({ photographer }) => {
  const [reviews, setReviews] = useState([]);
  const [recentBookings, setRecentBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchPhotographerData = async () => {
      if (!photographer?.id) return;
      setLoading(true);
      try {
        const reviewsRes = await apiClient.get(`/reviews/photographer/${photographer.id}?limit=5`);
        setReviews(reviewsRes.data || []);
        
        const sessionsRes = await apiClient.get(`/photographer/${photographer.id}/session-history?limit=3`);
        setRecentBookings(sessionsRes.data || []);
      } catch (e) {
        logger.error('Error fetching photographer data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchPhotographerData();
  }, [photographer?.id]);
  
  const avgRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  return (
    <>
      {/* Profile Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
          <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
            {photographer?.avatar_url ? (
              <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} className="w-full h-full object-cover" alt="" />
            ) : (
              <span className="flex items-center justify-center h-full text-2xl text-cyan-400">
                {photographer?.full_name?.charAt(0)}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1">
          <h2 className="text-white font-bold text-lg">{photographer?.full_name}</h2>
          <p className="text-gray-400 text-sm">{photographer?.role}</p>
          {avgRating && (
            <div className="flex items-center gap-1 mt-1">
              <StarRating rating={Math.round(parseFloat(avgRating))} />
              <span className="text-yellow-400 text-sm font-medium ml-1">{avgRating}</span>
              <span className="text-gray-500 text-xs">({reviews.length} reviews)</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Session Pricing */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Session Pricing</h4>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-green-400 text-xl font-bold">${photographer?.live_buyin_price || photographer?.session_price || 25}</p>
            <p className="text-gray-500 text-xs">Buy-in</p>
          </div>
          <div>
            <p className="text-cyan-400 text-xl font-bold">${photographer?.live_photo_price || 5}</p>
            <p className="text-gray-500 text-xs">Per Photo</p>
          </div>
          <div>
            <p className="text-white text-xl font-bold">{photographer?.photo_package_size || 3}</p>
            <p className="text-gray-500 text-xs">Included</p>
          </div>
        </div>
      </div>
      
      {/* Equipment Badge */}
      {photographer?.equipment && (
        <div className="bg-zinc-800/50 rounded-xl p-4">
          <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Equipment
          </h4>
          <div className="flex items-center gap-2">
            <Badge className="bg-purple-500/20 text-purple-400">
              {photographer.equipment}
            </Badge>
          </div>
        </div>
      )}
      
      {/* Top Reviews */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-400" />
          Top Reviews
        </h4>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <ReviewsCarousel reviews={reviews.filter(r => r.rating >= 4)} />
        )}
      </div>
      
      {/* Recent Bookings */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Recent Sessions
        </h4>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : recentBookings.length > 0 ? (
          <div className="space-y-2">
            {recentBookings.map((booking, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <div className="flex-1">
                  <p className="text-gray-300 text-sm">{booking.location}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(booking.started_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-green-400 text-xs">{booking.total_surfers} surfers</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-2">No recent sessions</p>
        )}
      </div>
    </>
  );
});

// Full-page Photographer Profile (with header + footer) - Legacy version
export var PhotographerProfile = React.memo(({ photographer, onBack, onJumpIn }) => {
  return (
    <div 
      className="relative bg-zinc-900" 
      style={{ height: '90vh', maxHeight: '90vh' }}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 p-4 border-b border-zinc-800 bg-zinc-900">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2" aria-label="Go back">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h3 className="text-white font-bold flex-1">Photographer Profile</h3>
      </div>
      
      {/* Scrollable Content */}
      <div 
        className="absolute left-0 right-0 overflow-y-scroll overflow-x-hidden p-4 space-y-4"
        style={{ 
          top: '60px',
          bottom: '80px',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y'
        }}
      >
        <PhotographerProfileContent photographer={photographer} />
      </div>
      
      {/* Fixed Bottom Button */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        <Button aria-label="Jump in session"
          onClick={onJumpIn}
          className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
        >
          <Users className="w-5 h-5 mr-2" />
          Jump In - ${photographer?.session_price || 25}
        </Button>
      </div>
    </div>
  );
});
