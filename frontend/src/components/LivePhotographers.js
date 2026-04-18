import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


/**
 * LivePhotographers - Shows users who are SOCIALLY LIVE (broadcasting to followers)
 * This is Instagram Live style - NOT photographers who are actively shooting at spots.
 * The red gradient ring indicates social broadcasting.
 */
export const LivePhotographers = () => {
  const [liveUsers, setLiveUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSocialLiveUsers();
  }, []);

  const fetchSocialLiveUsers = async () => {
    try {
      // Fetch users who are SOCIALLY live (is_live=true), NOT just shooting (is_shooting)
      const response = await apiClient.get(`/profiles?is_live=true`);
      // Filter to ensure only is_live users (not is_shooting)
      const socialLiveUsers = (response.data || []).filter(u => u.is_live === true);
      setLiveUsers(socialLiveUsers);
    } catch (error) {
      logger.error('Failed to fetch live users:', error);
      setLiveUsers([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex gap-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2 animate-pulse">
            <div className="w-16 h-16 rounded-full bg-zinc-700" />
            <div className="w-12 h-3 bg-zinc-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Don't show section if no one is socially live
  if (liveUsers.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3">
      <p className="text-xs text-gray-500 mb-2">Broadcasting Now</p>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {liveUsers.map((user) => (
          <div 
            key={user.id} 
            onClick={() => navigate(`/profile/${user.id}`)}
            className="flex flex-col items-center cursor-pointer flex-shrink-0"
          >
            {/* Avatar with Instagram-style gradient ring for SOCIAL LIVE */}
            <div className="relative">
              <div 
                className="w-14 h-14 rounded-full p-[2px]"
                style={{
                  background: 'linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%)'
                }}
              >
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden p-[2px]">
                  {user.avatar_url ? (
                    <img 
                      src={user.avatar_url} 
                      alt={user.full_name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full bg-zinc-700 flex items-center justify-center">
                      <span className="text-lg text-gray-400">
                        {user.full_name?.charAt(0) || '?'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {/* Live badge */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-red-500 rounded text-[9px] text-white font-bold">
                LIVE
              </div>
            </div>
            
            {/* Name - no Message button */}
            <span className="text-xs text-gray-300 mt-2 truncate max-w-[60px]">
              {user.full_name?.split(' ')[0] || 'User'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
