import React, { useState } from 'react';
import {
  Zap, Slider, ToggleLeft, ShieldAlert, Play, CheckCircle2, TrendingUp, HelpCircle, Terminal, CloudSun, CreditCard, Users, Share2
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';
import { toast } from 'sonner';

interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  icon: any;
  color: string;
}

export const SimulationEngine: React.FC = () => {
  const [activeScenario, setActiveScenario] = useState<string>('booking');
  const [capacitySlider, setCapacitySlider] = useState<number>(30);
  const [swellHeight, setSwellHeight] = useState<number>(4.5); // meters
  const [priceModifier, setPriceModifier] = useState<number>(1.0); // multiplier
  const [simulateLatency, setSimulateLatency] = useState<boolean>(false);
  
  const [simLogs, setSimLogs] = useState<string[]>([
    'Sandbox simulation database initialized in isolated RAM state.',
    'System ready to compute hypothetical trajectories.'
  ]);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';

  const scenarios: SimulationScenario[] = [
    {
      id: 'booking',
      name: 'Booking Flow',
      description: 'Hypothetical check-ins under custom surfer capacities and spot limitations.',
      icon: Users,
      color: dim ? 'text-cyan-600 border-cyan-600/20 bg-cyan-600/5' : 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5'
    },
    {
      id: 'payment',
      name: 'Payment Processor',
      description: 'Stripe webhook failures, decline rates, and multi-currency transactions.',
      icon: CreditCard,
      color: dim ? 'text-emerald-600 border-emerald-600/20 bg-emerald-600/5' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'
    },
    {
      id: 'weather',
      name: 'Weather Swell Spike',
      description: 'Swell spikes, wind directions, and real-time alert triggers.',
      icon: CloudSun,
      color: dim ? 'text-amber-600 border-amber-600/20 bg-amber-600/5' : 'text-amber-400 border-amber-500/20 bg-amber-500/5'
    },
    {
      id: 'social',
      name: 'Social Propagation',
      description: 'Social sharing engagement velocity and user reaction multipliers.',
      icon: Share2,
      color: dim ? 'text-purple-600 border-purple-600/20 bg-purple-600/5' : 'text-purple-400 border-purple-500/20 bg-purple-500/5'
    }
  ];

  const handleSimulate = () => {
    setIsSimulating(true);
    setSimLogs(prev => [...prev, `[SIMULATE] Spawning hypothetical ${activeScenario} thread...`]);

    setTimeout(() => {
      let results: string[] = [];
      if (activeScenario === 'booking') {
        const potentialRevenue = Math.round(capacitySlider * 45 * priceModifier);
        const failChance = capacitySlider > 45 ? 65 : 5;
        results = [
          `Calculated slot request rate: ${(capacitySlider * 1.4).toFixed(1)} bookings/min`,
          `Hypothetical aggregate daily revenue yield: $${potentialRevenue}`,
          `Calculated transaction deadlock risk level: ${failChance > 50 ? 'HIGH' : 'LOW'} (${failChance}%)`,
          `Check-in capacity constraints: OK (within aligned surfer boundaries)`
        ];
      } else if (activeScenario === 'payment') {
        results = [
          `Mocking Stripe webhook handshake sequence...`,
          `Webhook delivery propagation latency: ${simulateLatency ? '425ms (SIMULATED SPIKE)' : '14ms'}`,
          `Simulated merchant reconciliation rate: 98.4%`,
          `Isolated sandbox payment records successfully finalized in memory.`
        ];
      } else if (activeScenario === 'weather') {
        const difficulty = swellHeight > 6 ? 'Extreme (Double Overhead)' : swellHeight > 3.5 ? 'Moderate (Overhead)' : 'Light';
        const recommendation = swellHeight > 5 ? 'Trigger Surf Alert Activation proposal' : 'No alert modifications recommended';
        results = [
          `NOAA swell telemetry parsed: ${swellHeight}m at 14s intervals`,
          `Wave impact category classification: ${difficulty}`,
          `Active recommendation: ${recommendation}`,
          `Mock weather update dispatched to local sandbox memory bus.`
        ];
      } else if (activeScenario === 'social') {
        const reaches = Math.round(3500 * priceModifier);
        results = [
          `Simulating completed surf session highlight upload...`,
          `Estimated initial surfer impression reach: ${reaches} users`,
          `Calculated feed sharing velocity multiplier: 1.8x`,
          `Engagement coefficient score: 92/100`
        ];
      }

      setSimLogs(prev => [
        ...prev,
        ...results.map(r => `[SANDBOX] ${r}`),
        `[SIMULATE] Simulated ${activeScenario} completed successfully.`
      ]);
      setIsSimulating(false);
      toast.success('Simulation run successfully computed!', { id: 'sim-toast' });
    }, 1200);
  };

  const clearLogs = () => {
    setSimLogs([
      'Sandbox simulation database initialized in isolated RAM state.',
      'System ready to compute hypothetical trajectories.'
    ]);
  };

  return (
    <div className={`${t.glassBg} backdrop-blur-md rounded-xl border p-6 shadow-2xl space-y-6`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center gap-2`}>
            <Zap className={`w-5 h-5 ${accent}`} />
            System Simulation Engine (Sandbox)
          </h2>
          <p className={`text-xs ${t.textSecondary} mt-1`}>
            Static demo: every number below is computed locally in the browser from inline formulas.
            No backend call, no real system data, no database read or write of any kind.
          </p>
        </div>

        {/* Warning label */}
        <span className={`text-[10px] ${dim ? 'bg-red-600/10 border-red-600/20 text-red-600' : 'bg-red-500/10 border-red-500/20 text-red-400'} border px-3 py-1 rounded-lg uppercase font-bold tracking-wider flex items-center gap-1.5 self-start md:self-auto`}>
          <ShieldAlert className="w-3.5 h-3.5" />
          Local Demo — No Backend
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left sidebar: select scenario & configuration sliders */}
        <div className={`space-y-5 lg:col-span-1 border-r ${t.borderLight} pr-4`}>
          <div className="space-y-2">
            <label className={`text-[10px] font-bold ${t.textMuted} uppercase tracking-wider block`}>
              1. Choose Sandboxed Scenario
            </label>
            <div className="space-y-2">
              {scenarios.map(sc => {
                const Icon = sc.icon;
                const isActive = activeScenario === sc.id;
                return (
                  <button
                    key={sc.id}
                    onClick={() => {
                      setActiveScenario(sc.id);
                      setSimLogs(prev => [...prev, `[SYSTEM] Switched sandboxed context to: ${sc.name}`]);
                    }}
                    className={`w-full text-left p-3.5 rounded-lg border transition-all flex items-start gap-3 ${
                      isActive
                        ? `${dim ? 'bg-cyan-600/10 border-cyan-600/30' : 'bg-cyan-500/10 border-cyan-500/30'}`
                        : `${t.rowBg} ${t.borderLight} hover:${t.border}`
                    }`}
                  >
                    <div className={`p-1.5 rounded border ${sc.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <h4 className={`text-xs font-bold ${isActive ? accent : t.textPrimary}`}>{sc.name}</h4>
                      <p className={`text-[10px] ${t.textMuted} leading-tight`}>{sc.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration controls */}
          <div className="space-y-4 pt-2">
            <label className={`text-[10px] font-bold ${t.textMuted} uppercase tracking-wider block`}>
              2. Adjust Mock Parameters
            </label>

            {/* Slider 1: Surfers capacity */}
            {activeScenario === 'booking' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className={`${t.textSecondary} font-bold`}>MOCK CAPACITY</span>
                  <span className={`${accent} font-extrabold`}>{capacitySlider} Surfers</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={capacitySlider}
                  onChange={(e) => setCapacitySlider(Number(e.target.value))}
                  className={`w-full h-1 ${t.cardBg} rounded-lg appearance-none cursor-pointer accent-cyan-400`}
                />
              </div>
            )}

            {/* Slider 2: Swell Height */}
            {activeScenario === 'weather' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className={`${t.textSecondary} font-bold`}>SWELL AMPLITUDE</span>
                  <span className={`${dim ? 'text-amber-600' : 'text-amber-400'} font-extrabold`}>{swellHeight.toFixed(1)}m</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="0.5"
                  value={swellHeight}
                  onChange={(e) => setSwellHeight(Number(e.target.value))}
                  className={`w-full h-1 ${t.cardBg} rounded-lg appearance-none cursor-pointer accent-amber-400`}
                />
              </div>
            )}

            {/* Price Modifer (all except weather maybe) */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-mono">
                <span className={`${t.textSecondary} font-bold`}>HYPOTHETICAL PRICING MULTIPLIER</span>
                <span className={`${dim ? 'text-purple-600' : 'text-purple-400'} font-extrabold`}>{priceModifier.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={priceModifier}
                onChange={(e) => setPriceModifier(Number(e.target.value))}
                className={`w-full h-1 ${t.cardBg} rounded-lg appearance-none cursor-pointer accent-purple-400`}
              />
            </div>

            {/* Simulate Latency flag */}
            <div className={`flex items-center justify-between py-2 border-t ${t.borderLight}`}>
              <span className={`text-[10px] font-bold ${t.textSecondary} uppercase`}>Simulate Net Lag</span>
              <button
                onClick={() => setSimulateLatency(!simulateLatency)}
                className={`w-9 h-5 rounded-full p-0.5 transition-all ${
                  simulateLatency ? 'bg-cyan-500 flex justify-end' : `${t.cardBg} border ${t.border} flex justify-start`
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded-full ${simulateLatency ? 'bg-slate-950' : t.avatarBg}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Right main panel: sandboxed simulation output logs terminal */}
        <div className="lg:col-span-2 space-y-4">
          <div className={`${t.cardBgBorder} border rounded-xl p-5 flex flex-col justify-between min-h-[420px] shadow-2xl relative overflow-hidden font-mono text-xs`}>

            <div className="space-y-3 z-10 flex-1 flex flex-col justify-between">
              <div className={`flex justify-between items-center border-b ${t.borderLight} pb-2`}>
                <span className={`text-[9px] font-bold ${t.textMuted} uppercase tracking-widest flex items-center gap-1.5`}>
                  <Terminal className={`w-3.5 h-3.5 ${accent}`} />
                  Isolated Sandbox Terminal Log
                </span>
                <button
                  onClick={clearLogs}
                  className={`text-[9px] ${t.textMuted} hover:${t.textSecondary} font-extrabold uppercase transition-all`}
                >
                  Clear Console
                </button>
              </div>

              {/* Log ledger */}
              <div className={`flex-1 my-4 space-y-1.5 overflow-y-auto max-h-[260px] scrollbar-thin pr-1 text-[11px] ${t.textSecondary}`}>
                {simLogs.map((log, idx) => {
                  let color = t.textSecondary;
                  if (log.includes('[SIMULATE]')) color = `${accent} font-bold`;
                  if (log.includes('[SANDBOX]')) color = dim ? 'text-emerald-600' : 'text-emerald-400';
                  if (log.includes('[SYSTEM]')) color = dim ? 'text-purple-600' : 'text-purple-400';

                  return (
                    <div key={idx} className={`leading-relaxed ${color}`}>
                      <span className={`${t.textMuted} mr-2 font-bold select-none`}>&gt;&gt;</span>
                      {log}
                    </div>
                  );
                })}
                {isSimulating && (
                  <div className={`${accent} font-bold animate-pulse flex items-center gap-1.5`}>
                    <span className={`${t.textMuted} mr-2 select-none`}>&gt;&gt;</span>
                    Computing multi-variable trajectories...
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className={`border-t ${t.borderLight} pt-4 z-10 flex justify-end`}>
              <button
                disabled={isSimulating}
                onClick={handleSimulate}
                className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-lg flex items-center gap-1.5 transition-all shadow-lg shadow-cyan-500/10"
              >
                <Play className="w-3.5 h-3.5 fill-slate-950" />
                Run Sandbox Simulation
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default SimulationEngine;
