import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, ChevronRight, LogOut, ArrowLeftRight
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

interface TabItem {
  id: string;
  label: string;
  icon: any;
}

interface AdminLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tabs: TabItem[];
  user: any;
  viewLegacyConsole: boolean;
  setViewLegacyConsole: (view: boolean) => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  children,
  activeTab,
  setActiveTab,
  tabs,
  user,
  viewLegacyConsole,
  setViewLegacyConsole
}) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';
  const accentBg = dim ? 'bg-cyan-600/10' : 'bg-cyan-500/10';
  const accentBorder = dim ? 'border-cyan-600/30' : 'border-cyan-500/20';

  return (
    <div className={`${t.pageBg} min-h-screen ${t.textPrimary} pb-16 font-sans antialiased`}>
      {/* Header bar */}
      <header className={`${t.glassBg} border-b sticky top-0 z-[1200] backdrop-blur-lg`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`${accentBg} p-2 rounded-lg border ${accentBorder}`}>
              <Shield className={`w-6 h-6 ${accent}`} />
            </div>
            <div>
              <h1 className={`text-base font-extrabold ${t.textPrimary} tracking-wide flex items-center gap-2`}>
                RAW SURF OS
                <span className={`text-[10px] font-bold ${accentBg} ${accent} px-2 py-0.5 rounded border ${accentBorder} uppercase tracking-widest`}>
                  Admin Sync
                </span>
              </h1>
              <p className={`text-[10px] ${t.textMuted} font-medium`}>Safe System Integration & Event Spine Observability</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick toggle to legacy tab-controls panel */}
            <button
              onClick={() => setViewLegacyConsole(true)}
              className={`${t.cardBg} ${t.hoverBg} ${t.textSecondary} hover:${t.textPrimary} text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 border ${t.border} transition-all`}
            >
              <ArrowLeftRight className={`w-3.5 h-3.5 ${accent}`} />
              Legacy Console Tools
            </button>

            <button
              onClick={() => navigate('/feed')}
              className={`${t.pageBg} ${t.hoverBg} ${t.textMuted} hover:${t.textPrimary} p-2.5 rounded-lg border ${t.border} transition-all`}
              aria-label="Exit console"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Navigation Sidebar */}
          <div className="space-y-3 lg:col-span-1">
            <div className={`${t.cardBgBorder} border rounded-xl p-4 mb-4`}>
              <div className={`text-xs font-bold ${t.textMuted} uppercase tracking-wider mb-2.5`}>Current Scope</div>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${t.avatarBg} border ${t.border} flex items-center justify-center text-xs font-bold ${t.textSecondary}`}>
                  {user?.full_name?.charAt(0) || 'A'}
                </div>
                <div>
                  <div className={`text-sm font-bold ${t.textPrimary}`}>{user?.full_name || 'Admin Officer'}</div>
                  <div className={`text-[10px] ${t.textMuted} font-mono`}>Role: Cryptographic Admin</div>
                </div>
              </div>
            </div>

            <nav className="space-y-1.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-xs font-bold tracking-wide transition-all ${
                      isActive
                        ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-lg shadow-cyan-500/10'
                        : `bg-transparent ${t.textMuted} hover:${t.textPrimary} hover:${t.hoverBg}`
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </div>
                    <ChevronRight className={`w-3.5 h-3.5 opacity-50 ${isActive ? 'text-slate-950 font-bold' : ''}`} />
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Active Tab Panel */}
          <div className="lg:col-span-3">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
