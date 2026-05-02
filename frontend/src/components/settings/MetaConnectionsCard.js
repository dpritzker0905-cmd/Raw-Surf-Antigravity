import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Link2, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';

/**
 * Meta Connections Card - Connect Facebook/Instagram for direct posting
 */
export const MetaConnectionsCard = ({ userId, textPrimaryClass, textSecondaryClass, borderClass, cardBgClass }) => {
  const [searchParams] = useSearchParams();
  const [metaStatus, setMetaStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => { if (userId) fetchMetaStatus(); }, [userId]);
  useEffect(() => { const code = searchParams.get('code'); const state = searchParams.get('state'); if (code && state) handleOAuthCallback(code, state); }, [searchParams]);

  const fetchMetaStatus = async () => { try { const r = await apiClient.get(`/meta/status`); setMetaStatus(r.data); } catch (err) { setMetaStatus(null); } finally { setLoading(false); } };

  const handleOAuthCallback = async (code, state) => {
    setConnecting(true);
    try {
      const response = await apiClient.get(`/meta/callback`, { params: { code, state, redirect_uri: `${window.location.origin}/settings` } });
      if (response.data.success) { toast.success('Meta accounts connected successfully!'); fetchMetaStatus(); window.history.replaceState({}, '', '/settings'); }
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to connect Meta accounts'); } finally { setConnecting(false); }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const response = await apiClient.get(`/meta/oauth-url`, { params: { user_id: userId, redirect_uri: `${window.location.origin}/settings` } });
      window.location.href = response.data.oauth_url;
    } catch (err) { toast.error('Failed to start Meta connection'); setConnecting(false); }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try { await apiClient.delete(`/meta/disconnect`); setMetaStatus(null); toast.success('Meta accounts disconnected'); } catch (err) { toast.error('Failed to disconnect'); } finally { setDisconnecting(false); }
  };

  const isConnected = metaStatus?.facebook_connected || metaStatus?.instagram_connected;

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="meta-connections-card">
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Link2 className="w-5 h-5 text-blue-400" />
          Social Connections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>
        ) : isConnected ? (
          <>
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-pink-500/10 border border-blue-500/30">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${textPrimaryClass}`}>Meta Accounts</span>
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">Connected</span>
              </div>
              {metaStatus.facebook_connected && (<div className={`flex items-center gap-2 py-1.5 ${textSecondaryClass} text-sm`}><span className="text-blue-500 text-lg">f</span><span>Facebook Page: {metaStatus.facebook_name || 'Connected'}</span></div>)}
              {metaStatus.instagram_connected && (<div className={`flex items-center gap-2 py-1.5 ${textSecondaryClass} text-sm`}><span className="text-pink-500 text-lg">📸</span><span>Instagram: @{metaStatus.instagram_username || 'Connected'}</span></div>)}
            </div>
            <p className={`text-xs ${textSecondaryClass}`}>You can now share surf sessions directly to your Facebook Page and Instagram feed from any post's share menu.</p>
            <Button onClick={handleDisconnect} disabled={disconnecting} variant="outline" className={`w-full ${borderClass} text-red-400 hover:bg-red-500/10`} data-testid="disconnect-meta-btn">
              {disconnecting ? (<Loader2 className="w-4 h-4 animate-spin mr-2" />) : null}Disconnect Meta Accounts
            </Button>
          </>
        ) : (
          <>
            <div className="text-center py-4">
              <div className="flex items-center justify-center gap-4 mb-3"><span className="text-3xl text-blue-500">f</span><span className={`text-lg ${textSecondaryClass}`}>+</span><span className="text-3xl">📸</span></div>
              <p className={`text-sm ${textPrimaryClass} font-medium mb-1`}>Connect Facebook & Instagram</p>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>Share your surf sessions directly to your social feeds</p>
            </div>
            <Button onClick={handleConnect} disabled={connecting} className="w-full bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-foreground" data-testid="connect-meta-btn">
              {connecting ? (<><Loader2 className="w-4 h-4 animate-spin mr-2" />Connecting...</>) : (<><ExternalLink className="w-4 h-4 mr-2" />Connect with Meta</>)}
            </Button>
            <p className={`text-xs ${textSecondaryClass} text-center`}>Requires a Facebook Page and/or Instagram Business account</p>
          </>
        )}
      </CardContent>
    </Card>
  );
};
