/**
 * AnalyticsTabContent.js
 * Extracted from AdminTabPanels.js (v43)
 * Platform Mission Control -- financial, ecosystem, and price impact analytics
 */
import React, { useState, useEffect } from 'react';
import {
  TrendingUp, Loader2, BarChart3, DollarSign
} from 'lucide-react';
// Icons used in JSX but were missing from original AdminTabPanels imports
import { RefreshCw, Wallet, AlertCircle, PieChart, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import apiClient from '../../../lib/apiClient';
import logger from '../../../utils/logger';
import { toast } from 'sonner';

const AnalyticsTabContent = ({ user, cardBgClass, textClass, textSecondary }) => {
  const [financial, setFinancial] = useState(null);
  const [ecosystem, setEcosystem] = useState(null);
  const [priceImpact, setPriceImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, [user?.id]);

  const fetchAnalytics = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [financialRes, ecosystemRes, priceRes] = await Promise.all([
        apiClient.get(`/admin/analytics/financial?days=30`).catch(() => ({ data: null })),
        apiClient.get(`/admin/analytics/ecosystem`).catch(() => ({ data: null })),
        apiClient.get(`/admin/analytics/price-impact?days=90`).catch(() => ({ data: null }))
      ]);
      setFinancial(financialRes.data);
      setEcosystem(ecosystemRes.data);
      setPriceImpact(priceRes.data);
    } catch (error) {
      logger.error('Analytics fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCache = async () => {
    setRefreshing(true);
    try {
      await apiClient.post(`/admin/analytics/refresh-cache`);
      toast.success('Metrics cache refreshed');
      fetchAnalytics();
    } catch (error) {
      toast.error('Failed to refresh cache');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <span className="ml-3 text-muted-foreground">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-bold ${textClass} flex items-center gap-2`}>
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Platform Mission Control
        </h2>
        <Button aria-label="Refresh analytics"
          size="sm" variant="outline"
          onClick={handleRefreshCache} disabled={refreshing}
          className="border-border"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </div>

      {/* Financial Oversight */}
      <Card className={`${cardBgClass} border-green-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <Wallet className="w-4 h-4 text-green-500" />
            Financial Oversight (Sitewide)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Total Credit Liability */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-red-400" />
                  Total Stoked Credits Liability
                </p>
                <p className="text-3xl font-bold text-red-400">
                  ${financial?.total_credit_liability?.toLocaleString() || '0'}
                </p>
                <p className="text-xs text-gray-500 mt-1">Sum of all credits in user wallets</p>
              </div>
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <DollarSign className="w-8 h-8 text-red-400" />
              </div>
            </div>
          </div>

          {/* Credit Distribution */}
          {financial?.credit_distribution && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Credit Distribution</p>
              <div className="grid grid-cols-5 gap-1">
                {Object.entries(financial.credit_distribution).map(([range, count]) => (
                  <div key={range} className="bg-muted rounded p-2 text-center">
                    <p className="text-foreground font-bold text-sm">{count}</p>
                    <p className="text-gray-500 text-[10px]">${range}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revenue Metrics */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-xs">30-Day Revenue</p>
              <p className="text-green-400 font-bold text-lg">
                ${financial?.total_revenue_period?.toLocaleString() || '0'}
              </p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-xs">Ad Revenue</p>
              <p className="text-purple-400 font-bold text-lg">
                ${financial?.ad_revenue?.toLocaleString() || '0'}
              </p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <p className="text-muted-foreground text-xs">Subscription</p>
              <p className="text-cyan-400 font-bold text-lg">
                ${financial?.revenue_by_type?.subscription?.toLocaleString() || '0'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ecosystem Health */}
      <Card className={`${cardBgClass} border-cyan-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <PieChart className="w-4 h-4 text-cyan-500" />
            Ecosystem Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ecosystem?.role_categories && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>User Categories</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(ecosystem.role_categories).map(([category, data]) => (
                  <div key={category} className="bg-muted rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-muted-foreground text-xs capitalize">{category.replace('_', ' ')}</p>
                      <span className="text-cyan-400 text-xs">{data.percentage}%</span>
                    </div>
                    <p className="text-foreground font-bold">{data.count}</p>
                    <div className="w-full h-1 bg-input rounded mt-1">
                      <div className="h-1 bg-cyan-500 rounded" style={{ width: `${data.percentage}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ecosystem?.booking_efficiency && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Booking Efficiency</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/30 rounded-lg p-3">
                  <p className="text-orange-400 text-xs">On-Demand</p>
                  <p className="text-foreground font-bold text-xl">{ecosystem.booking_efficiency.on_demand?.count || 0}</p>
                  <p className="text-orange-400 text-xs">{ecosystem.booking_efficiency.on_demand?.percentage || 0}%</p>
                </div>
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-400 text-xs">Scheduled</p>
                  <p className="text-foreground font-bold text-xl">{ecosystem.booking_efficiency.scheduled?.count || 0}</p>
                  <p className="text-blue-400 text-xs">{ecosystem.booking_efficiency.scheduled?.percentage || 0}%</p>
                </div>
              </div>
            </div>
          )}

          {ecosystem?.spot_heatmap && ecosystem.spot_heatmap.length > 0 && (
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Top Spots by Bookings</p>
              <div className="space-y-1">
                {ecosystem.spot_heatmap.slice(0, 5).map((spot, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted rounded p-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-cyan-400" />
                      <span className="text-foreground text-sm truncate max-w-[150px]">{spot.location}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">{spot.bookings} bookings</Badge>
                      <span className="text-green-400 text-xs">${spot.revenue?.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Impact Tracking */}
      <Card className={`${cardBgClass} border-yellow-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
            <BarChart3 className="w-4 h-4 text-yellow-500" />
            Price Impact Markers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {priceImpact?.price_change_markers && priceImpact.price_change_markers.length > 0 ? (
            <div className="space-y-2">
              <p className={`text-xs ${textSecondary}`}>
                Recent pricing changes - correlate with signup trends
              </p>
              {priceImpact.price_change_markers.slice(0, 5).map((marker, i) => (
                <div key={i} className="flex items-center justify-between bg-muted rounded p-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full" />
                    <span className="text-foreground text-sm">{marker.action}</span>
                  </div>
                  <span className="text-gray-500 text-xs">
                    {marker.date ? new Date(marker.date).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className={`text-sm ${textSecondary}`}>
                No pricing changes recorded yet. Changes made in God Mode Pricing will appear here.
              </p>
            </div>
          )}

          {priceImpact?.signup_trend && priceImpact.signup_trend.length > 0 && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-2">Signup Trend (Last 90 Days)</p>
              <div className="flex items-end gap-0.5 h-12">
                {priceImpact.signup_trend.slice(-30).map((day, i) => (
                  <div key={i} className="flex-1 bg-cyan-500 rounded-t"
                    style={{ height: `${Math.min(100, (day.signups || 0) * 20)}%`, minHeight: '2px' }}
                    title={`${day.date}: ${day.signups} signups`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1 text-center">Last 30 days</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export { AnalyticsTabContent };
export default AnalyticsTabContent;
