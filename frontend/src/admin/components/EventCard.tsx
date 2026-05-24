import React, { useState } from 'react';
import { 
  Zap, Calendar, DollarSign, Activity, AlertOctagon, Clock
} from 'lucide-react';
import { SystemEvent } from '../hooks/useEvents';

interface EventCardProps {
  event: SystemEvent;
}

export const EventCard: React.FC<EventCardProps> = ({ event }) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  const getEventIcon = (type: string) => {
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

  const eventDate = new Date(event.timestamp);
  const formattedTime = eventDate.toLocaleTimeString();

  return (
    <div className="bg-slate-955/40 border border-slate-900/60 rounded-md p-3 hover:bg-slate-950/80 transition-colors">
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex justify-between items-start cursor-pointer select-none"
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 border border-slate-800">
            {getEventIcon(event.event_type)}
          </span>
          <div>
            <div className="font-semibold text-sm text-slate-200">{event.event_type}</div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
              <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold text-slate-400">
                {event.source_service || event.source_mcp || 'spine'}
              </span>
              {event.user_id && <span>User: {event.user_id}</span>}
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

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-900">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-400">Event Payload:</span>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              Latency: {event.propagation_latency_ms || 2.5}ms
            </span>
          </div>
          <pre className="text-[11px] font-mono bg-slate-900 border border-slate-850 rounded p-2.5 overflow-x-auto text-slate-300">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default EventCard;
