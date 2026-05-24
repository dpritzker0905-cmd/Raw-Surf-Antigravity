import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import useEvents from './hooks/useEvents';
import useAdminActions from './hooks/useAdminActions';
import EventInbox from './components/EventInbox';
import ActionQueue from './components/ActionQueue';
import BookingTrace from './components/BookingTrace';
import MediaReview from './components/MediaReview';
import SystemHealth from './components/SystemHealth';
import UnifiedAdminConsole from '../components/UnifiedAdminConsole';

import { 
  Shield, Terminal, ShieldAlert, GitCommit, Image, Server, LayoutDashboard, ChevronRight, LogOut, ArrowLeftRight
} from 'lucide-react';
import { Button } from '../components/ui/button';

export const AdminApp = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Custom admin tabs
  const [activeTab, setActiveTab] = useState('events');
  const [traceCorrelationId, setTraceCorrelationId] = useState('');
  
  // Toggle to access the original legacy console tabs directly without leaving the route!
  const [viewLegacyConsole, setViewLegacyConsole] = useState(false);

  const { events, loading: eventsLoading, refresh: refreshEvents } = useEvents();
  const { 
    actions, 
    loading: actionsLoading, 
    approveAction, 
    rejectAction, 
    proposeOverride,
    refresh: refreshActions
  } = useAdminActions();

  // Redirect if unauthorized
  if (user && !user.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#020617] text-center p-4">
        <Shield className="w-16 h-16 text-red-500 mb-4 animate-bounce" />
        <h2 className="text-2xl font-bold text-slate-100 mb-2">Unauthorized Access</h2>
        <p className="text-slate-400 max-w-sm">This dashboard is locked behind high-level cryptographic administrator gates.</p>
        <Button onClick={() => navigate('/feed')} className="mt-6 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold">
          Return to Surfer Feed
        </Button>
      </div>
    );
  }

  // Handle redirect from inbox item directly to booking trace
  const handleTraceCorrelation = (correlationId) => {
    setTraceCorrelationId(correlationId);
    setActiveTab('trace');
  };

  const tabs = [
    { id: 'events', label: 'Event Inbox', icon: Terminal, component: <EventInbox events={events} loading={eventsLoading} onSelectCorrelationId={handleTraceCorrelation} /> },
    { id: 'actions', label: 'Decisions Queue', icon: ShieldAlert, component: <ActionQueue actions={actions} loading={actionsLoading} onApprove={approveAction} onReject={rejectAction} onOverride={proposeOverride} /> },
    { id: 'trace', label: 'Booking Trace', icon: GitCommit, component: <BookingTrace initialCorrelationId={traceCorrelationId} /> },
    { id: 'media', label: 'Media Review', icon: Image, component: <MediaReview /> },
    { id: 'health', label: 'System Health', icon: Server, component: <SystemHealth /> },
  ];

  if (viewLegacyConsole) {
    return (
      <div className="bg-[#020617] min-h-screen text-slate-100">
        <div className="bg-slate-950/80 border-b border-slate-800 p-4 sticky top-0 z-[2000] backdrop-blur-md">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-400 animate-pulse" />
              <span className="font-bold text-sm text-cyan-400">Production Alignment Mode (Console Tools Active)</span>
            </div>
            <button 
              onClick={() => setViewLegacyConsole(false)}
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold px-4 py-2 rounded-lg flex items-center gap-1 transition-all"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Switch to Real-Time Event Dashboard
            </button>
          </div>
        </div>
        
        {/* Render the legacy console seamlessly */}
        <UnifiedAdminConsole />
      </div>
    );
  }

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
            {tabs.find((tab) => tab.id === activeTab)?.component}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminApp;
