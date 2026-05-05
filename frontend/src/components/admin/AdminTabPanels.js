/**
 * AdminTabPanels.js
 * Extracted tab panel components from UnifiedAdminConsole.js
 * Includes: StatCard, UserDetailModal, DropdownBadge, UsersTabContent, AnalyticsTabContent
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield, Users, UserCheck, Camera, Crown, TrendingUp,
  Search, ChevronDown, ChevronUp, Trash2, Ban, Eye, MoreHorizontal,
  Star, AlertTriangle, CheckCircle2, XCircle, Loader2, X,
  BarChart3, Activity, DollarSign, Calendar
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { ROLES } from '../../constants/roles';
import logger from '../../utils/logger';
import { toast } from 'sonner';

const StatCard = React.memo(({ icon: Icon, label, value, subtext, color }) => {
  const colors = {
    cyan: 'text-cyan-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400'
  };

  return (
    <div className="bg-card rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${colors[color]}`} />
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {subtext && <p className="text-xs text-gray-500">{subtext}</p>}
    </div>
  );
});

// User Detail Modal Component
const UserDetailModal = ({ user: targetUser, onClose, onToggleAdmin }) => {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>
        <div className="modal-body px-4 sm:px-6 py-4 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={getFullUrl(targetUser.avatar_url)} />
              <AvatarFallback className="bg-input text-2xl">
                {targetUser.full_name?.[0] || targetUser.email[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                {targetUser.full_name || 'No name'}
                {targetUser.is_admin && <Crown className="w-5 h-5 text-yellow-400" />}
              </h3>
              <p className="text-muted-foreground text-sm">{targetUser.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted rounded-lg p-2">
              <p className="text-muted-foreground text-xs">Role</p>
              <p className="text-foreground capitalize">{targetUser.role?.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="text-muted-foreground text-xs">Subscription</p>
              <p className="text-foreground capitalize">{targetUser.subscription_tier || 'None'}</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="text-muted-foreground text-xs">Credits</p>
              <p className="text-green-400">${targetUser.credit_balance?.toFixed(2)}</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="text-muted-foreground text-xs">Joined</p>
              <p className="text-foreground">{targetUser.created_at ? new Date(targetUser.created_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button aria-label="Crown"
              variant="outline"
              onClick={() => onToggleAdmin(targetUser)}
              className={`flex-1 border-border ${targetUser.is_admin ? 'text-yellow-400' : 'text-foreground'}`}
            >
              <Crown className="w-4 h-4 mr-2" />
              {targetUser.is_admin ? 'Remove Admin' : 'Make Admin'}
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1 border-border text-foreground">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

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

// Dropdown Badge Component
const DropdownBadge = ({ value, options, onChange, colorClass, isLoading }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // Close dropdown when clicking outside
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
      <button aria-label="Loader2"
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
        <div className="absolute z-50 mt-1 left-0 bg-muted border border-input rounded-lg shadow-xl py-1 min-w-[140px] max-h-[200px] overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-input transition-colors ${
                option.value.toLowerCase() === value?.toLowerCase() 
                  ? 'text-cyan-400 bg-cyan-500/10' 
                  : 'text-foreground'
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
      // Check both button and dropdown for role
      const clickedInsideRoleButton = bulkRoleRef.current && bulkRoleRef.current.contains(event.target);
      const clickedInsideRoleDropdown = roleDropdownRef.current && roleDropdownRef.current.contains(event.target);
      if (!clickedInsideRoleButton && !clickedInsideRoleDropdown) {
        setShowBulkRoleDropdown(false);
      }
      
      // Check both button and dropdown for plan
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
      await apiClient.patch(
        `/admin/users/${userId}`,
        { role: newRole }
      );
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
      await apiClient.patch(
        `/admin/users/${userId}`,
        { subscription_tier: newTier }
      );
      toast.success(`Subscription updated to ${newTier}`);
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update subscription');
    } finally {
      setLoadingUser(null);
      setLoadingField(null);
    }
  };
  
  // Toggle user selection
  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };
  
  // Select/Deselect all users
  const toggleSelectAll = () => {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)));
    }
  };
  
  // Bulk update role
  const handleBulkUpdateRole = async (newRole) => {
    if (selectedUsers.size === 0) return;
    
    setBulkLoading(true);
    setShowBulkRoleDropdown(false);
    
    try {
      const userIds = Array.from(selectedUsers);
      await apiClient.post(
        `/admin/users/bulk-update`,
        { user_ids: userIds, role: newRole }
      );
      toast.success(`Updated ${userIds.length} users to ${newRole}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  
  // Bulk update subscription
  const handleBulkUpdateSubscription = async (newTier) => {
    if (selectedUsers.size === 0) return;
    
    setBulkLoading(true);
    setShowBulkSubDropdown(false);
    
    try {
      const userIds = Array.from(selectedUsers);
      await apiClient.post(
        `/admin/users/bulk-update`,
        { user_ids: userIds, subscription_tier: newTier }
      );
      toast.success(`Updated ${userIds.length} users to ${newTier}`);
      setSelectedUsers(new Set());
      onUserUpdate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Bulk update failed');
    } finally {
      setBulkLoading(false);
    }
  };
  
  // Bulk delete users - show confirmation modal
  const handleBulkDelete = () => {
    if (selectedUsers.size === 0) return;
    setShowDeleteConfirm(true);
  };
  
  // Actually perform the bulk delete after confirmation
  const confirmBulkDelete = async () => {
    setShowDeleteConfirm(false);
    setBulkLoading(true);
    
    const count = selectedUsers.size;
    
    try {
      const userIds = Array.from(selectedUsers);
      const response = await apiClient.post(
        `/admin/users/bulk-delete`,
        { user_ids: userIds }
      );
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
  
  // Admin password reset handler
  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return;
    setResetPasswordLoading(true);
    try {
      await apiClient.post(
        `/admin/users/${resetPasswordUser.id}/reset-password`,
        { new_password: newPassword }
      );
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
          className="bg-muted border-border text-foreground"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} className="bg-red-500 hover:bg-red-600" aria-label="Search">
          <Search className="w-4 h-4" />
        </Button>
      </div>
      
      {/* Bulk Actions Bar - Mobile Responsive */}
      {hasSelection && (
        <div className="sticky top-0 z-40 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-lg p-2 backdrop-blur-sm">
          {/* Top row: Selection count and clear */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span className="text-foreground font-medium text-sm">
                {selectedUsers.size} selected
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedUsers(new Set())}
              className="text-muted-foreground hover:text-foreground p-1 h-auto"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Bottom row: Action buttons - wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk Role Change */}
            <div className="relative" ref={bulkRoleRef}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowBulkSubDropdown(false);
                  setShowBulkRoleDropdown(!showBulkRoleDropdown);
                }}
                disabled={bulkLoading}
                className="border-input text-foreground hover:bg-input text-xs px-2 h-8 whitespace-nowrap"
              >
                {bulkLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <User className="w-3 h-3 mr-1" />
                )}
                Role
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>
            
            {/* Bulk Subscription Change */}
            <div className="relative" ref={bulkSubRef}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowBulkRoleDropdown(false);
                  setShowBulkSubDropdown(!showBulkSubDropdown);
                }}
                disabled={bulkLoading}
                className="border-input text-foreground hover:bg-input text-xs px-2 h-8 whitespace-nowrap"
              >
                {bulkLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Crown className="w-3 h-3 mr-1" />
                )}
                Plan
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </div>
            
            {/* Bulk Delete */}
            <Button aria-label="Loader2"
              size="sm"
              variant="outline"
              onClick={() => handleBulkDelete()}
              disabled={bulkLoading}
              className="border-red-500/50 text-red-400 hover:bg-red-500/20 text-xs px-2 h-8 whitespace-nowrap"
            >
              {bulkLoading ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1" />
              )}
              Delete
            </Button>
          </div>
          
          {/* Role Dropdown - rendered outside scroll container */}
          {showBulkRoleDropdown && (
            <div 
              ref={roleDropdownRef}
              className="absolute left-2 mt-1 bg-muted border border-input rounded-lg shadow-xl py-1 min-w-[160px] max-h-[250px] overflow-y-auto z-[100]"
            >
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleBulkUpdateRole(option.value)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-input text-foreground transition-colors"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          
          {/* Plan Dropdown - rendered outside scroll container */}
          {showBulkSubDropdown && (
            <div 
              ref={planDropdownRef}
              className="absolute left-20 mt-1 bg-muted border border-input rounded-lg shadow-xl py-1 min-w-[120px] z-[100]"
            >
              {SUBSCRIPTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleBulkUpdateSubscription(option.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-input transition-colors ${
                    option.value === 'premium' ? 'text-yellow-400' : 'text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Select All Header */}
      <div className="flex items-center gap-2 px-1">
        <button aria-label="Confirm"
          onClick={toggleSelectAll}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            allSelected 
              ? 'bg-cyan-500 border-cyan-500' 
              : 'border-zinc-500 hover:border-cyan-400'
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
            <Card 
              key={u.id} 
              className={`${cardBgClass} transition-all ${
                isSelected ? 'ring-2 ring-cyan-500/50' : ''
              }`}
            >
              <CardContent className="p-3 overflow-visible">
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <button aria-label="Confirm"
                    onClick={() => toggleUserSelection(u.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                      isSelected 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : 'border-zinc-500 hover:border-cyan-400'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-black" />}
                  </button>
                  
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={getFullUrl(u.avatar_url)} />
                    <AvatarFallback className="bg-input">
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
                    <Button aria-label="View"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedUser(u)}
                      className="h-8 w-8 p-0"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button aria-label="Check Circle"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleVerify(u)}
                      className={`h-8 w-8 p-0 ${u.is_verified ? 'text-cyan-400' : ''}`}
                    >
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResetPasswordUser(u);
                        setNewPassword('');
                        setShowResetPasswordModal(true);
                      }}
                      className="h-8 w-8 p-0 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                      title="Reset Password"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    {u.is_suspended ? (
                      <Button aria-label="User Check"
                        size="sm"
                        onClick={() => handleUnsuspend(u)}
                        className="bg-emerald-500 hover:bg-emerald-600 h-8 w-8 p-0"
                      >
                        <UserCheck className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button aria-label="User X"
                        size="sm"
                        onClick={() => { setUserToSuspend(u); setShowSuspendModal(true); }}
                        className="bg-red-500 hover:bg-red-600 h-8 w-8 p-0"
                        disabled={u.is_admin}
                      >
                        <UserX className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap ml-8">
                  {/* Role Dropdown Badge */}
                  <DropdownBadge
                    value={u.role}
                    options={ROLE_OPTIONS}
                    onChange={(newRole) => handleUpdateRole(u.id, newRole)}
                    colorClass="bg-input text-foreground"
                    isLoading={loadingUser === u.id && loadingField === 'role'}
                  />
                  
                  {/* Subscription Dropdown Badge */}
                  <DropdownBadge
                    value={u.subscription_tier || 'free'}
                    options={SUBSCRIPTION_OPTIONS}
                    onChange={(newTier) => handleUpdateSubscription(u.id, newTier)}
                    colorClass={u.subscription_tier === 'premium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-input text-muted-foreground'}
                    isLoading={loadingUser === u.id && loadingField === 'subscription'}
                  />
                  
                  {/* Credit Balance - View Only */}
                  <Badge className="bg-green-500/20 text-green-400">
                    ${u.credit_balance?.toFixed(2) || '0.00'}
                  </Badge>
                  
                  {u.is_suspended && (
                    <Badge className="bg-red-500/20 text-red-400">Suspended</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Confirm Delete
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-zinc-300">
              Are you sure you want to delete <span className="text-red-400 font-semibold">{selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''}</span>?
            </p>
            <p className="text-zinc-500 text-sm mt-2">
              This action cannot be undone.
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              className="border-input text-zinc-300 hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Users
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Reset Password Modal */}
      <Dialog open={showResetPasswordModal} onOpenChange={setShowResetPasswordModal}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <KeyRound className="w-5 h-5" />
              Reset Password
            </DialogTitle>
          </DialogHeader>
          <div className="modal-body px-4 sm:px-6 space-y-4 py-4">
            <p className="text-muted-foreground text-sm">
              Set a new password for{' '}
              <span className="text-foreground font-medium">{resetPasswordUser?.full_name || resetPasswordUser?.email}</span>
            </p>
            <p className="text-gray-500 text-xs">{resetPasswordUser?.email}</p>
            <Input aria-label="Enter new password (min 6 characters)"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 6 characters)"
              className="bg-muted border-border text-foreground"
              autoComplete="new-password"
            />
            {newPassword && newPassword.length < 6 && (
              <p className="text-red-400 text-xs">Password must be at least 6 characters</p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowResetPasswordModal(false); setNewPassword(''); }}
                className="flex-1 border-border text-foreground"
              >
                Cancel
              </Button>
              <Button aria-label="Loader2"
                onClick={handleResetPassword}
                disabled={!newPassword || newPassword.length < 6 || resetPasswordLoading}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
              >
                {resetPasswordLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <KeyRound className="w-4 h-4 mr-2" />
                )}
                Reset Password
              </Button>
            </div>
            <p className="text-yellow-500/60 text-xs text-center">
              ?? The user will need to log in with this new password
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Analytics Tab Content Component - Platform Mission Control
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
        <Button aria-label="Loader2"
          size="sm"
          variant="outline"
          onClick={handleRefreshCache}
          disabled={refreshing}
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
          {/* Total Credit Liability - KEY METRIC */}
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
                <p className="text-xs text-gray-500 mt-1">
                  Sum of all credits in user wallets
                </p>
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
          {/* Role Distribution */}
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
                      <div 
                        className="h-1 bg-cyan-500 rounded" 
                        style={{ width: `${data.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Booking Efficiency */}
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

          {/* Spot Activity Heatmap Preview */}
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

          {/* Signup Trend Summary */}
          {priceImpact?.signup_trend && priceImpact.signup_trend.length > 0 && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-2">Signup Trend (Last 90 Days)</p>
              <div className="flex items-end gap-0.5 h-12">
                {priceImpact.signup_trend.slice(-30).map((day, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-cyan-500 rounded-t"
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


// AdControlsPanel and AdminSpotsPanel are extracted to admin/AdControlsPanel.js and admin/AdminSpotsPanel.js


export { StatCard, UserDetailModal, DropdownBadge, UsersTabContent, AnalyticsTabContent };
