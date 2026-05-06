import React from 'react';
import { Plus } from 'lucide-react';

const EmptySeat = ({ seatNumber, isLight, onClick }) => {
  const textSecondary = isLight ? 'text-gray-400' : 'text-gray-500';
  
  // Empty seat surfboard colors (desaturated/ghost colors)
  const emptyBoardColors = [
    { fill: '#94A3B8', stroke: '#64748B' }, // Slate
    { fill: '#A1A1AA', stroke: '#71717A' }, // Gray
    { fill: '#9CA3AF', stroke: '#6B7280' }, // Cool gray
  ];
  const boardColor = emptyBoardColors[(seatNumber - 1) % emptyBoardColors.length];
  
  return (
    <div className="relative group cursor-pointer" onClick={onClick}>
      {/* Ghost Surfboard */}
      <div className="relative">
        <svg 
          viewBox="0 0 60 100" 
          className="absolute left-1/2 -translate-x-1/2 top-4 w-16 h-24 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
        >
          {/* Surfboard shape - dashed outline */}
          <ellipse 
            cx="30" 
            cy="50" 
            rx="14" 
            ry="42" 
            fill="none"
            stroke={boardColor.stroke}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          {/* Stringer line */}
          <line 
            x1="30" 
            y1="14" 
            x2="30" 
            y2="86" 
            stroke={boardColor.stroke}
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
          />
        </svg>
        
        {/* Empty seat circle */}
        <div className={`relative z-10 w-14 h-14 rounded-full border-2 border-dashed ${
          isLight ? 'border-cyan-300 bg-cyan-50/50' : 'border-cyan-500/50 bg-cyan-500/10'
        } flex items-center justify-center transition-all group-hover:scale-105 group-hover:border-cyan-400`}>
          {/* Plus icon */}
          <svg viewBox="0 0 24 24" className={`w-6 h-6 ${textSecondary} group-hover:text-cyan-400 transition-colors`}>
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      
      {/* Label - pushed down to match filled seats */}
      <div className="text-center mt-10">
        <p className={`text-xs ${textSecondary}`}>Open #{seatNumber}</p>
        <Badge className="text-[10px] px-1.5 py-0 bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          Paddle Out
        </Badge>
      </div>
    </div>
  );
};

// Quick Actions Panel - Poker-style control bar

export default EmptySeat;
