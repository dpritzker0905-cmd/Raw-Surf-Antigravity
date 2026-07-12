import React, { useState, useEffect } from 'react';
import {
  Network, Search, Filter, ArrowRight, Share2, CreditCard, CloudSun, Image, ShieldCheck, GitCommit, Link, RefreshCw
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

interface EventNode {
  event_id: string;
  event_type: string;
  payload: string;
  timestamp: string;
  source_mcp: string;
  correlation_id: string;
}

export const EventGraphExplorer: React.FC = () => {
  const [events, setEvents] = useState<EventNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string>('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';
  const accentBg = dim ? 'bg-cyan-600/10' : 'bg-cyan-500/10';
  const accentBorder = dim ? 'border-cyan-600/30' : 'border-cyan-500/20';

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/events');
      if (res.data?.success) {
        setEvents(res.data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch events for graph:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const getDomain = (type: string): string => {
    if (type.includes('payment') || type.includes('checkout')) return 'payment';
    if (type.includes('weather') || type.includes('swell')) return 'weather';
    if (type.includes('media') || type.includes('gallery')) return 'media';
    if (type.includes('social') || type.includes('publish')) return 'social';
    if (type.includes('booking') || type.includes('check_in')) return 'booking';
    return 'system';
  };

  const getEventIcon = (domain: string) => {
    switch (domain) {
      case 'payment': return <CreditCard className={`w-4 h-4 ${dim ? 'text-emerald-600' : 'text-emerald-400'}`} />;
      case 'weather': return <CloudSun className={`w-4 h-4 ${dim ? 'text-amber-600' : 'text-amber-400'}`} />;
      case 'media': return <Image className={`w-4 h-4 ${dim ? 'text-purple-600' : 'text-purple-400'}`} />;
      case 'social': return <Share2 className={`w-4 h-4 ${accent}`} />;
      case 'booking': return <ShieldCheck className={`w-4 h-4 ${dim ? 'text-red-600' : 'text-red-400'}`} />;
      default: return <GitCommit className={`w-4 h-4 ${t.textSecondary}`} />;
    }
  };

  const getEventGlow = (domain: string) => {
    switch (domain) {
      case 'payment': return 'shadow-[0_0_15px_rgba(52,211,153,0.15)] border-emerald-500/30';
      case 'weather': return 'shadow-[0_0_15px_rgba(251,191,36,0.15)] border-amber-500/30';
      case 'media': return 'shadow-[0_0_15px_rgba(192,132,252,0.15)] border-purple-500/30';
      case 'social': return 'shadow-[0_0_15px_rgba(34,211,238,0.15)] border-cyan-500/30';
      case 'booking': return 'shadow-[0_0_15px_rgba(248,113,113,0.15)] border-red-500/30';
      default: return t.border;
    }
  };

  // Group events by correlation ID
  const groupedEvents: { [key: string]: EventNode[] } = {};
  events.forEach(evt => {
    const cId = evt.correlation_id || 'unassigned';
    if (!groupedEvents[cId]) {
      groupedEvents[cId] = [];
    }
    groupedEvents[cId].push(evt);
  });

  // Filter correlation chains
  const filteredChains = Object.entries(groupedEvents).filter(([cId, chain]) => {
    if (searchQuery && !cId.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (domainFilter !== 'all') {
      return chain.some(evt => getDomain(evt.event_type) === domainFilter);
    }
    return true;
  });

  const selectedChain = selectedCorrelationId ? groupedEvents[selectedCorrelationId] || [] : [];

  return (
    <div className={`${t.glassBg} backdrop-blur-md rounded-xl border p-6 shadow-2xl space-y-6`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center gap-2`}>
            <Network className={`w-5 h-5 ${accent}`} />
            Event Graph Explorer & Observability Layer
          </h2>
          <p className={`text-xs ${t.textSecondary} mt-1`}>
            Reconstruct and visualize existing system behavior as an interactive correlation graph overlay.
          </p>
        </div>

        <button
          onClick={fetchEvents}
          className={`flex items-center gap-1.5 ${t.cardBg} ${t.hoverBg} border ${t.border} ${t.textSecondary} text-xs font-semibold px-3 py-1.5 rounded-lg transition-all`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${accent}`} />
          Refresh Spine Logs
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar: Correlation Chains List */}
        <div className={`space-y-4 lg:col-span-1 border-r ${t.borderLight} pr-4`}>
          <div className="flex flex-col gap-2">
            <label className={`text-[10px] font-bold ${t.textMuted} uppercase tracking-wider`}>Search Trace Token</label>
            <div className="relative">
              <Search className={`absolute left-2.5 top-2.5 w-3.5 h-3.5 ${t.textMuted}`} />
              <input
                type="text"
                placeholder="Search corr_..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${t.inputBg} border text-xs px-8 py-2 rounded-lg ${t.textPrimary} focus:outline-none focus:border-cyan-500 w-full`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className={`text-[10px] font-bold ${t.textMuted} uppercase tracking-wider`}>Domain Category Filter</label>
            <div className="flex flex-wrap gap-1">
              {['all', 'booking', 'payment', 'weather', 'media', 'social'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setDomainFilter(cat)}
                  className={`text-[9px] font-extrabold uppercase px-2.5 py-1 rounded border transition-all ${
                    domainFilter === cat
                      ? `${accentBg} ${accent} ${accentBorder}`
                      : `bg-transparent ${t.textMuted} border-transparent hover:${t.textSecondary}`
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-bold ${t.textMuted} uppercase tracking-wider block`}>
              Active Correlation Groups ({filteredChains.length})
            </label>
            {loading ? (
              <div className="py-12 flex justify-center">
                <RefreshCw className={`w-5 h-5 animate-spin ${accent}`} />
              </div>
            ) : filteredChains.length === 0 ? (
              <div className={`text-center py-12 ${t.textMuted} text-xs`}>
                No matching correlation tokens found in recent event spine.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
                {filteredChains.map(([cId, chain]) => {
                  const isSelected = selectedCorrelationId === cId;
                  const firstType = chain[0]?.event_type.replace(/_/g, ' ');
                  return (
                    <button
                      key={cId}
                      onClick={() => setSelectedCorrelationId(cId)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex justify-between items-center text-xs ${
                        isSelected
                          ? `${accentBg} ${accentBorder} shadow-[0_0_15px_rgba(6,182,212,0.05)]`
                          : `${t.rowBg} ${t.borderLight} hover:${t.border} ${t.textSecondary}`
                      }`}
                    >
                      <div className="space-y-1 truncate max-w-[85%]">
                        <span className={`font-mono text-[10px] font-bold ${isSelected ? accent : t.textSecondary}`}>
                          {cId.substring(0, 18)}{cId.length > 18 ? '...' : ''}
                        </span>
                        <div className={`text-[9px] ${t.textMuted} truncate capitalize`}>
                          Root Event: {firstType}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-mono ${t.cardBg} px-1.5 py-0.5 rounded border ${t.borderLight} ${t.textSecondary} font-bold`}>
                          {chain.length}
                        </span>
                        <ArrowRight className={`w-3 h-3 ${t.textMuted}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main Panel: Interactive Node/Edge Canvas Visualizer */}
        <div className="lg:col-span-2 space-y-4">
          <div className={`${t.cardBgBorder} border rounded-xl p-4 flex flex-col justify-between min-h-[460px] relative overflow-hidden`}>

            {/* Background cyber grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b12_1px,transparent_1px),linear-gradient(to_bottom,#1e293b12_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

            {selectedCorrelationId ? (
              <div className="space-y-4 z-10 flex-1 flex flex-col justify-between">
                <div>
                  <div className={`flex justify-between items-center border-b ${t.borderLight} pb-3`}>
                    <div className="space-y-0.5">
                      <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest block`}>Active Causal Chain</span>
                      <h3 className={`text-xs font-mono font-bold ${accent} flex items-center gap-1.5`}>
                        <Link className="w-3.5 h-3.5" />
                        {selectedCorrelationId}
                      </h3>
                    </div>
                    <span className={`text-[9px] font-mono ${accentBg} ${accent} px-2 py-0.5 rounded border ${accentBorder} font-bold`}>
                      {selectedChain.length} Events Correlated
                    </span>
                  </div>
                </div>

                {/* Event Graph Map visualization (SVG) */}
                <div className="my-8 flex justify-center items-center relative min-h-[220px]">
                  <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                    {selectedChain.length > 1 && selectedChain.map((_, idx) => {
                      if (idx === selectedChain.length - 1) return null;
                      
                      // Draw smooth bezier curves connecting consecutive node bubbles
                      const total = selectedChain.length;
                      const segmentWidth = 100 / (total - 1);
                      const startPercent = idx * segmentWidth;
                      const endPercent = (idx + 1) * segmentWidth;
                      
                      const startX = `${10 + startPercent * 0.8}%`;
                      const endX = `${10 + endPercent * 0.8}%`;
                      const y = "50%";

                      return (
                        <g key={`edge-${idx}`}>
                          <line
                            x1={startX}
                            y1={y}
                            x2={endX}
                            y2={y}
                            stroke="#0ea5e9"
                            strokeWidth="2"
                            strokeOpacity="0.4"
                            strokeDasharray="4 4"
                            className="animate-[dash_2s_linear_infinite]"
                          />
                          <style>{`
                            @keyframes dash {
                              to {
                                stroke-dashoffset: -20;
                              }
                            }
                          `}</style>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Nodes list horizontally aligned */}
                  <div className="flex justify-between w-full px-8 relative z-10">
                    {selectedChain.map((evt, idx) => {
                      const domain = getDomain(evt.event_type);
                      return (
                        <div
                          key={evt.event_id}
                          className="flex flex-col items-center group relative cursor-pointer"
                          style={{ width: `${100 / selectedChain.length}%` }}
                        >
                          <div className={`w-9 h-9 rounded-full ${t.cardBgBorder} border flex items-center justify-center transition-all duration-300 group-hover:scale-110 z-10 ${getEventGlow(domain)}`}>
                            {getEventIcon(domain)}
                          </div>

                          <span className={`text-[9px] font-mono font-bold ${t.textSecondary} mt-2 text-center truncate max-w-full px-1 uppercase tracking-tight block`}>
                            {evt.event_type.replace(/_/g, ' ').substring(0, 16)}
                          </span>

                          <span className={`text-[8px] font-mono ${t.textMuted} mt-0.5 block`}>
                            {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>

                          {/* Hover Tooltip card details */}
                          <div className={`absolute top-12 scale-0 group-hover:scale-100 transition-all origin-top ${t.cardBgBorder} border text-[9px] p-3 rounded-lg w-48 shadow-2xl z-30 font-mono space-y-1 text-left pointer-events-none`}>
                            <div className={`${accent} font-bold border-b ${t.borderLight} pb-1 mb-1 uppercase text-[8px]`}>
                              {evt.event_type.replace(/_/g, ' ')}
                            </div>
                            <div><span className={t.textMuted}>ID:</span> <span className={t.textSecondary}>{evt.event_id.substring(0, 8)}...</span></div>
                            <div><span className={t.textMuted}>Time:</span> <span className={t.textSecondary}>{new Date(evt.timestamp).toLocaleTimeString()}</span></div>
                            <div><span className={t.textMuted}>MCP Source:</span> <span className={t.textSecondary}>{evt.source_mcp}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Subsystem explanation flow list */}
                <div className="space-y-2">
                  <h4 className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest`}>Chronological Node Ledger</h4>
                  <div className="space-y-1.5 max-h-[140px] overflow-y-auto scrollbar-thin pr-1">
                    {selectedChain.map((evt, idx) => {
                      const domain = getDomain(evt.event_type);
                      return (
                        <div
                          key={evt.event_id}
                          className={`${t.rowBg} border ${t.borderLight} rounded px-3 py-2 flex items-center justify-between text-[10px] font-mono`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={t.textMuted}>#{idx + 1}</span>
                            {getEventIcon(domain)}
                            <span className={`${t.textSecondary} font-bold uppercase`}>{evt.event_type.replace(/_/g, ' ')}</span>
                          </div>
                          <div className={`flex items-center gap-4 ${t.textMuted}`}>
                            <span>{evt.source_mcp}</span>
                            <span>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 z-10">
                <Network className={`w-12 h-12 ${t.textMuted} animate-pulse mb-3`} />
                <h4 className={`${t.textSecondary} font-semibold text-xs mb-1`}>Causal Graph Viewer Active</h4>
                <p className={`text-[10px] ${t.textMuted} max-w-xs`}>
                  Select an active correlation trace from the ledger sidebar to reconstruct, track and visualize its causal node pipeline.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventGraphExplorer;
