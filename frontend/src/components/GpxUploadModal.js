import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { UploadCloud, FileType2, Loader2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { toast } from 'sonner';

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
  const isLight = theme === 'light';
  const fileInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-sm rounded-2xl`}>
        <DialogHeader>
          <DialogTitle className={`text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'} text-center`}>Sync Smartwatch</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center">
            <FileType2 className="w-8 h-8 text-purple-500" />
          </div>
          
          <div>
            <h3 className={`font-semibold ${isLight ? 'text-gray-800' : 'text-gray-200'}`}>Upload GPX File</h3>
            <p className={`text-xs mt-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
              Export your session from Apple Health or Garmin Connect as a .gpx file.
            </p>
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
            className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-6 mt-4 rounded-xl shadow-lg shadow-purple-500/20"
          >
            {parsing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <UploadCloud className="w-5 h-5 mr-2" />}
            {parsing ? "Parsing Data..." : "Select File"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GpxUploadModal;
