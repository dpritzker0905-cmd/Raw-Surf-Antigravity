import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Watch, Smartphone, MapPin, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const PreSessionConfigModal = ({ isOpen, onClose, onStartLive, onSyncWatch }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const bg = isLight ? 'bg-white' : 'bg-zinc-900';
  const text = isLight ? 'text-gray-900' : 'text-white';
  const subtext = isLight ? 'text-gray-500' : 'text-gray-400';

  const [selectedBoard, setSelectedBoard] = useState('');
  // Mock quiver for now
  const quiver = ["6'2 Shortboard", "9'0 Longboard", "5'8 Fish"];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${bg} border-zinc-800 max-w-sm rounded-2xl`}>
        <DialogHeader>
          <DialogTitle className={`text-xl font-bold ${text} text-center`}>Start Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Gear Selection */}
          <div className="space-y-2">
            <p className={`text-sm font-medium ${text}`}>Select Gear</p>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {quiver.map(board => (
                <button
                  key={board}
                  onClick={() => setSelectedBoard(board)}
                  className={`px-4 py-2 rounded-full whitespace-nowrap text-sm transition-all ${selectedBoard === board ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' : isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'}`}
                >
                  {String.fromCodePoint(0x1F3C4)} {board}
                </button>
              ))}
            </div>
          </div>

          {/* Location auto-detect preview */}
          <div className={`p-3 rounded-xl flex items-center gap-3 ${isLight ? 'bg-blue-50/50' : 'bg-blue-500/5'}`}>
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className={`text-xs ${subtext}`}>Auto-detected Spot</p>
              <p className={`text-sm font-semibold ${text}`}>Searching GPS...</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => onStartLive(selectedBoard)}
              className={`w-full group flex items-center justify-between p-4 rounded-xl border transition-all ${isLight ? 'border-gray-200 hover:border-cyan-500 hover:shadow-sm' : 'border-zinc-800 hover:border-cyan-500 hover:bg-zinc-800/50'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="text-left">
                  <h3 className={`font-semibold ${text}`}>Live Phone Track</h3>
                  <p className={`text-xs ${subtext}`}>Put phone in waterproof pouch</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-cyan-500 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={onSyncWatch}
              className={`w-full group flex items-center justify-between p-4 rounded-xl border transition-all ${isLight ? 'border-gray-200 hover:border-purple-500 hover:shadow-sm' : 'border-zinc-800 hover:border-purple-500 hover:bg-zinc-800/50'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                  <Watch className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-left">
                  <h3 className={`font-semibold ${text}`}>Sync Smartwatch</h3>
                  <p className={`text-xs ${subtext}`}>Apple Watch / Garmin</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-purple-500 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PreSessionConfigModal;
