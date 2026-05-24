/**
 * AdminTabPanels.js
 * Re-export hub for admin tab panel components.
 * v43: UsersTabContent and AnalyticsTabContent extracted to admin/tabs/
 * Retains: StatCard, UserDetailModal (small enough to stay inline)
 */
import React from 'react';
import { Crown } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

// --- Re-exports from extracted modules ---
export { UsersTabContent, DropdownBadge } from './tabs/UsersTabContent';
export { AnalyticsTabContent } from './tabs/AnalyticsTabContent';

// --- StatCard (small, shared across multiple tabs) ---
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

// --- UserDetailModal (small, used by UnifiedAdminConsole) ---
const UserDetailModal = ({ user: targetUser, onClose, onToggleAdmin }) => {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className={`max-w-md border ${t.pageBg} ${t.border} ${t.textPrimary}`}>
        <DialogHeader>
          <DialogTitle className={t.textPrimary}>User Details</DialogTitle>
        </DialogHeader>
        <div className="modal-body px-4 sm:px-6 py-4 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={getFullUrl(targetUser.avatar_url)} />
              <AvatarFallback className={`${t.avatarBg} ${t.textPrimary} text-2xl`}>
                {targetUser.full_name?.[0] || targetUser.email[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className={`text-lg font-bold flex items-center gap-2 ${t.textPrimary}`}>
                {targetUser.full_name || 'No name'}
                {targetUser.is_admin && <Crown className="w-5 h-5 text-yellow-400" />}
              </h3>
              <p className={`text-sm ${t.textSecondary}`}>{targetUser.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className={`${t.cellBg} rounded-lg p-2`}>
              <p className={`text-xs ${t.textSecondary}`}>Role</p>
              <p className={`capitalize ${t.textPrimary}`}>{targetUser.role?.replace(/_/g, ' ')}</p>
            </div>
            <div className={`${t.cellBg} rounded-lg p-2`}>
              <p className={`text-xs ${t.textSecondary}`}>Subscription</p>
              <p className={`capitalize ${t.textPrimary}`}>{targetUser.subscription_tier || 'None'}</p>
            </div>
            <div className={`${t.cellBg} rounded-lg p-2`}>
              <p className={`text-xs ${t.textSecondary}`}>Credits</p>
              <p className="text-green-400 font-bold">${targetUser.credit_balance?.toFixed(2)}</p>
            </div>
            <div className={`${t.cellBg} rounded-lg p-2`}>
              <p className={`text-xs ${t.textSecondary}`}>Joined</p>
              <p className={t.textPrimary}>{targetUser.created_at ? new Date(targetUser.created_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button aria-label="Toggle admin status"
              variant="outline"
              onClick={() => onToggleAdmin(targetUser)}
              className={`flex-1 border ${t.border} ${t.hoverBg} ${targetUser.is_admin ? 'text-yellow-500' : t.textPrimary}`}
            >
              <Crown className="w-4 h-4 mr-2" />
              {targetUser.is_admin ? 'Remove Admin' : 'Make Admin'}
            </Button>
            <Button variant="outline" onClick={onClose} className={`flex-1 border ${t.border} ${t.hoverBg} ${t.textPrimary}`}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { StatCard, UserDetailModal };
