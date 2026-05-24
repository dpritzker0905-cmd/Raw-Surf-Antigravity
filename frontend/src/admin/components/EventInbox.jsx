import React, { useState } from 'react';
import { 
  Zap, Calendar, DollarSign, Activity, AlertOctagon, Terminal, Search, ChevronDown, ChevronRight, Hash, Clock
} from 'lucide-react';

export const EventInbox = ({ events, loading, onSelectCorrelationId }) => {
  const [search, setSearch] = useState('');
  const [expandedEvents, setExpandedEvents] = useState({});
  const [activeFilter, setActiveFilter] = useState('all');

  const toggleExpand = (id) => {
    setExpandedEvents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getEventIcon = (type) => {
    switch (type) {
      case 'booking_created':
      case 'booking_confirmed':
        return <Calendar className="w-4 h-4 text-cyan-400 animate-pulse" />;
      case 'payment_success':
        return <DollarSign className="w-4 h-4 text-emerald-400" />;
      case 'payment_failed':
        return <AlertOctagon className="w-4 h-4 text-red-500 animate-bounce" />;
      case 'weather_updated':
      case 'surf_quality_updated':
        return <Activity className="w-4 h-4 text-amber-400" />;
      case 'system_error':
        return <AlertOctagon className="w-4 h-4 text-red-500" />;
      default:
        return <Zap className="w-4 h-4 text-yellow-400" />;
    }
  };

  const filteredEvents = events.filter(e => {
    const matchesSearch = 
      e.event_type.toLowerCase().includes(search.toLowerCase()) ||
      (e.correlation_id && e.correlation_id.toLowerCase().includes(search.toLowerCase())) ||
      (e.user_id && e.user_id.toLowerCase().includes(search.toLowerCase()));
      
    if (activeFilter === 'all') return matchesSearch;
    if (activeFilter === 'errors') return matchesSearch && e.event_type === 'system_error';
    if (activeFilter === 'bookings') return matchesSearch && e.event_type.includes('booking');
    if (activeFilter === 'payments') return matchesSearch && e.event_type.includes('payment');
    return matchesSearch;
  });

  // Group events by correlation ID
  const groupedEvents = filteredEvents.reduce((acc, current) => {
    const cId = current.correlation_id || 'no_correlation';
    if (!acc[cId]) {
      acc[cId] = [];
    }
    acc[cId].push(current);
    return acc;
  }, {});

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            Event Inbox (Real-Time Spine)
          </h2>
          <p className="text-sm text-slate-400 mt-1">Live feed of global social marketplace operations</p>
        </div>
        
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-2">
          {['all', 'bookings', 'payments', 'errors'].map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-3 py-1 text-xs font-semibold rounded-full capitalize transition-all ${
                activeFilter === filter
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by event_type, correlation_id, user_id..."
          className="w-full bg-slate-900/60 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No events found in the local Event Spine cache.
        </div>
      ) : (
        <div className="space-y-4 max-h-[550px] overflow-y-auto pr-2 scrollbar-thin">
          {Object.entries(groupedEvents).map(([corrId, evts]) => {
            const isGroupExpanded = expandedEvents[corrId];
            const hasCorrelation = corrId !== 'no_correlation';
            
            return (
              <div 
                key={corrId} 
                className={`rounded-lg border transition-all ${
                  hasCorrelation 
                    ? 'bg-slate-900/40 border-slate-800 hover:border-slate-700' 
                    : 'bg-transparent border-transparent'
                }`}
              >
                {/* Correlation header */}
                {hasCorrelation && (
                  <div 
                    onClick={() => toggleExpand(corrId)}
                    className="flex justify-between items-center p-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      {isGroupExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      )}
                      <div className="flex items-center gap-1.5 bg-slate-850 px-2 py-0.5 rounded text-xs text-cyan-400 border border-cyan-500/10">
                        <Hash className="w-3 h-3" />
                        {corrId.slice(0, 15)}...
                      </div>
                      <span className="text-xs text-slate-500">({evts.length} linked events)</span>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCorrelationId(corrId);
                      }}
                      className="text-xs text-cyan-400 hover:underline hover:text-cyan-300"
                    >
                      Trace Flow
                    </button>
                  </div>
                )}

                {/* Event lists */}
                <div className={`px-4 pb-3 space-y-2.5 ${hasCorrelation && !isGroupExpanded ? 'hidden' : 'pt-2'}`}>
                  {evts.map((evt) => {
                    const isEvtExpanded = expandedEvents[evt.event_id];
                    const eventDate = new Date(evt.timestamp);
                    const formattedTime = eventDate.toLocaleTimeString();

                    return (
                      <div 
                        key={evt.event_id} 
                        className="bg-slate-950/40 border border-slate-900/60 rounded-md p-3 hover:bg-slate-950/80 transition-colors"
                      >
                        <div 
                          onClick={() => toggleExpand(evt.event_id)}
                          className="flex justify-between items-start cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 border border-slate-800">
                              {getEventIcon(evt.event_type)}
                            </span>
                            <div>
                              <div className="font-semibold text-sm text-slate-200">{evt.event_type}</div>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                                <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold text-slate-400">
                                  {evt.source_mcp || 'spine'}
                                </span>
                                {evt.user_id && <span>User: {evt.user_id}</span>}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                              <Clock className="w-3 h-3" />
                              {formattedTime}
                            </span>
                          </div>
                        </div>

                        {/* Expandable JSON Payload view */}
                        {isEvtExpanded && (
                          <div className="mt-3 pt-3 border-t border-slate-900">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-slate-400">Event Payload:</span>
                              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                Latency: {evt.propagation_latency_ms || 2.5}ms
                              </span>
                            </div>
                            <pre className="text-[11px] font-mono bg-slate-900 border border-slate-850 rounded p-2.5 overflow-x-auto text-slate-300">
                              {JSON.stringify(evt.payload, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EventInbox;
