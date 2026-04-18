import React, { useState } from 'react';
import { 
  MapPin, 
  Settings, 
  Navigation, 
  ChevronRight, 
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Target,
  Map
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { toast } from 'sonner';

/**
 * GPSSettingsGuide - Modal to help users enable precise GPS location
 * Shows device-specific instructions for iOS and Android
 * Also offers manual location selection as fallback
 */
export const GPSSettingsGuide = ({ 
  isOpen, 
  onClose, 
  onRetryLocation,
  onManualLocation,
  currentAccuracy = null,
  isLoading = false 
}) => {
  const [expandedSection, setExpandedSection] = useState(null);
  const [deviceType, setDeviceType] = useState(() => {
    // Auto-detect device type
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'android'; // Default to Android for unknown
  });

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleRetry = async () => {
    if (onRetryLocation) {
      try {
        await onRetryLocation();
        toast.success('Location updated!');
      } catch (error) {
        toast.error('Could not get precise location');
      }
    }
  };

  const handleManualSelect = () => {
    onClose();
    if (onManualLocation) {
      onManualLocation();
    }
  };

  // Determine accuracy status
  const getAccuracyStatus = () => {
    if (!currentAccuracy) return { level: 'unknown', color: 'gray', message: 'Location not available' };
    if (currentAccuracy <= 50) return { level: 'excellent', color: 'green', message: 'GPS Locked - High Accuracy' };
    if (currentAccuracy <= 100) return { level: 'good', color: 'green', message: 'Good Accuracy' };
    if (currentAccuracy <= 500) return { level: 'poor', color: 'yellow', message: 'Approximate Location' };
    if (currentAccuracy <= 5000) return { level: 'bad', color: 'orange', message: 'Using Cell Tower Location' };
    return { level: 'terrible', color: 'red', message: 'Using IP Location (Very Inaccurate)' };
  };

  const status = getAccuracyStatus();

  const AccuracyIndicator = () => {
    const colorClasses = {
      green: 'bg-green-500/10 border-green-500/30 text-green-400',
      yellow: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
      orange: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
      red: 'bg-red-500/10 border-red-500/30 text-red-400',
      gray: 'bg-zinc-500/10 border-zinc-500/30 text-gray-400'
    };
    
    return (
      <div className={`p-4 rounded-lg mb-4 border ${colorClasses[status.color]}`}>
        <div className="flex items-start gap-3">
          {status.level === 'excellent' || status.level === 'good' ? (
            <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="font-semibold">{status.message}</p>
            {currentAccuracy && (
              <p className="text-sm opacity-80 mt-0.5">
                Accuracy: ~{currentAccuracy > 1000 ? `${(currentAccuracy/1000).toFixed(1)}km` : `${Math.round(currentAccuracy)}m`}
              </p>
            )}
            {status.level === 'terrible' && (
              <p className="text-sm mt-2 text-red-300">
                Your carrier is reporting a location far from you. This is common on mobile networks.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const SectionHeader = ({ section, title, icon: Icon }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-cyan-400" />
        <span className="font-medium text-white">{title}</span>
      </div>
      {expandedSection === section ? (
        <ChevronDown className="w-5 h-5 text-gray-400" />
      ) : (
        <ChevronRight className="w-5 h-5 text-gray-400" />
      )}
    </button>
  );

  const Step = ({ number, title, description }) => (
    <div className="flex gap-3 py-2">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-sm font-bold">
        {number}
      </div>
      <div>
        <p className="text-white font-medium">{title}</p>
        {description && <p className="text-gray-400 text-sm mt-0.5">{description}</p>}
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md" hideCloseButton>
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        {/* Header with close button */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 pt-4 pb-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Navigation className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white">Fix Your Location</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Current Accuracy Status */}
          <AccuracyIndicator />

          {/* QUICK FIX: Manual Location Selection */}
          {(status.level === 'poor' || status.level === 'bad' || status.level === 'terrible') && (
            <div className="p-4 bg-cyan-500/10 rounded-lg border border-cyan-500/30">
              <div className="flex items-start gap-3">
                <Target className="w-6 h-6 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-cyan-400 font-semibold">Quick Fix: Select Location Manually</p>
                  <p className="text-cyan-300 text-sm mt-1">
                    Tap the map to set your exact location. This is the fastest way to fix inaccurate GPS.
                  </p>
                  <Button
                    onClick={handleManualSelect}
                    className="mt-3 w-full bg-cyan-600 hover:bg-cyan-700"
                  >
                    <Map className="w-4 h-4 mr-2" />
                    Select on Map
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Device Type Selector */}
          <div>
            <p className="text-sm text-gray-400 mb-2">Or fix your device GPS settings:</p>
            <div className="flex gap-2">
              <Button
                variant={deviceType === 'ios' ? 'default' : 'outline'}
                onClick={() => setDeviceType('ios')}
                className={`flex-1 ${deviceType === 'ios' ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-600'}`}
              >
                🍎 iPhone
              </Button>
              <Button
                variant={deviceType === 'android' ? 'default' : 'outline'}
                onClick={() => setDeviceType('android')}
                className={`flex-1 ${deviceType === 'android' ? 'bg-cyan-600 hover:bg-cyan-700' : 'border-zinc-600'}`}
              >
                🤖 Android
              </Button>
            </div>
          </div>

          {/* iOS Instructions */}
          {deviceType === 'ios' && (
            <div className="space-y-2">
              <SectionHeader 
                section="ios-precise" 
                title="Enable Precise Location" 
                icon={Settings} 
              />
              {expandedSection === 'ios-precise' && (
                <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <Step number="1" title="Open Settings → Privacy & Security → Location Services" />
                  <Step number="2" title="Find Safari (or Chrome)" />
                  <Step number="3" title="Set to 'While Using'" />
                  <Step number="4" title="Turn ON 'Precise Location'" description="This is the key setting!" />
                  <div className="mt-3 p-2 bg-cyan-500/10 rounded border border-cyan-500/30">
                    <p className="text-cyan-400 text-sm font-medium">
                      ⚡ "Precise Location" must be ON for GPS
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Android Instructions */}
          {deviceType === 'android' && (
            <div className="space-y-2">
              <SectionHeader 
                section="android-high" 
                title="Enable High Accuracy GPS" 
                icon={Settings} 
              />
              {expandedSection === 'android-high' && (
                <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <Step number="1" title="Open Settings → Location" />
                  <Step number="2" title="Turn ON Location" />
                  <Step number="3" title="Tap 'Location Mode' or 'Improve Accuracy'" />
                  <Step number="4" title="Select 'High Accuracy'" description="Uses GPS + WiFi + Cell" />
                  
                  <div className="mt-3 p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                    <p className="text-yellow-400 text-sm font-medium">Samsung Users:</p>
                    <p className="text-yellow-300 text-xs mt-1">
                      Settings → Apps → Chrome → Permissions → Location → "Allow all the time" + "Use Precise Location"
                    </p>
                  </div>
                </div>
              )}

              <SectionHeader 
                section="android-tips" 
                title="Tips if Still Not Working" 
                icon={MapPin} 
              />
              {expandedSection === 'android-tips' && (
                <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      Go outside with clear sky view
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      Wait 15-30 seconds for satellites to lock
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      Turn OFF Battery Saver mode
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      Clear browser cache and reload page
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Retry Button */}
          <div className="pt-2">
            <Button
              onClick={handleRetry}
              disabled={isLoading}
              variant="outline"
              className="w-full border-zinc-600 hover:bg-zinc-800"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Getting Location...
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4 mr-2" />
                  Try GPS Again
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GPSSettingsGuide;
