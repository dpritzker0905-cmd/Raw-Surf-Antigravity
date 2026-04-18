import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Shield, Lock, Copy, CheckCircle, Loader2, Heart, MessageCircle,
  ShieldAlert, Clock, Users, Camera
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import axios from 'axios';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * GromLimitedFeed - Shows a limited preview feed for unlinked Groms
 * Displays up to 3 posts from other Groms only, with a CTA to complete parent linking
 */
const GromLimitedFeed = ({ gromStatus, _onCopyCode }) => {
  const { _user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);

  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  useEffect(() => {
    fetchGromPosts();
  }, []);

  const fetchGromPosts = async () => {
    try {
      // Fetch posts from other Groms only, limited to 3
      const response = await axios.get(`${API}/posts/grom-preview?limit=3`);
      setPosts(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch grom posts:', error);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const copyGuardianCode = () => {
    if (gromStatus?.guardian_code) {
      navigator.clipboard.writeText(gromStatus.guardian_code);
      setCodeCopied(true);
      toast.success('Guardian code copied!');
      setTimeout(() => setCodeCopied(false), 3000);
    }
  };

  return (
    <div className={`min-h-screen ${isLight ? 'bg-gray-50' : 'bg-black'} pb-24`}>
      {/* Safety Banner */}
      <div className="sticky top-0 z-40 bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">Parent Link Required</p>
            <p className="text-cyan-100 text-xs">Complete setup to unlock all features</p>
          </div>
          <Badge className="bg-white/20 text-white border-0 text-xs">
            LIMITED
          </Badge>
        </div>
      </div>

      {/* Guardian Code Card */}
      <div className="px-4 py-4">
        <Card className={`${cardBg} ${borderColor} border`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Clock className="w-5 h-5 text-yellow-500" />
              <div>
                <p className={`font-semibold text-sm ${textPrimary}`}>
                  {gromStatus?.is_linked ? "Pending Parent Approval" : "Share Your Code"}
                </p>
                <p className={`text-xs ${textSecondary}`}>
                  {gromStatus?.is_linked 
                    ? "Waiting for your parent to approve" 
                    : "Give this code to your parent"}
                </p>
              </div>
            </div>
            
            {gromStatus?.guardian_code && (
              <div className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800'} rounded-xl p-3 flex items-center justify-between`}>
                <div className="text-2xl font-mono font-bold text-cyan-500 tracking-wider">
                  {gromStatus.guardian_code}
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  className="border-cyan-500/50 text-cyan-500"
                  onClick={copyGuardianCode}
                >
                  {codeCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Limited Feed Header */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-500" />
          <h2 className={`font-semibold ${textPrimary}`}>Grom Community Preview</h2>
          <Badge className="bg-cyan-500/20 text-cyan-500 border-0 text-xs ml-auto">
            3 POSTS
          </Badge>
        </div>
        <p className={`text-xs ${textSecondary} mt-1`}>
          Connect with your parent to see the full feed and post your own sessions
        </p>
      </div>

      {/* Limited Posts */}
      <div className="px-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
          </div>
        ) : posts.length > 0 ? (
          <>
            {posts.map((post) => (
              <Card key={post.id} className={`${cardBg} ${borderColor} border overflow-hidden`}>
                <CardContent className="p-0">
                  {/* Post Header */}
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                      {post.author_avatar ? (
                        <img src={post.author_avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <span className="text-white font-bold text-sm">
                          {post.author_name?.charAt(0) || 'G'}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-semibold text-sm ${textPrimary}`}>{post.author_name || 'Grom'}</p>
                      <p className={`text-xs ${textSecondary}`}>
                        {post.spot_name || 'Surfing'}
                      </p>
                    </div>
                    <Badge className="bg-cyan-500/20 text-cyan-500 border-0 text-xs">
                      GROM
                    </Badge>
                  </div>
                  
                  {/* Post Media */}
                  {post.media_url && (
                    <div className="relative aspect-square bg-zinc-800">
                      <img 
                        src={post.media_url} 
                        alt="" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  {/* Post Actions (Disabled) */}
                  <div className="p-3 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 opacity-50">
                      <Heart className="w-5 h-5" />
                      <span className={`text-sm ${textSecondary}`}>{post.likes_count || 0}</span>
                    </div>
                    <div className="flex items-center gap-1.5 opacity-50">
                      <MessageCircle className="w-5 h-5" />
                      <span className={`text-sm ${textSecondary}`}>{post.comments_count || 0}</span>
                    </div>
                  </div>
                  
                  {/* Caption */}
                  {post.caption && (
                    <div className="px-3 pb-3">
                      <p className={`text-sm ${textPrimary}`}>
                        <span className="font-semibold">{post.author_name}</span>{' '}
                        {post.caption.length > 100 ? `${post.caption.slice(0, 100)}...` : post.caption}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            
            {/* Unlock More CTA */}
            <Card className={`${cardBg} border-2 border-dashed ${isLight ? 'border-cyan-300' : 'border-cyan-500/50'}`}>
              <CardContent className="p-6 text-center">
                <Lock className="w-12 h-12 text-cyan-500 mx-auto mb-3 opacity-60" />
                <p className={`font-semibold ${textPrimary} mb-1`}>Want to see more?</p>
                <p className={`text-sm ${textSecondary} mb-4`}>
                  Complete parent linking to unlock the full feed, post your own sessions, and connect with the community
                </p>
                <div className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800'} rounded-lg p-3`}>
                  <p className={`text-xs ${textSecondary} mb-2`}>Your Guardian Code:</p>
                  <p className="text-xl font-mono font-bold text-cyan-500">{gromStatus?.guardian_code}</p>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className={`${cardBg} ${borderColor} border`}>
            <CardContent className="p-8 text-center">
              <Camera className="w-12 h-12 text-cyan-500 mx-auto mb-3 opacity-60" />
              <p className={`font-semibold ${textPrimary} mb-1`}>No Grom Posts Yet</p>
              <p className={`text-sm ${textSecondary}`}>
                Be the first! Complete parent linking and share your surf sessions
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Locked Features Reminder */}
      <div className="px-4 py-6">
        <Card className={`${isLight ? 'bg-red-50' : 'bg-red-500/10'} border ${isLight ? 'border-red-200' : 'border-red-500/30'}`}>
          <CardContent className="p-4">
            <p className={`text-sm font-medium ${isLight ? 'text-red-800' : 'text-red-400'} mb-3 flex items-center gap-2`}>
              <ShieldAlert className="w-4 h-4" />
              Features locked until parent approval:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {['Full Feed', 'Go Live', 'Messages', 'Post Content'].map((feature) => (
                <div 
                  key={feature}
                  className={`flex items-center gap-2 p-2 ${isLight ? 'bg-red-100' : 'bg-red-500/20'} rounded-lg`}
                >
                  <Lock className={`w-4 h-4 ${isLight ? 'text-red-600' : 'text-red-400'}`} />
                  <span className={`text-xs ${isLight ? 'text-red-700' : 'text-red-300'}`}>{feature}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GromLimitedFeed;
