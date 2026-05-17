import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Watch, Smartphone, MapPin, ChevronRight, PenTool } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { LocationPicker } from './LocationPicker';

const PreSessionConfigModal = ({ isOpen, onClose, onStartLive, onSyncWatch, onManualEntry }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const bg = isLight ? 'bg-white' : 'bg-zinc-900';
  const text = isLight ? 'text-gray-900' : 'text-white';
  const subtext = isLight ? 'text-gray-500' : 'text-gray-400';

  const [selectedBoard, setSelectedBoard] = useState('');
  const [detectedLocation, setDetectedLocation] = useState(null);
  const [isSearchingGps, setIsSearchingGps] = useState(true);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  
  // Mock profile quiver for now (to be fetched from user profile)
  const profileQuiver = ["6'2 Shortboard", "9'0 Longboard", "5'8 Fish"];

  useEffect(() => {
    if (isOpen && !detectedLocation) {
      setIsSearchingGps(true);
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            try {
              const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
              const data = await res.json();
              if (data && data.address) {
                const spotName = data.address.beach || data.address.suburb || data.address.town || data.address.city || data.display_name.split(',')[0];
                setDetectedLocation({ lat: latitude, lng: longitude, name: spotName });
              } else {
                setDetectedLocation({ lat: latitude, lng: longitude, name: "Current Location" });
              }
            } catch (e) {
              setDetectedLocation({ lat: latitude, lng: longitude, name: "GPS Location Found" });
            }
            setIsSearchingGps(false);
          },
          (error) => {
            setIsSearchingGps(false);
            // Ignore error, they can pick manually
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      } else {
        setIsSearchingGps(false);
      }
    }
  }, [isOpen, detectedLocation]);

  const handleLocationSelected = async (loc) => {
    setIsSearchingGps(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}`);
      const data = await res.json();
      if (data && data.address) {
        const spotName = data.address.beach || data.address.suburb || data.address.town || data.address.city || data.display_name.split(',')[0];
        setDetectedLocation({ lat: loc.lat, lng: loc.lng, name: spotName });
      } else {
        setDetectedLocation({ lat: loc.lat, lng: loc.lng, name: "Selected Location" });
      }
    } catch (e) {
      setDetectedLocation({ lat: loc.lat, lng: loc.lng, name: "Selected Location" });
    }
    setIsSearchingGps(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${bg} border-zinc-800 max-w-sm rounded-2xl max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={`text-xl font-bold ${text} text-center`}>Start Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Gear Selection */}
          <div className="space-y-2">
            <p className={`text-sm font-medium ${text}`}>Select Gear</p>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {profileQuiver.map(board => (
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
          <button 
            onClick={() => setLocationPickerOpen(true)}
            className={`w-full p-3 rounded-xl flex items-center justify-between text-left transition-all ${isLight ? 'bg-blue-50/50 hover:bg-blue-50' : 'bg-blue-500/5 hover:bg-blue-500/10'}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className={`text-xs ${subtext}`}>Location</p>
                <p className={`text-sm font-semibold ${text}`}>
                  {isSearchingGps ? 'Searching GPS...' : (detectedLocation?.name || 'Tap to set location')}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-blue-500 opacity-50" />
          </button>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => onStartLive(selectedBoard, detectedLocation)}
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

            <button
              onClick={() => onManualEntry(selectedBoard, detectedLocation)}
              className={`w-full group flex items-center justify-between p-4 rounded-xl border transition-all ${isLight ? 'border-gray-200 hover:border-orange-500 hover:shadow-sm' : 'border-zinc-800 hover:border-orange-500 hover:bg-zinc-800/50'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <PenTool className="w-5 h-5 text-orange-400" />
                </div>
                <div className="text-left">
                  <h3 className={`font-semibold ${text}`}>Manual Entry</h3>
                  <p className={`text-xs ${subtext}`}>Log a past session</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-orange-500 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </DialogContent>

      <LocationPicker 
        isOpen={locationPickerOpen} 
        onClose={() => setLocationPickerOpen(false)} 
        onLocationSelected={handleLocationSelected} 
      />
    </Dialog>
  );
};

export default PreSessionConfigModal;
