import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import useEvents from './hooks/useEvents';
import useAdminActions, { AdminAction } from './hooks/useAdminActions';
import AdminLayout from './layout/AdminLayout';
import EventInbox from './components/EventInbox';
import AdminQueue from './components/AdminQueue';
import BookingTrace from './components/BookingTrace';
import MediaReview from './components/MediaReview';
import SystemHealth from './components/SystemHealth';
import UnifiedAdminConsole from '../components/UnifiedAdminConsole';

// Advanced Console Components
import { DecisionWorkbench } from './advanced/DecisionWorkbench';
import { BookingLifecycleInspector } from './advanced/BookingLifecycleInspector';
import { EventGraphExplorer } from './advanced/EventGraphExplorer';
import { EventReplayEngine } from './advanced/EventReplayEngine';
import { RootCauseAnalyzer } from './advanced/RootCauseAnalyzer';
import { SimulationEngine } from './advanced/SimulationEngine';
import { LiveSystemMap } from './advanced/LiveSystemMap';
import { SocialIntelligencePanel } from './advanced/SocialIntelligencePanel';
import { WeatherDiagnostics } from './advanced/WeatherDiagnostics';

import { 
  Shield, Terminal, ShieldAlert, GitCommit, Image, Server,
  ShieldCheck, Clock, Network, Cpu, Zap, Map, Sparkles, Activity
} from 'lucide-react';
import { Button } from '../components/ui/button';

export const AdminApp: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<string>('events');
  const [traceCorrelationId, setTraceCorrelationId] = useState<string>('');
  const [viewLegacyConsole, setViewLegacyConsole] = useState<boolean>(false);

  const { events, loading: eventsLoading } = useEvents();
  const { 
    actions, 
    loading: actionsLoading, 
    approveAction, 
    rejectAction, 
    proposeOverride
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

  const handleTraceCorrelation = (correlationId: string) => {
    setTraceCorrelationId(correlationId);
    setActiveTab('lifecycle_inspector');
  };

  const handleApproveAction = (action: AdminAction) => {
    approveAction(action.decision_id, action.correlation_id);
  };

  const handleRejectAction = (id: string, explanation: string, correlationId?: string) => {
    rejectAction(id, explanation, correlationId);
  };

  const handleOverrideBooking = (bookingId: string, newCapacity: number, explanation: string, correlationId?: string) => {
    proposeOverride(bookingId, newCapacity, explanation, correlationId);
  };

  const tabs = [
    // Legacy Dashboards
    { id: 'events', label: 'Event Inbox', icon: Terminal },
    { id: 'actions', label: 'Decisions Queue', icon: ShieldAlert },
    { id: 'trace', label: 'Booking Trace', icon: GitCommit },
    { id: 'media', label: 'Media Review', icon: Image },
    { id: 'health', label: 'System Health', icon: Server },
    
    // AI Operations Console Advanced Overlay
    { id: 'decision_workbench', label: 'Decision Workbench', icon: ShieldCheck },
    { id: 'lifecycle_inspector', label: 'Booking Lifecycle', icon: Clock },
    { id: 'graph_explorer', label: 'Event Graph Explorer', icon: Network },
    { id: 'replay_engine', label: 'Event Replay Engine', icon: Cpu },
    { id: 'root_cause', label: 'Root Cause Analyzer', icon: ShieldAlert },
    { id: 'simulation_engine', label: 'Simulation Sandbox', icon: Zap },
    { id: 'system_map', label: 'Live System Map', icon: Map },
    { id: 'social_intelligence', label: 'Social Intelligence', icon: Sparkles },
    { id: 'weather_diagnostics', label: 'Weather Diagnostics', icon: Activity }
  ];

  if (viewLegacyConsole) {
    return (
      <div className="bg-[#020617] min-h-screen text-slate-100">
        <div className="bg-slate-955/80 border-b border-slate-800 p-4 sticky top-0 z-[2000] backdrop-blur-md">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-400 animate-pulse" />
              <span className="font-bold text-sm text-cyan-400">Production Alignment Mode (Console Tools Active)</span>
            </div>
            <button 
              onClick={() => setViewLegacyConsole(false)}
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold px-4 py-2 rounded-lg flex items-center gap-1 transition-all"
            >
              Switch to Real-Time Event Dashboard
            </button>
          </div>
        </div>
        <UnifiedAdminConsole />
      </div>
    );
  }

  const renderActiveTabContent = () => {
    switch (activeTab) {
      // Legacy Dashboard Cases
      case 'events':
        return (
          <EventInbox 
            events={events} 
            loading={eventsLoading} 
            onSelectCorrelationId={handleTraceCorrelation} 
          />
        );
      case 'actions':
        return (
          <AdminQueue 
            actions={actions} 
            loading={actionsLoading} 
            onApprove={handleApproveAction} 
            onReject={handleRejectAction} 
            onOverride={handleOverrideBooking} 
          />
        );
      case 'trace':
        return <BookingTrace initialCorrelationId={traceCorrelationId} />;
      case 'media':
        return <MediaReview />;
      case 'health':
        return <SystemHealth />;
      
      // Advanced AI Console Cases
      case 'decision_workbench':
        return <DecisionWorkbench />;
      case 'lifecycle_inspector':
        return <BookingLifecycleInspector initialCorrelationId={traceCorrelationId} />;
      case 'graph_explorer':
        return <EventGraphExplorer />;
      case 'replay_engine':
        return <EventReplayEngine />;
      case 'root_cause':
        return <RootCauseAnalyzer />;
      case 'simulation_engine':
        return <SimulationEngine />;
      case 'system_map':
        return <LiveSystemMap />;
      case 'social_intelligence':
        return <SocialIntelligencePanel />;
      case 'weather_diagnostics':
        return <WeatherDiagnostics />;
      default:
        return null;
    }
  };

  return (
    <AdminLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      tabs={tabs}
      user={user}
      viewLegacyConsole={viewLegacyConsole}
      setViewLegacyConsole={setViewLegacyConsole}
    >
      {renderActiveTabContent()}
    </AdminLayout>
  );
};

export default AdminApp;
