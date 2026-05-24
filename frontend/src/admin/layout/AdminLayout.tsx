import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, ChevronRight, LogOut, ArrowLeftRight
} from 'lucide-react';

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

  return (
    <div className="bg-[#020617] min-h-screen text-slate-200 pb-16 font-sans antialiased">
      {/* Header bar */}
      <header className="bg-slate-950/40 border-b border-slate-900 sticky top-0 z-[1200] backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-cyan-500/10 p-2 rounded-lg border border-cyan-500/20">
              <Shield className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-slate-100 tracking-wide flex items-center gap-2">
                ANTIGRAVITY 2.0
                <span className="text-[10px] font-bold bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20 uppercase tracking-widest">
                  Admin Sync
                </span>
              </h1>
              <p className="text-[10px] text-slate-500 font-medium">Safe System Integration & Event Spine Observability</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick toggle to legacy tab-controls panel */}
            <button 
              onClick={() => setViewLegacyConsole(true)}
              className="bg-slate-900/60 hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 border border-slate-800 transition-all"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
              Legacy Console Tools
            </button>

            <button
              onClick={() => navigate('/feed')}
              className="bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 p-2.5 rounded-lg border border-slate-900 transition-all"
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
            <div className="bg-slate-950/20 border border-slate-900 rounded-xl p-4 mb-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Current Scope</div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
                  {user?.full_name?.charAt(0) || 'A'}
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-200">{user?.full_name || 'Admin Officer'}</div>
                  <div className="text-[10px] text-slate-500 font-mono">Role: Cryptographic Admin</div>
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
                        : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
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
