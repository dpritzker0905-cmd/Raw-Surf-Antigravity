import React, { useState, useEffect } from 'react';

var LineupCountdown = ({ closesAt, isLight }) => {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  
  useEffect(() => {
    if (!closesAt) return;
    
    const updateTimer = () => {
      const now = new Date();
      const closes = new Date(closesAt);
      const diff = closes - now;
      
      if (diff <= 0) {
        setTimeLeft('Auto-locking...');
        setIsUrgent(true);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setTimeLeft(`${days}d ${hours % 24}h left`);
        setIsUrgent(false);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m left`);
        setIsUrgent(hours < 6);
      } else {
        setTimeLeft(`${minutes}m left`);
        setIsUrgent(true);
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [closesAt]);
  
  if (!closesAt) return null;
  
  const textColor = isUrgent ? 'text-red-400' : 'text-cyan-400';
  const bgColor = isUrgent 
    ? (isLight ? 'bg-red-50 border-red-200' : 'bg-red-500/10 border-red-500/30')
    : (isLight ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-500/30');
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${bgColor}`}>
      <Timer className={`w-4 h-4 ${textColor} ${isUrgent ? 'animate-pulse' : ''}`} />
      <span className={`text-sm font-medium ${textColor}`}>{timeLeft}</span>
    </div>
  );
};

// Auto-Fill Suggestions Panel

export default LineupCountdown;
