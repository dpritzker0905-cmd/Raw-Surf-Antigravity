import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';


const EphemeralCountdown = ({ createdAt }) => {
  const EPHEMERAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const calcRemaining = () => {
    const startTime = createdAt ? new Date(createdAt).getTime() : Date.now();
    return EPHEMERAL_MS - (Date.now() - startTime);
  };

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    // Tick every 30 seconds (videos don't need per-second precision)
    const interval = setInterval(() => {
      const r = calcRemaining();
      setRemaining(r);
      if (r <= 0) clearInterval(interval); // Stop when expired
    }, 30000);
    return () => clearInterval(interval);
  }, [createdAt]); // eslint-disable-line

  if (remaining <= 0) {
    return (
      <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 z-10 pointer-events-none">
        <Clock className="w-3 h-3 text-gray-400" />
        <span className="text-gray-300 text-[10px] font-bold">Expired</span>
      </div>
    );
  }

  const h = Math.floor(remaining / (1000 * 60 * 60));
  const m = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;

  return (
    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded flex items-center gap-1 z-10 pointer-events-none animate-pulse">
      <Clock className="w-3 h-3 text-red-400" />
      <span className="text-white text-[10px] font-bold">{label}</span>
    </div>
  );
};

export default EphemeralCountdown;
