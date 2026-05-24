/**
 * UsersTabContent.js
 * Extracted from AdminTabPanels.js (v43)
 * User management tab with editable badges, bulk actions, and modals
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, ChevronDown, Trash2, Eye, Crown,
  CheckCircle2, Loader2, X, UserCheck
} from 'lucide-react';
// Icons used in JSX but were missing from the original AdminTabPanels imports
import { Check, User, UserX, KeyRound } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '../../ui/avatar';
import apiClient from '../../../lib/apiClient';
import { getFullUrl } from '../../../utils/media';
import { toast } from 'sonner';
import { useTheme } from '../../../contexts/ThemeContext';
import { getThemeTokens } from '../../../utils/themeTokens';

// Aliased to match original usage (CheckCircle2 imported, used as CheckCircle in JSX)
const CheckCircle = CheckCircle2;

// Role options for dropdown
const ROLE_OPTIONS = [
  { value: 'Grom', label: 'Grom' },
  { value: 'Surfer', label: 'Surfer' },
  { value: 'Comp Surfer', label: 'Comp Surfer' },
  { value: 'Pro', label: 'Pro' },
  { value: 'Grom Parent', label: 'Grom Parent' },
  { value: 'Hobbyist', label: 'Hobbyist' },
  { value: 'Photographer', label: 'Photographer' },
  { value: 'Approved Pro', label: 'Approved Pro' },
  { value: 'School', label: 'School' },
  { value: 'Coach', label: 'Coach' },
  { value: 'Resort', label: 'Resort' },
  { value: 'Wave Pool', label: 'Wave Pool' },
  { value: 'Shop', label: 'Shop' },
  { value: 'Shaper', label: 'Shaper' },
  { value: 'Destination', label: 'Destination' },
];

// Subscription tier options
const SUBSCRIPTION_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'basic', label: 'Basic' },
  { value: 'premium', label: 'Premium' },
];

// Dropdown Badge Component (co-located -- used only by UsersTabContent)
const DropdownBadge = ({ value, options, onChange, colorClass, isLoading }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { theme } = useTheme();
  const t = getThemeTokens(theme);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayValue = options.find(o => o.value.toLowerCase() === value?.toLowerCase())?.label || value || 'Unknown';

  return (
    <div className="relative" ref={dropdownRef}>
      <button aria-label="Toggle dropdown"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${colorClass}`}
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <>
            <span className="capitalize">{displayValue?.replace(/_/g, ' ')}</span>
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>

      {isOpen && (
        <div className={`absolute z-50 mt-1 left-0 border rounded-lg shadow-xl py-1 min-w-[140px] max-h-[200px] overflow-y-auto ${t.pageBg} ${t.border}`}>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-amber-100/40 dark:hover:bg-zinc-800/40 transition-colors ${
                option.value.toLowerCase() === value?.toLowerCase()
                  ? 'text-cyan-400 bg-cyan-500/10'
                  : t.textPrimary
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Users Tab Content Component with editable badges and bulk actions
const UsersTabContent = ({
  users,
  searchQuery,
  setSearchQuery,
  handleSearch,
  setSelectedUser,
  handleVerify,
  handleUnsuspend,
  setUserToSuspend,
  setShowSuspendModal,
  cardBgClass,
  textClass,
  textSecondary,
  adminId,
  onUserUpdate
}) => {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const isLight = theme === 'light';

  const [loadingUser, setLoadingUser] = useState(null);
  const [loadingField, setLoadingField] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkRoleDropdown, setShowBulkRoleDropdown] = useState(false);
  const [showBulkSubDropdown, setShowBulkSubDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const bulkRoleRef = useRef(null);
  const bulkSubRef = useRef(null);
  const roleDropdownRef = useRef(null);
  const planDropdownRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      const clickedInsideRoleButton = bulkRoleRef.current && bulkRoleRef.current.contains(event.target);
      const clickedInsideRoleDropdown = roleDropdownRef.current && roleDropdownRef.current.contains(event.target);
      if (!clickedInsideRoleButton && !clickedInsideRoleDropdown) {
        setShowBulkRoleDropdown(false);
      }

      const clickedInsidePlanButton = bulkSubRef.current && bulkSubRef.current.contains(event.target);
      const clickedInsidePlanDropdown = planDropdownRef.current && planDropdownRef.current.contains(event.target);
      if (!clickedInsidePlanButton && !clickedInsidePlanDropdown) {
        setShowBulkSubDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleUpdateRole = async (userId, newRole) => {
    setLoadingUser(userId);
    setLoadingField('role');
    try {
      await apiClient.patch(`/admin/users/${userId}`, { role: newRole });
      toast.success(`Role updated to ${newRole}`);
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update role');
    } finally {
      setLoadingUser(null);
      setLoadingField(null);
    }
  };

  const handleUpdateSubscription = async (userId, newTier) => {
    setLoadingUser(userId);
    setLoadingField('subscription');
    try {
      await apiClient.patch(`/admin/users/${userId}`, { subscription_tier: newTier });
      toast.success(`Subscription updated to ${newTier}`);
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update subscription');
    } finally {
      setLoadingUser(null);
      setLoadingField(null);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };

  const handleBulkUpdateRole = async (newRole) => {
    if (selectedUsers.size === 0) return;
    setBulkLoading(true);
    setShowBulkRoleDropdown(false);
    try {
      const userIds = Array.from(selectedUsers);
      await apiClient.post(`/admin/users/bulk-update`, { user_ids: userIds, role: newRole });
      toast.success(`Updated ${userIds.length} users to ${newRole}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkUpdateSubscription = async (newTier) => {
    if (selectedUsers.size === 0) return;
    setBulkLoading(true);
    setShowBulkSubDropdown(false);
    try {
      const userIds = Array.from(selectedUsers);
      await apiClient.post(`/admin/users/bulk-update`, { user_ids: userIds, subscription_tier: newTier });
      toast.success(`Updated ${userIds.length} users to ${newTier}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedUsers.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    setShowDeleteConfirm(false);
    setBulkLoading(true);
    const count = selectedUsers.size;
    try {
      const userIds = Array.from(selectedUsers);
      const response = await apiClient.post(`/admin/users/bulk-delete`, { user_ids: userIds });
      toast.success(response.data.message || `Deleted ${count} users`);
      if (response.data.errors?.length > 0) {
        toast.warning(`Some errors occurred: ${response.data.errors.join(', ')}`);
      }
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk delete failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return;
    setResetPasswordLoading(true);
    try {
      await apiClient.post(`/admin/users/${resetPasswordUser.id}/reset-password`, { new_password: newPassword });
      toast.success(`Password reset for ${resetPasswordUser.email}`);
      setShowResetPasswordModal(false);
      setResetPasswordUser(null);
      setNewPassword('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reset password');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const hasSelection = selectedUsers.size > 0;
  const allSelected = users.length > 0 && selectedUsers.size === users.length;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input aria-label="Search by email or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by email or name..."
          className={`border ${t.inputBg} ${t.textPrimary}`}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} className="bg-red-500 hover:bg-red-600 text-white" aria-label="Search">
          <Search className="w-4 h-4" />
        </Button>
      </div>

      {/* Bulk Actions Bar */}
      {hasSelection && (
        <div className="sticky top-0 z-40 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-lg p-2 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span className={`font-medium text-sm ${t.textPrimary}`}>
                {selectedUsers.size} selected
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedUsers(new Set())} className="text-muted-foreground hover:text-foreground p-1 h-auto">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk Role Change */}
            <div className="relative" ref={bulkRoleRef}>
              <Button size="sm" variant="outline"
                onClick={() => { setShowBulkSubDropdown(false); setShowBulkRoleDropdown(!showBulkRoleDropdown); }}
                disabled={bulkLoading}
                className={`border text-xs px-2 h-8 whitespace-nowrap ${t.border} ${t.textPrimary} ${t.hoverBg}`}
              >
                {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <User className="w-3 h-3 mr-1" />}
                Role <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>

            {/* Bulk Subscription Change */}
            <div className="relative" ref={bulkSubRef}>
              <Button size="sm" variant="outline"
                onClick={() => { setShowBulkRoleDropdown(false); setShowBulkSubDropdown(!showBulkSubDropdown); }}
                disabled={bulkLoading}
                className={`border text-xs px-2 h-8 whitespace-nowrap ${t.border} ${t.textPrimary} ${t.hoverBg}`}
              >
                {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Crown className="w-3 h-3 mr-1" />}
                Plan <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>

            {/* Bulk Delete */}
            <Button aria-label="Delete selected users" size="sm" variant="outline"
              onClick={() => handleBulkDelete()}
              disabled={bulkLoading}
              className="border-red-500/50 text-red-400 hover:bg-red-500/20 text-xs px-2 h-8 whitespace-nowrap"
            >
              {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
              Delete
            </Button>
          </div>

          {/* Role Dropdown */}
          {showBulkRoleDropdown && (
            <div ref={roleDropdownRef} className={`absolute left-2 mt-1 border rounded-lg shadow-xl py-1 min-w-[160px] max-h-[250px] overflow-y-auto z-[100] ${t.pageBg} ${t.border}`}>
              {ROLE_OPTIONS.map((option) => (
                <button key={option.value} onClick={() => handleBulkUpdateRole(option.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-100/40 dark:hover:bg-zinc-800/40 transition-colors ${t.textPrimary}`}
                >{option.label}</button>
              ))}
            </div>
          )}

          {/* Plan Dropdown */}
          {showBulkSubDropdown && (
            <div ref={planDropdownRef} className={`absolute left-20 mt-1 border rounded-lg shadow-xl py-1 min-w-[120px] z-[100] ${t.pageBg} ${t.border}`}>
              {SUBSCRIPTION_OPTIONS.map((option) => (
                <button key={option.value} onClick={() => handleBulkUpdateSubscription(option.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-100/40 dark:hover:bg-zinc-800/40 transition-colors ${
                    option.value === 'premium' ? 'text-yellow-400 font-semibold' : t.textPrimary
                  }`}
                >{option.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Select All Header */}
      <div className="flex items-center gap-2 px-1">
        <button aria-label="Select all users"
          onClick={toggleSelectAll}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            allSelected ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-500 hover:border-cyan-400'
          }`}
        >
          {allSelected && <Check className="w-3 h-3 text-black" />}
        </button>
        <span className={`text-sm ${textSecondary}`}>
          {allSelected ? 'Deselect all' : 'Select all'} ({users.length} users)
        </span>
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {users.map((u) => {
          const isSelected = selectedUsers.has(u.id);
          return (
            <Card key={u.id} className={`${cardBgClass} transition-all ${isSelected ? 'ring-2 ring-cyan-500/50' : ''}`}>
              <CardContent className="p-3 overflow-visible">
                <div className="flex items-center gap-3">
                  <button aria-label="Select user"
                    onClick={() => toggleUserSelection(u.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                      isSelected 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : theme === 'beach'
                          ? 'border-amber-400 hover:border-amber-600'
                          : 'border-zinc-500 hover:border-cyan-400'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-black" />}
                  </button>

                  <Avatar className="w-10 h-10">
                    <AvatarImage src={getFullUrl(u.avatar_url)} />
                    <AvatarFallback className={t.avatarBg}>
                      {u.full_name?.[0] || u.email[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${textClass} flex items-center gap-2 truncate`}>
                      {u.full_name || 'No name'}
                      {u.is_admin && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                      {u.is_verified && <CheckCircle className="w-3 h-3 text-cyan-400 flex-shrink-0" />}
                    </p>
                    <p className={`text-xs ${textSecondary} truncate`}>{u.email}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button aria-label="View user" size="sm" variant="ghost" onClick={() => setSelectedUser(u)} className={`h-8 w-8 p-0 ${t.textPrimary}`}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button aria-label="Verify user" size="sm" variant="ghost" onClick={() => handleVerify(u)} className={`h-8 w-8 p-0 ${u.is_verified ? 'text-cyan-400' : t.textPrimary}`}>
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={() => { setResetPasswordUser(u); setNewPassword(''); setShowResetPasswordModal(true); }}
                      className="h-8 w-8 p-0 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                      title="Reset Password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    {u.is_suspended ? (
                      <Button aria-label="Unsuspend user" size="sm" onClick={() => handleUnsuspend(u)} className="bg-emerald-500 hover:bg-emerald-600 h-8 w-8 p-0">
                        <UserCheck className="w-4 h-4 text-white" />
                      </Button>
                    ) : (
                      <Button aria-label="Suspend user" size="sm"
                        onClick={() => { setUserToSuspend(u); setShowSuspendModal(true); }}
                        className="bg-red-500 hover:bg-red-600 h-8 w-8 p-0 text-white" disabled={u.is_admin}
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap ml-8">
                  <DropdownBadge value={u.role} options={ROLE_OPTIONS}
                    onChange={(newRole) => handleUpdateRole(u.id, newRole)}
                    colorClass={`${t.badgeBg}`}
                    isLoading={loadingUser === u.id && loadingField === 'role'}
                  />
                  <DropdownBadge value={u.subscription_tier || 'free'} options={SUBSCRIPTION_OPTIONS}
                    onChange={(newTier) => handleUpdateSubscription(u.id, newTier)}
                    colorClass={u.subscription_tier === 'premium' ? 'bg-yellow-500/20 text-yellow-500' : `${t.badgeBg}`}
                    isLoading={loadingUser === u.id && loadingField === 'subscription'}
                  />
                  <Badge className="bg-green-500/20 text-green-500 font-bold">${u.credit_balance?.toFixed(2) || '0.00'}</Badge>
                  {u.is_suspended && <Badge className="bg-red-500/20 text-red-500 font-bold">Suspended</Badge>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className={`border max-w-sm ${t.pageBg} ${t.border}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${t.textPrimary}`}>
              <Trash2 className="w-5 h-5 text-red-500" /> Confirm Delete
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className={t.textSecondary}>
              Are you sure you want to delete <span className="text-red-500 font-semibold">{selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''}</span>?
            </p>
            <p className={`${t.textMuted} text-sm mt-2`}>This action cannot be undone.</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className={`border ${t.border} ${t.textPrimary} ${t.hoverBg}`}>Cancel</Button>
            <Button onClick={confirmBulkDelete} className="bg-red-600 hover:bg-red-700 text-white font-bold">Delete Users</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={showResetPasswordModal} onOpenChange={setShowResetPasswordModal}>
        <DialogContent className={`border max-w-sm ${t.pageBg} ${t.border}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <KeyRound className="w-5 h-5" /> Reset Password
            </DialogTitle>
          </DialogHeader>
          <div className="modal-body px-4 sm:px-6 space-y-4 py-4">
            <p className={`text-sm ${t.textSecondary}`}>
              Set a new password for{' '}
              <span className={`font-semibold ${t.textPrimary}`}>{resetPasswordUser?.full_name || resetPasswordUser?.email}</span>
            </p>
            <p className={`text-xs ${t.textMuted}`}>{resetPasswordUser?.email}</p>
            <Input aria-label="Enter new password (min 6 characters)"
              type="text" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 6 characters)"
              className={`border ${t.inputBg} ${t.textPrimary}`} autoComplete="new-password"
            />
            {newPassword && newPassword.length < 6 && (
              <p className="text-red-500 text-xs font-semibold">Password must be at least 6 characters</p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setShowResetPasswordModal(false); setNewPassword(''); }} className={`flex-1 border ${t.border} ${t.textPrimary} ${t.hoverBg}`}>Cancel</Button>
              <Button aria-label="Reset password"
                onClick={handleResetPassword}
                disabled={!newPassword || newPassword.length < 6 || resetPasswordLoading}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold"
              >
                {resetPasswordLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                Reset Password
              </Button>
            </div>
            <p className={`text-xs text-center ${t.textMuted}`}>
              {'\u26A0\uFE0F'} The user will need to log in with this new password
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export { UsersTabContent, DropdownBadge, ROLE_OPTIONS, SUBSCRIPTION_OPTIONS };
export default UsersTabContent;
