import React, { useState } from 'react';
import { 
  Terminal, Search, ChevronDown, ChevronRight, Hash
} from 'lucide-react';
import { SystemEvent } from '../hooks/useEvents';
import EventCard from './EventCard';

interface EventInboxProps {
  events: SystemEvent[];
  loading: boolean;
  onSelectCorrelationId: (correlationId: string) => void;
}

export const EventInbox: React.FC<EventInboxProps> = ({ events, loading, onSelectCorrelationId }) => {
  const [search, setSearch] = useState<string>('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeFilter, setActiveFilter] = useState<string>('all');

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
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

  const groupedEvents = filteredEvents.reduce((acc: Record<string, SystemEvent[]>, current) => {
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
            const isGroupExpanded = expandedGroups[corrId];
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
                {hasCorrelation && (
                  <div 
                    onClick={() => toggleGroup(corrId)}
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

                <div className={`px-4 pb-3 space-y-2.5 ${hasCorrelation && !isGroupExpanded ? 'hidden' : 'pt-2'}`}>
                  {evts.map((evt) => (
                    <EventCard key={evt.event_id} event={evt} />
                  ))}
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
