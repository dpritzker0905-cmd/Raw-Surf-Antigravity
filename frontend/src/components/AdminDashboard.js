import React, { useState, useEffect } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { usePersona } from '../contexts/PersonaContext';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import { Shield, Users, Image, FileText, DollarSign, Search, Ban, CheckCircle, Loader2, Eye, UserX, UserCheck, Crown, Trophy, MapPin, AlertTriangle, Lock, Settings } from 'lucide-react';

import { Button } from './ui/button';

import { Input } from './ui/input';

import { Badge } from './ui/badge';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

import { Textarea } from './ui/textarea';

import { toast } from 'sonner';

import PersonaSwitcher from './PersonaSwitcher';

import { AdminCompetitionVerification } from './AdminCompetitionVerification';

import { AdminPricingEditor } from './admin/AdminPricingEditor';

import { AdminSpotEditor } from './admin/AdminSpotEditor';

import { AdminPrecisionQueue } from './admin/AdminPrecisionQueue';

import logger from '../utils/logger';

const getFullUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url;
  return `\\`;
};



export const AdminDashboard = () => {
  const { user } = useAuth();
  const { enableGodMode, isGodMode } = usePersona();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [userToSuspend, setUserToSuspend] = useState(null);
  const [siteSettings, setSiteSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Enable God Mode when admin accesses this page
  useEffect(() => {
    if (user?.is_admin && !isGodMode) {
      enableGodMode();
    }
  }, [user?.is_admin, isGodMode, enableGodMode]);

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user?.id]);

  const fetchData = async () => {
    try {
      const [statsRes, usersRes, logsRes, settingsRes] = await Promise.all([
        apiClient.get(`/admin/stats?admin_id=${user.id}`),
        apiClient.get(`/admin/users?admin_id=${user.id}&limit=50`),
        apiClient.get(`/admin/logs?admin_id=${user.id}&limit=50`),
        apiClient.get(`/admin/platform-settings?admin_id=${user.id}`).catch(() => ({ data: null }))
      ]);
      
      setStats(statsRes.data);
      setUsers(usersRes.data.users);
      setLogs(logsRes.data);
      // Always set siteSettings with defaults if not present
      setSiteSettings(settingsRes.data || { access_code_enabled: false, access_code: '' });
    } catch (error) {
      logger.error('Admin data error:', error);
      if (error.response?.status === 403) {
        toast.error('Admin access required');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const updateSiteSettings = async (updates) => {
    setSavingSettings(true);
    try {
      await apiClient.put(`/admin/platform-settings?admin_id=${user.id}`, updates);
      setSiteSettings(prev => ({ ...prev, ...updates }));
      toast.success('Settings saved');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSearch = async () => {
    try {
      const response = await apiClient.get(
        `/admin/users?admin_id=${user.id}&search=${searchQuery}&limit=50`
      );
      setUsers(response.data.users);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  const handleSuspend = async () => {
    if (!userToSuspend || !suspendReason) return;
    
    try {
      await apiClient.post(
        `/admin/users/${userToSuspend.id}/suspend?admin_id=${user.id}`,
        { reason: suspendReason }
      );
      toast.success(`${userToSuspend.email} suspended`);
      setShowSuspendModal(false);
      setSuspendReason('');
      setUserToSuspend(null);
      fetchData();
    } catch (error) {
      toast.error('Failed to suspend user');
    }
  };

  const handleUnsuspend = async (targetUser) => {
    try {
      await apiClient.post(
        `/admin/users/${targetUser.id}/unsuspend?admin_id=${user.id}`
      );
      toast.success(`${targetUser.email} unsuspended`);
      fetchData();
    } catch (error) {
      toast.error('Failed to unsuspend user');
    }
  };

  const handleVerify = async (targetUser) => {
    try {
      await apiClient.patch(
        `/admin/users/${targetUser.id}?admin_id=${user.id}`,
        { is_verified: !targetUser.is_verified }
      );
      toast.success(`Verification ${targetUser.is_verified ? 'removed' : 'added'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update verification');
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    try {
      if (targetUser.is_admin) {
        await apiClient.post(
          `/admin/revoke-admin/${targetUser.id}?admin_id=${user.id}`
        );
      } else {
        await apiClient.post(
          `/admin/make-admin/${targetUser.id}?admin_id=${user.id}`
        );
      }
      toast.success(`Admin status updated`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update admin status');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <Shield className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-gray-400">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto" data-testid="admin-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-7 h-7 text-red-500" />
            Admin Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-1">God Mode - Full platform control</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['overview', 'users', 'spots', 'queue', 'pricing', 'competition', 'settings', 'logs'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab
                ? 'bg-red-500 text-white'
                : 'bg-zinc-800 text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'competition' && <Trophy className="w-4 h-4" />}
            {tab === 'pricing' && <DollarSign className="w-4 h-4" />}
            {tab === 'spots' && <MapPin className="w-4 h-4" />}
            {tab === 'queue' && <AlertTriangle className="w-4 h-4" />}
            {tab === 'settings' && <Settings className="w-4 h-4" />}
            {tab}
          </button>
        ))}
      </div>

      {/* Persona Switcher - God Mode Tool */}
      <PersonaSwitcher />

      {/* Overview Tab */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={Users}
              label="Total Users"
              value={stats.users.total}
              subtext={`${stats.users.new_this_week} this week`}
              color="cyan"
            />
            <StatCard
              icon={FileText}
              label="Total Posts"
              value={stats.content.total_posts}
              color="blue"
            />
            <StatCard
              icon={Image}
              label="Gallery Items"
              value={stats.content.total_gallery_items}
              color="purple"
            />
            <StatCard
              icon={DollarSign}
              label="Revenue (30d)"
              value={`$${stats.revenue.last_30_days}`}
              color="green"
            />
          </div>

          {/* Users by Role */}
          <div className="bg-zinc-900 rounded-xl p-4">
            <h3 className="text-lg font-bold text-white mb-4">Users by Role</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats.users.by_role).map(([role, count]) => (
                <div key={role} className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-gray-400 text-sm capitalize">{role.replace(/_/g, ' ')}</p>
                  <p className="text-white text-xl font-bold">{count}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Subscriptions */}
          <div className="bg-zinc-900 rounded-xl p-4">
            <h3 className="text-lg font-bold text-white mb-4">Subscriptions</h3>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(stats.users.by_subscription).map(([tier, count]) => (
                <div key={tier} className="bg-zinc-800 rounded-lg p-3 text-center">
                  <p className="text-gray-400 text-sm capitalize">{tier || 'None'}</p>
                  <p className="text-white text-2xl font-bold">{count}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by email or name..."
              className="bg-zinc-800 border-zinc-700 text-white"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} className="bg-red-500 hover:bg-red-600">
              <Search className="w-4 h-4" />
            </Button>
          </div>

          {/* Users Table */}
          <div className="bg-zinc-900 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800">
                  <tr>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">User</th>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">Role</th>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">Subscription</th>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">Credits</th>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">Status</th>
                    <th className="text-left text-gray-400 text-sm font-medium p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-zinc-800 hover:bg-zinc-800/50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden">
                            {u.avatar_url ? (
                              <img src={getFullUrl(u.avatar_url)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white font-bold">
                                {u.full_name?.[0] || u.email[0]}
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-white font-medium flex items-center gap-2">
                              {u.full_name || 'No name'}
                              {u.is_admin && <Crown className="w-4 h-4 text-yellow-400" />}
                              {u.is_verified && <CheckCircle className="w-4 h-4 text-cyan-400" />}
                            </p>
                            <p className="text-gray-400 text-sm">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge className="bg-zinc-700 text-white capitalize">
                          {u.role?.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <span className={`text-sm ${
                          u.subscription_tier === 'premium' ? 'text-yellow-400' :
                          u.subscription_tier === 'basic' ? 'text-cyan-400' : 'text-gray-400'
                        }`}>
                          {u.subscription_tier || 'None'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="text-green-400">${u.credit_balance.toFixed(2)}</span>
                      </td>
                      <td className="p-4">
                        {u.is_suspended ? (
                          <Badge className="bg-red-500/20 text-red-400">Suspended</Badge>
                        ) : (
                          <Badge className="bg-emerald-500/20 text-emerald-400">Active</Badge>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedUser(u)}
                            className="border-zinc-700 text-white h-8"
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleVerify(u)}
                            className={`border-zinc-700 h-8 ${u.is_verified ? 'text-cyan-400' : 'text-white'}`}
                          >
                            <CheckCircle className="w-3 h-3" />
                          </Button>
                          {u.is_suspended ? (
                            <Button
                              size="sm"
                              onClick={() => handleUnsuspend(u)}
                              className="bg-emerald-500 hover:bg-emerald-600 h-8"
                            >
                              <UserCheck className="w-3 h-3" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setUserToSuspend(u);
                                setShowSuspendModal(true);
                              }}
                              className="bg-red-500 hover:bg-red-600 h-8"
                              disabled={u.is_admin}
                            >
                              <UserX className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div className="bg-zinc-900 rounded-xl p-4">
          <h3 className="text-lg font-bold text-white mb-4">Admin Action Logs</h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center gap-4 p-3 bg-zinc-800 rounded-lg">
                <div className="flex-1">
                  <p className="text-white text-sm">
                    <span className="text-yellow-400">{log.admin_name || 'Unknown'}</span>
                    {' '}{log.action.replace(/_/g, ' ')}{' '}
                    <span className="text-gray-400">({log.target_type})</span>
                  </p>
                  {log.details && (
                    <p className="text-gray-500 text-xs mt-1">
                      {JSON.stringify(log.details)}
                    </p>
                  )}
                </div>
                <span className="text-gray-500 text-xs">
                  {new Date(log.created_at).toLocaleString()}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-gray-400 text-center py-8">No admin logs yet</p>
            )}
          </div>
        </div>
      )}

      {/* Competition Tab */}
      {activeTab === 'competition' && (
        <AdminCompetitionVerification />
      )}

      {/* Pricing Tab */}
      {activeTab === 'pricing' && (
        <AdminPricingEditor />
      )}

      {/* Spots Tab - Map Editor */}
      {activeTab === 'spots' && (
        <AdminSpotEditor />
      )}

      {/* Queue Tab - Precision Queue */}
      {activeTab === 'queue' && (
        <AdminPrecisionQueue />
      )}
      
      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Site Access Control */}
          <div className="bg-zinc-900 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-cyan-500/10">
                <Lock className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Site Access Control</h3>
                <p className="text-gray-400 text-sm">Require access code to view the site</p>
              </div>
            </div>
            
            {!siteSettings ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Enable/Disable Toggle */}
                <div className="flex items-center justify-between p-4 bg-zinc-800 rounded-lg">
                  <div>
                    <p className="text-white font-medium">Access Code Required</p>
                    <p className="text-gray-400 text-sm">
                      {siteSettings.access_code_enabled 
                        ? 'Visitors must enter code to access the site' 
                        : 'Site is publicly accessible'}
                    </p>
                  </div>
                  <button
                    onClick={() => updateSiteSettings({ access_code_enabled: !siteSettings.access_code_enabled })}
                    disabled={savingSettings}
                    className={`relative w-14 h-8 rounded-full transition-colors ${
                      siteSettings.access_code_enabled ? 'bg-cyan-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                      siteSettings.access_code_enabled ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>
                
                {/* Access Code */}
                {siteSettings.access_code_enabled && (
                  <div className="p-4 bg-zinc-800 rounded-lg">
                    <label className="block text-white font-medium mb-2">Access Code</label>
                    <div className="flex gap-2">
                      <Input
                        value={siteSettings.access_code || ''}
                        onChange={(e) => setSiteSettings(prev => ({ ...prev, access_code: e.target.value.toUpperCase() }))}
                        placeholder="Enter access code"
                        className="bg-zinc-700 border-zinc-600 text-white uppercase tracking-widest font-mono"
                      />
                      <Button
                        onClick={() => updateSiteSettings({ access_code: siteSettings.access_code })}
                        disabled={savingSettings}
                        className="bg-cyan-500 hover:bg-cyan-600"
                      >
                        {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                    <p className="text-yellow-400 text-xs mt-2">
                      ⚠️ Changing the code will require ALL users to re-enter the new code
                    </p>
                  </div>
                )}
                
                {/* Status Indicator */}
                <div className={`p-4 rounded-lg border ${
                  siteSettings.access_code_enabled 
                    ? 'bg-yellow-500/10 border-yellow-500/30' 
                    : 'bg-green-500/10 border-green-500/30'
                }`}>
                  <p className={`text-sm font-medium ${
                    siteSettings.access_code_enabled ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {siteSettings.access_code_enabled 
                      ? `🔒 Site is protected - Code: ${siteSettings.access_code}` 
                      : '🌐 Site is public - Anyone can access'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          adminId={user.id}
          onClose={() => setSelectedUser(null)}
          onUpdate={fetchData}
          onToggleAdmin={handleToggleAdmin}
        />
      )}

      {/* Suspend Modal */}
      <Dialog open={showSuspendModal} onOpenChange={setShowSuspendModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Ban className="w-5 h-5" />
              Suspend User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-gray-400">
              You are about to suspend <span className="text-white">{userToSuspend?.email}</span>
            </p>
            <Textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={3}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowSuspendModal(false)}
                className="flex-1 border-zinc-700 text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSuspend}
                disabled={!suspendReason}
                className="flex-1 bg-red-500 hover:bg-red-600"
              >
                Suspend User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, subtext, color }) => {
  const colors = {
    cyan: 'text-cyan-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400'
  };

  return (
    <div className="bg-zinc-900 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <Icon className={`w-5 h-5 ${colors[color]}`} />
        <span className="text-gray-400 text-sm">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  );
};

const UserDetailModal = ({ user: targetUser, _adminId, onClose, _onUpdate, onToggleAdmin }) => {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {/* Avatar & Name */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-zinc-700 overflow-hidden">
              {targetUser.avatar_url ? (
                <img src={getFullUrl(targetUser.avatar_url)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white">
                  {targetUser.full_name?.[0] || targetUser.email[0]}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                {targetUser.full_name || 'No name'}
                {targetUser.is_admin && <Crown className="w-5 h-5 text-yellow-400" />}
              </h3>
              <p className="text-gray-400">{targetUser.email}</p>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs">Role</p>
              <p className="text-white capitalize">{targetUser.role?.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs">Subscription</p>
              <p className="text-white capitalize">{targetUser.subscription_tier || 'None'}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs">Credits</p>
              <p className="text-green-400">${targetUser.credit_balance.toFixed(2)}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs">Joined</p>
              <p className="text-white">{new Date(targetUser.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          {/* Status Badges */}
          <div className="flex gap-2">
            {targetUser.is_verified && (
              <Badge className="bg-cyan-500/20 text-cyan-400">Verified</Badge>
            )}
            {targetUser.is_admin && (
              <Badge className="bg-yellow-500/20 text-yellow-400">Admin</Badge>
            )}
            {targetUser.is_suspended && (
              <Badge className="bg-red-500/20 text-red-400">Suspended</Badge>
            )}
          </div>

          {targetUser.suspended_reason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-red-400 text-sm font-medium">Suspension Reason:</p>
              <p className="text-gray-400 text-sm mt-1">{targetUser.suspended_reason}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onToggleAdmin(targetUser)}
              className={`flex-1 border-zinc-700 ${targetUser.is_admin ? 'text-yellow-400' : 'text-white'}`}
            >
              <Crown className="w-4 h-4 mr-2" />
              {targetUser.is_admin ? 'Remove Admin' : 'Make Admin'}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-zinc-700 text-white"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminDashboard;
