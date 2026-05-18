import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { UploadCloud, FileType2, Loader2, CheckCircle2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';

// Simplified Haversine for parser
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

const GpxUploadModal = ({ isOpen, onClose, onParsed }) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isLight = theme === 'light';
  const fileInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [isStravaConnected, setIsStravaConnected] = useState(false);
  const [checkingStrava, setCheckingStrava] = useState(false);

  const userId = user?.id;

  useEffect(() => {
    if (isOpen) {
      checkStravaConnection();
    }
  }, [isOpen]);

  const checkStravaConnection = async () => {
    setCheckingStrava(true);
    try {
      const res = await apiClient.get(`/strava/status?user_id=${userId}`);
      setIsStravaConnected(res.data.connected);
    } catch (err) {
      console.error("Failed to check Strava status", err);
    } finally {
      setCheckingStrava(false);
    }
  };

  const parseGPX = (xmlText) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const trkpts = xmlDoc.getElementsByTagName("trkpt");

      if (trkpts.length === 0) {
        throw new Error("No tracking points found in file.");
      }

      let distance = 0;
      let topSpeed = 0;
      let waveCount = 0;
      
      const startTime = new Date(trkpts[0].getElementsByTagName("time")[0]?.textContent || Date.now());
      const endTime = new Date(trkpts[trkpts.length - 1].getElementsByTagName("time")[0]?.textContent || Date.now());
      const duration_minutes = (endTime - startTime) / 60000;

      for (let i = 1; i < trkpts.length; i++) {
        const lat1 = parseFloat(trkpts[i-1].getAttribute("lat"));
        const lon1 = parseFloat(trkpts[i-1].getAttribute("lon"));
        const t1 = new Date(trkpts[i-1].getElementsByTagName("time")[0]?.textContent).getTime();

        const lat2 = parseFloat(trkpts[i].getAttribute("lat"));
        const lon2 = parseFloat(trkpts[i].getAttribute("lon"));
        const t2 = new Date(trkpts[i].getElementsByTagName("time")[0]?.textContent).getTime();

        const dist = getDistance(lat1, lon1, lat2, lon2);
        distance += dist;

        const timeDiffSec = (t2 - t1) / 1000;
        if (timeDiffSec > 0) {
          const speed = dist / timeDiffSec; // m/s
          if (speed > topSpeed) topSpeed = speed;
          if (speed > 4.0 && dist > 10) waveCount++; // Naive heuristic
        }
      }

      return { distance, topSpeed, waveCount: Math.floor(waveCount / 5), duration_minutes };
    } catch (e) {
      console.error(e);
      throw new Error("Failed to parse GPX data.");
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setParsing(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const metrics = parseGPX(event.target.result);
        onParsed(metrics);
        toast.success("Watch data synced successfully!");
      } catch (err) {
        toast.error(err.message);
      } finally {
        setParsing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleStravaSync = async () => {
    setParsing(true);
    try {
      if (!isStravaConnected) {
        // Step 1: User is not connected, start OAuth Flow
        const redirectUri = encodeURIComponent(`${window.location.origin}/surf-log`);
        const res = await apiClient.get(`/strava/auth-url?user_id=${userId}&redirect_uri=${redirectUri}`);
        window.location.href = res.data.url; // Redirects out of the app to Strava
        return;
      }
      
      // Step 2: User is connected, sync data
      const res = await apiClient.get(`/strava/sync-recent?user_id=${userId}`);
      const metrics = res.data;
      onParsed(metrics);
 toast.success("Strava data synced successfully! =");
      onClose(); // Close modal on success
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to sync with Strava.");
      // If unauthorized, reset connection state
      if (err.response?.status === 401) {
        setIsStravaConnected(false);
      }
    } finally {
      setParsing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-sm rounded-2xl`}>
        <DialogHeader>
          <DialogTitle className={`text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} text-center`}>Sync Smartwatch</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-6 text-center space-y-6">
          <div className="w-full space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-orange-500/10 flex items-center justify-center relative">
              <svg className="w-8 h-8 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
              </svg>
              {isStravaConnected && (
                <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
              )}
            </div>
            
            <div>
              <h3 className={`font-semibold ${isLight ? 'text-gray-800' : 'text-gray-200'}`}>
                {isStravaConnected ? 'Strava Connected' : 'Connect with Strava'}
              </h3>
              <p className={`text-xs mt-1 px-4 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                {isStravaConnected 
                  ? 'Your account is linked. Click below to pull your latest session.'
                  : 'Automatically sync your Apple Watch or Garmin sessions via Strava.'}
              </p>
            </div>
            
            <Button 
              disabled={parsing || checkingStrava}
              onClick={handleStravaSync} 
              className={`w-full font-bold py-6 rounded-xl shadow-lg transition-transform hover:scale-[1.02] ${
                isStravaConnected 
                  ? "bg-green-600 hover:bg-green-700 text-white shadow-green-500/20" 
                  : "bg-[#FC4C02] hover:bg-[#E34402] text-white shadow-orange-500/20"
              }`}
            >
              {parsing || checkingStrava ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              {checkingStrava 
                ? "Checking Status..." 
                : parsing 
                  ? (isStravaConnected ? "Syncing..." : "Redirecting...")
                  : (isStravaConnected ? "Sync Latest Session" : "Authorize Strava Account")}
            </Button>
          </div>

          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <div className={`w-full border-t ${isLight ? 'border-gray-200' : 'border-zinc-800'}`}></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className={`px-2 ${isLight ? 'bg-white text-gray-400' : 'bg-zinc-900 text-gray-500'}`}>OR</span>
            </div>
          </div>

          <div className="w-full space-y-4">
            <div className="flex items-center gap-3 justify-center mb-2">
              <FileType2 className={`w-5 h-5 ${isLight ? 'text-gray-400' : 'text-gray-500'}`} />
              <h3 className={`text-sm font-semibold ${isLight ? 'text-gray-600' : 'text-gray-300'}`}>Manual GPX Upload</h3>
            </div>
            
            <input 
              type="file" 
              accept=".gpx" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
            />

            <Button 
              disabled={parsing}
              onClick={() => fileInputRef.current?.click()} 
              variant="outline"
              className={`w-full py-5 rounded-xl border-dashed ${isLight ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-zinc-700 text-gray-300 hover:bg-zinc-800'}`}
            >
              <UploadCloud className="w-4 h-4 mr-2" />
              Upload .gpx File
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GpxUploadModal;
