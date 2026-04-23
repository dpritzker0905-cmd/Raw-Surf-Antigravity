import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import {
  Camera, MapPin, Star, Users, Image as ImageIcon,
  Calendar, ExternalLink, Share2, ArrowLeft, Loader2,
  CheckCircle, Instagram, Globe, Briefcase, Play,
  Heart, MessageCircle, ShieldCheck
} from 'lucide-react';
import logger from '../utils/logger';

/**
 * GalleryStorefront — Premium public photographer portfolio page
 * Accessed via /gallery/:username (shareable URL)
 * Resolves username → profile → galleries + stats
 */
export const GalleryStorefront = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [photographer, setPhotographer] = useState(null);
  const [stats, setStats] = useState(null);
  const [galleries, setGalleries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // Theme tokens
  const pageBg = isLight ? 'bg-gray-50' : 'bg-black';
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  const fetchStorefront = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Resolve username → profile
      const profileRes = await apiClient.get(`/profiles/by-username/${encodeURIComponent(username)}`);
      const profile = profileRes.data;
      setPhotographer(profile);

      // 2. Fetch storefront stats
      const statsRes = await apiClient.get(`/profiles/${profile.id}/storefront-stats`);
      setStats(statsRes.data);

      // 3. Fetch public galleries
      try {
        const galleriesRes = await apiClient.get(`/photographer/${profile.id}/galleries`);
        setGalleries(galleriesRes.data?.galleries || galleriesRes.data || []);
      } catch (gErr) {
        logger.warn('No galleries found:', gErr);
        setGalleries([]);
      }

      // 4. Check follow status if logged in
      if (user?.id && user.id !== profile.id) {
        try {
          const followRes = await apiClient.get(`/users/${user.id}/following`);
          const followingList = followRes.data?.following || [];
          setIsFollowing(followingList.some(f => f.id === profile.id));
        } catch (fErr) {
          logger.warn('Could not check follow status:', fErr);
        }
      }
    } catch (err) {
      logger.error('Failed to load storefront:', err);
      if (err.response?.status === 404) {
        setError('notfound');
      } else {
        setError('generic');
      }
    } finally {
      setLoading(false);
    }
  }, [username, user?.id]);

  useEffect(() => { fetchStorefront(); }, [fetchStorefront]);

  const handleFollow = async () => {
    if (!user?.id) { navigate('/auth?tab=signup'); return; }
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await apiClient.delete(`/social/unfollow/${photographer.id}?follower_id=${user.id}`);
        setIsFollowing(false);
        toast.success('Unfollowed');
      } else {
        await apiClient.post(`/social/follow/${photographer.id}?follower_id=${user.id}`);
        setIsFollowing(true);
        toast.success(`Following ${photographer.full_name}`);
      }
    } catch (err) {
      toast.error('Failed to update follow');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/gallery/${username}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${photographer?.full_name} — Raw Surf`, url });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied!');
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-3" />
          <p className={textSecondary}>Loading portfolio...</p>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (error === 'notfound') {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <div className="text-center max-w-md px-4">
          <Camera className="w-16 h-16 text-zinc-600 mx-auto mb-4" />
          <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>Photographer Not Found</h2>
          <p className={`${textSecondary} mb-6`}>
            No photographer with username <span className="text-cyan-400 font-mono">@{username}</span> exists.
          </p>
          <Button onClick={() => navigate('/explore')} className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white">
            Browse Photographers
          </Button>
        </div>
      </div>
    );
  }

  if (error || !photographer) {
    return (
      <div className={`min-h-screen ${pageBg} flex items-center justify-center`}>
        <div className="text-center">
          <p className={textSecondary}>Something went wrong. Please try again.</p>
          <Button onClick={fetchStorefront} variant="outline" className="mt-4">Retry</Button>
        </div>
      </div>
    );
  }

  const isSelf = user?.id === photographer.id;

  return (
    <div className={`min-h-screen ${pageBg} pb-24 md:pb-8`}>
      {/* ── Hero Banner ── */}
      <div className="relative">
        <div className="h-40 md:h-52 bg-gradient-to-br from-cyan-900/60 via-zinc-900 to-emerald-900/40 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-emerald-500/10" />
          {/* Animated wave decoration */}
          <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 40L60 35C120 30 240 20 360 25C480 30 600 50 720 55C840 60 960 50 1080 40C1200 30 1320 20 1380 15L1440 10V80H1380C1320 80 1200 80 1080 80C960 80 840 80 720 80C600 80 480 80 360 80C240 80 120 80 60 80H0V40Z" 
              fill={isLight ? '#f9fafb' : '#000000'} fillOpacity="0.95"/>
          </svg>
        </div>

        {/* Back button */}
        <Button 
          variant="ghost" 
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 text-white/70 hover:text-white hover:bg-white/10 backdrop-blur-sm"
        >
          <ArrowLeft className="w-5 h-5 mr-1" /> Back
        </Button>

        {/* Share button */}
        <Button
          variant="ghost"
          onClick={handleShare}
          className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10 backdrop-blur-sm"
        >
          <Share2 className="w-5 h-5" />
        </Button>
      </div>

      {/* ── Profile Card ── */}
      <div className="max-w-4xl mx-auto px-4 -mt-16 relative z-10">
        <div className={`${cardBg} rounded-2xl border ${borderColor} p-6 shadow-xl`}>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-5">
            {/* Avatar */}
            <Avatar className="w-24 h-24 border-4 border-cyan-500/30 shadow-lg shadow-cyan-500/10">
              <AvatarImage src={getFullUrl(photographer.avatar_url)} />
              <AvatarFallback className="bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 text-cyan-400 text-2xl">
                {photographer.full_name?.[0] || '?'}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className={`text-2xl font-bold ${textPrimary}`}>{photographer.full_name}</h1>
                {photographer.is_verified && (
                  <CheckCircle className="w-5 h-5 text-cyan-400 fill-cyan-400/20" />
                )}
                {photographer.is_approved_pro && (
                  <Badge className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-0 text-xs">
                    <ShieldCheck className="w-3 h-3 mr-1" /> Verified Pro
                  </Badge>
                )}
                {stats?.is_shooting && (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse text-xs">
                    <Play className="w-3 h-3 mr-1 fill-red-400" /> LIVE NOW
                  </Badge>
                )}
              </div>
              <p className={`${textSecondary} text-sm mb-2`}>@{photographer.username || username}</p>
              {photographer.bio && (
                <p className={`${textPrimary} text-sm leading-relaxed max-w-xl`}>{photographer.bio}</p>
              )}
              {/* Social links */}
              <div className="flex items-center gap-3 mt-3">
                {photographer.location && (
                  <span className={`flex items-center gap-1 text-xs ${textSecondary}`}>
                    <MapPin className="w-3 h-3" /> {photographer.location}
                  </span>
                )}
                {photographer.instagram_url && (
                  <a href={photographer.instagram_url} target="_blank" rel="noopener noreferrer"
                    className="text-pink-400 hover:text-pink-300 transition-colors">
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {photographer.website_url && (
                  <a href={photographer.website_url} target="_blank" rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors">
                    <Globe className="w-4 h-4" />
                  </a>
                )}
                {photographer.portfolio_url && (
                  <a href={photographer.portfolio_url} target="_blank" rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 transition-colors">
                    <Briefcase className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3 md:mt-0">
              {!isSelf && (
                <>
                  <Button
                    onClick={handleFollow}
                    disabled={followLoading}
                    className={isFollowing
                      ? `${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'} border ${borderColor}`
                      : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600'}
                  >
                    {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> :
                      isFollowing ? 'Following' : 'Follow'}
                  </Button>
                  <Button
                    onClick={() => navigate(`/messages/new/${photographer.id}`)}
                    variant="outline"
                    className={`${borderColor} ${textPrimary}`}
                  >
                    <MessageCircle className="w-4 h-4" />
                  </Button>
                </>
              )}
              {isSelf && (
                <Button onClick={() => navigate('/settings')} variant="outline" className={`${borderColor} ${textSecondary}`}>
                  Edit Profile
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      {stats && (
        <div className="max-w-4xl mx-auto px-4 mt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Galleries', value: stats.gallery_count, icon: ImageIcon, color: 'text-cyan-400' },
              { label: 'Photos', value: stats.photo_count, icon: Camera, color: 'text-emerald-400' },
              { label: 'Followers', value: stats.follower_count, icon: Users, color: 'text-blue-400' },
              { label: 'Sessions', value: stats.session_count, icon: Calendar, color: 'text-yellow-400' },
              { label: 'Rating', value: stats.avg_rating > 0 ? `${stats.avg_rating} ★` : '—', icon: Star, color: 'text-amber-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className={`${cardBg} ${borderColor}`}>
                <CardContent className="p-3 text-center">
                  <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
                  <div className={`text-lg font-bold ${textPrimary}`}>{value}</div>
                  <div className={`text-xs ${textSecondary}`}>{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Availability Banner ── */}
      {(stats?.is_shooting || stats?.on_demand_active) && (
        <div className="max-w-4xl mx-auto px-4 mt-6">
          <Card className={`${stats.is_shooting ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/40 bg-emerald-500/5'} border-2`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${stats.is_shooting ? 'bg-red-500' : 'bg-emerald-500'} animate-pulse`} />
                <div>
                  <p className={`font-semibold ${textPrimary}`}>
                    {stats.is_shooting ? '🔴 Currently Shooting Live' : '🟢 Available for On-Demand'}
                  </p>
                  <p className={`text-xs ${textSecondary}`}>
                    {stats.is_shooting ? 'Join the session now!' : 'Request a session at your spot'}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => navigate(`/profile/${photographer.id}`)}
                className={stats.is_shooting
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'}
                size="sm"
              >
                {stats.is_shooting ? 'Join' : 'Book'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Galleries Grid ── */}
      <div className="max-w-4xl mx-auto px-4 mt-8">
        <h2 className={`text-lg font-bold ${textPrimary} mb-4 flex items-center gap-2`}>
          <ImageIcon className="w-5 h-5 text-cyan-400" />
          Galleries
          {galleries.length > 0 && (
            <Badge variant="outline" className={`${borderColor} ${textSecondary} ml-2`}>
              {galleries.length}
            </Badge>
          )}
        </h2>

        {galleries.length === 0 ? (
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-12 text-center">
              <Camera className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-gray-300' : 'text-zinc-700'}`} />
              <p className={`${textSecondary} mb-1`}>No galleries yet</p>
              <p className={`text-xs ${textSecondary}`}>
                Galleries are created automatically when {photographer.full_name} completes a session.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {galleries.map((gallery) => (
              <Card
                key={gallery.id}
                className={`${cardBg} ${borderColor} overflow-hidden hover:border-cyan-500/50 transition-all cursor-pointer group`}
                onClick={() => navigate(`/photographer/galleries/${gallery.id}`)}
              >
                {/* Cover image */}
                <div className="aspect-[4/3] bg-zinc-800 relative overflow-hidden">
                  {gallery.cover_image_url ? (
                    <img
                      src={getFullUrl(gallery.cover_image_url)}
                      alt={gallery.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-10 h-10 text-zinc-700" />
                    </div>
                  )}
                  {/* Photo count badge */}
                  <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full">
                    <span className="text-xs text-white flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {gallery.photo_count || 0}
                    </span>
                  </div>
                  {/* Date badge */}
                  <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full">
                    <span className="text-xs text-white">
                      {gallery.session_date ? new Date(gallery.session_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </div>
                </div>
                <CardContent className="p-3">
                  <h3 className={`font-semibold text-sm ${textPrimary} truncate`}>{gallery.title || 'Session Gallery'}</h3>
                  {gallery.spot_name && (
                    <p className={`text-xs ${textSecondary} flex items-center gap-1 mt-1`}>
                      <MapPin className="w-3 h-3" /> {gallery.spot_name}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── CTA Footer ── */}
      {!isSelf && (
        <div className="max-w-4xl mx-auto px-4 mt-12">
          <Card className={`bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border-cyan-500/20`}>
            <CardContent className="p-6 text-center">
              <h3 className={`text-lg font-bold ${textPrimary} mb-2`}>
                Want {photographer.full_name} to shoot your session?
              </h3>
              <p className={`${textSecondary} text-sm mb-4`}>
                Book a live session, request on-demand, or schedule a private shoot.
              </p>
              <div className="flex justify-center gap-3">
                <Button
                  onClick={() => navigate(`/profile/${photographer.id}`)}
                  className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-600 hover:to-emerald-600"
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Book Session
                </Button>
                <Button
                  onClick={handleShare}
                  variant="outline"
                  className={`${borderColor} ${textPrimary}`}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Portfolio
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default GalleryStorefront;
