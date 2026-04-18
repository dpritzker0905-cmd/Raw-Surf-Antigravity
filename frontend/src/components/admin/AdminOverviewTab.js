/**
 * AdminOverviewTab.js — Overview tab for the Unified Admin Console.
 *
 * Shows platform stats, role distribution, and quick navigation links.
 * All data is passed via props from UnifiedAdminConsole.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, DollarSign, Image, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';

/**
 * Reusable stat card widget.
 * @param {Object} props - icon, label, value, subtext, color
 */
const StatCard = ({ icon: Icon, label, value, subtext, color = 'cyan' }) => (
  <div className={`p-3 rounded-xl bg-${color}-500/10 border border-${color}-500/20`}>
    <div className="flex items-center gap-2 mb-1">
      <Icon className={`w-4 h-4 text-${color}-400`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
    <p className={`text-xl font-bold text-${color}-400`}>{value}</p>
    {subtext && <p className="text-xs text-gray-500 mt-0.5">{subtext}</p>}
  </div>
);

/**
 * @param {Object} props
 * @param {Object} props.stats - Platform statistics from GET /admin/stats
 * @param {string} props.cardBgClass - Tailwind class for card backgrounds
 * @param {string} props.textClass - Tailwind class for primary text
 * @param {string} props.textSecondary - Tailwind class for secondary text
 * @param {boolean} props.isLight - Whether the theme is light mode
 */
const AdminOverviewTab = ({ stats, cardBgClass, textClass, textSecondary, isLight }) => {
  const navigate = useNavigate();

  if (!stats) return null;

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Users} label="Total Users" value={stats.users?.total || 0} subtext={`${stats.users?.new_this_week || 0} this week`} color="cyan" />
        <StatCard icon={FileText} label="Total Posts" value={stats.content?.total_posts || 0} color="blue" />
        <StatCard icon={Image} label="Gallery Items" value={stats.content?.total_gallery_items || 0} color="purple" />
        <StatCard icon={DollarSign} label="Revenue (30d)" value={`$${stats.revenue?.last_30_days || 0}`} color="green" />
      </div>

      {/* Users by Role */}
      <Card className={cardBgClass}>
        <CardHeader>
          <CardTitle className={`${textClass} text-sm`}>Users by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {stats.users?.by_role && Object.entries(stats.users.by_role).map(([role, count]) => (
              <div key={role} className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'} rounded-lg p-2`}>
                <p className={`${textSecondary} text-xs capitalize`}>{role.replace(/_/g, ' ')}</p>
                <p className={`${textClass} font-bold`}>{count}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Navigation */}
      <Card className={cardBgClass}>
        <CardHeader>
          <CardTitle className={`${textClass} text-sm`}>Quick Navigation</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/map')} className={isLight ? 'border-gray-200 hover:bg-gray-100' : 'border-zinc-700'}>
            Test Map
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/bookings')} className={isLight ? 'border-gray-200 hover:bg-gray-100' : 'border-zinc-700'}>
            Test Bookings
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/gallery')} className={isLight ? 'border-gray-200 hover:bg-gray-100' : 'border-zinc-700'}>
            Test Gallery
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/profile')} className={isLight ? 'border-gray-200 hover:bg-gray-100' : 'border-zinc-700'}>
            Test Profile
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminOverviewTab;
