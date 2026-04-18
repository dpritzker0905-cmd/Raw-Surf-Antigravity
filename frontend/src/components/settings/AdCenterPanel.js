/**
 * AdCenterPanel - User's Ad Management Hub in Settings
 * - Create new ads
 * - View ad activity (submissions with status)
 * - View ad analytics (impressions, clicks, CTR)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { 
  Megaphone, Plus, Activity, BarChart2, 
  Loader2, CheckCircle, Clock, XCircle, Eye, MousePointer, TrendingUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CreateAdModal } from '../CreateAdModal';
import logger from '../../utils/logger';


export const AdCenterPanel = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const _navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [myAds, setMyAds] = useState({ ads: [], counts: {} });
  const [analytics, setAnalytics] = useState(null);
  const [showCreateAdModal, setShowCreateAdModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'activity', 'analytics'
  
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const bgSecondary = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';

  useEffect(() => {
    if (user?.id) {
      fetchAdData();
    }
  }, [user?.id]);

  const fetchAdData = async () => {
    setLoading(true);
    try {
      // Fetch user's ads
      const adsRes = await apiClient.get(`/ads/my-submissions?user_id=${user.id}`);
      setMyAds(adsRes.data);
      
      // Fetch analytics
      try {
        const analyticsRes = await apiClient.get(`/ads/my-analytics?user_id=${user.id}`);
        setAnalytics(analyticsRes.data);
      } catch (e) {
        setAnalytics(null);
      }
    } catch (error) {
      logger.error('Failed to fetch ad data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-400"><CheckCircle className="w-3 h-3 mr-1" /> Active</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge className="bg-zinc-500/20 text-zinc-400">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab Buttons */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'overview', label: 'Overview', icon: Megaphone },
          { id: 'activity', label: 'Activity', icon: Activity },
          { id: 'analytics', label: 'Analytics', icon: BarChart2 },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-purple-500/20 text-purple-400'
                  : `${bgSecondary} ${textSecondary} hover:text-purple-400`
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Create Ad Button */}
          <Button
            onClick={() => setShowCreateAdModal(true)}
            className="w-full bg-purple-600 hover:bg-purple-700 h-12"
            data-testid="create-ad-btn"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create New Ad
          </Button>

          {/* Ad Stats Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className={`${bgSecondary} rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold ${textPrimary}`}>{myAds.counts?.pending || 0}</p>
              <p className={`text-xs ${textSecondary}`}>Pending</p>
            </div>
            <div className={`${bgSecondary} rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold text-green-400`}>{myAds.counts?.approved || 0}</p>
              <p className={`text-xs ${textSecondary}`}>Active</p>
            </div>
            <div className={`${bgSecondary} rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold text-red-400`}>{myAds.counts?.rejected || 0}</p>
              <p className={`text-xs ${textSecondary}`}>Rejected</p>
            </div>
          </div>

          {/* Quick Analytics */}
          {analytics && (
            <div className={`${bgSecondary} rounded-xl p-4`}>
              <h3 className={`font-medium ${textPrimary} mb-3 flex items-center gap-2`}>
                <TrendingUp className="w-4 h-4 text-purple-400" />
                Performance Overview
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Eye className="w-4 h-4 text-blue-400" />
                    <span className={`text-lg font-bold ${textPrimary}`}>
                      {analytics.total_impressions?.toLocaleString() || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>Impressions</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <MousePointer className="w-4 h-4 text-green-400" />
                    <span className={`text-lg font-bold ${textPrimary}`}>
                      {analytics.total_clicks?.toLocaleString() || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>Clicks</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <TrendingUp className="w-4 h-4 text-purple-400" />
                    <span className={`text-lg font-bold ${textPrimary}`}>
                      {analytics.ctr?.toFixed(2) || 0}%
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>CTR</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && (
        <div className="space-y-3">
          {myAds.ads?.length === 0 ? (
            <div className={`text-center py-8 ${textSecondary}`}>
              <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No ads yet</p>
              <p className="text-sm">Create your first ad to get started</p>
            </div>
          ) : (
            myAds.ads.map((ad) => (
              <div 
                key={ad.id} 
                className={`${bgSecondary} rounded-xl p-4 border ${borderClass}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className={`font-medium ${textPrimary}`}>{ad.headline}</h4>
                    <p className={`text-sm ${textSecondary} line-clamp-1`}>{ad.description}</p>
                  </div>
                  {getStatusBadge(ad.approval_status)}
                </div>
                <div className={`flex items-center gap-4 text-xs ${textSecondary}`}>
                  <span>Budget: ${ad.budget_credits || 0}</span>
                  <span>Impressions: {ad.impressions || 0}</span>
                  <span>Clicks: {ad.clicks || 0}</span>
                </div>
                {ad.rejection_reason && (
                  <p className="text-xs text-red-400 mt-2">
                    Reason: {ad.rejection_reason}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-4">
          {analytics ? (
            <>
              {/* Overall Stats */}
              <div className={`${bgSecondary} rounded-xl p-4`}>
                <h3 className={`font-medium ${textPrimary} mb-4`}>Overall Performance</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="w-5 h-5 text-blue-400" />
                      <span className={textSecondary}>Total Impressions</span>
                    </div>
                    <span className={`font-bold ${textPrimary}`}>
                      {analytics.total_impressions?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MousePointer className="w-5 h-5 text-green-400" />
                      <span className={textSecondary}>Total Clicks</span>
                    </div>
                    <span className={`font-bold ${textPrimary}`}>
                      {analytics.total_clicks?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-purple-400" />
                      <span className={textSecondary}>Click-Through Rate</span>
                    </div>
                    <span className={`font-bold ${textPrimary}`}>
                      {analytics.ctr?.toFixed(2) || 0}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Megaphone className="w-5 h-5 text-yellow-400" />
                      <span className={textSecondary}>Total Spent</span>
                    </div>
                    <span className={`font-bold ${textPrimary}`}>
                      ${analytics.total_spent?.toFixed(2) || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Per-Ad Performance */}
              {analytics.per_ad_stats?.length > 0 && (
                <div>
                  <h3 className={`font-medium ${textPrimary} mb-3`}>Per-Ad Performance</h3>
                  <div className="space-y-3">
                    {analytics.per_ad_stats.map((stat) => (
                      <div 
                        key={stat.id}
                        className={`${bgSecondary} rounded-lg p-3`}
                      >
                        <p className={`font-medium ${textPrimary} text-sm mb-2`}>{stat.headline}</p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className={textSecondary}>Views: </span>
                            <span className={textPrimary}>{stat.impressions || 0}</span>
                          </div>
                          <div>
                            <span className={textSecondary}>Clicks: </span>
                            <span className={textPrimary}>{stat.clicks || 0}</span>
                          </div>
                          <div>
                            <span className={textSecondary}>CTR: </span>
                            <span className={textPrimary}>{stat.ctr?.toFixed(2) || 0}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={`text-center py-8 ${textSecondary}`}>
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No analytics data yet</p>
              <p className="text-sm">Create and run ads to see performance metrics</p>
            </div>
          )}
        </div>
      )}

      {/* Create Ad Modal */}
      <CreateAdModal
        isOpen={showCreateAdModal}
        onClose={() => setShowCreateAdModal(false)}
        onSuccess={() => {
          setShowCreateAdModal(false);
          fetchAdData();
        }}
      />
    </div>
  );
};

export default AdCenterPanel;
