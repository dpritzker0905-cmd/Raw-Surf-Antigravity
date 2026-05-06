import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Wind, Waves, Thermometer, Eye, Clock, TrendingUp, ArrowDown, ArrowUp,
  Sun, Cloud, CloudRain, ChevronDown, ChevronRight, MapPin, Calendar,
  Droplets, Navigation, Compass
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

      icon: CalendarClock,
      color: 'from-cyan-500 to-blue-500',
      textColor: 'text-cyan-400',
      available: true,
      price: photographer?.booking_hourly_rate || photographer?.hourly_rate || photographer?.session_price
        ? `$${photographer.booking_hourly_rate || photographer.hourly_rate || photographer.session_price}/session` 
        : null
    }
  ];
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${textPrimary} flex items-center gap-2`}>
            <Camera className="w-5 h-5 text-yellow-400" />
            Book {photographer?.full_name}
          </DialogTitle>
        </DialogHeader>
        
        {/* Photographer Info */}
        <div className={`p-3 rounded-xl ${cardBg} mb-4`}>
          <div className="flex items-center gap-3">
            <Avatar className={`w-12 h-12 ${isPro ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-500'}`}>
              <AvatarImage src={getFullUrl(photographer?.avatar_url)} />
              <AvatarFallback>{photographer?.full_name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${textPrimary}`}>{photographer?.full_name}</span>
                {isPro && <Badge className="bg-yellow-500 text-black text-[10px]">PRO</Badge>}
              </div>
              <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                <MapPin className="w-3 h-3" />
                {spotName || 'This spot'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Booking Options */}
        <div className="space-y-3">
          {bookingOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                onClick={() => option.available && onSelectType(option.id, photographer)}
                disabled={!option.available}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  option.available 
                    ? `border-zinc-700 hover:border-zinc-500 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800/50'}`
                    : 'border-zinc-800 opacity-50 cursor-not-allowed'
                }`}
                data-testid={`booking-option-${option.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${option.color} flex items-center justify-center ${!option.available && 'grayscale'}`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${textPrimary}`}>{option.label}</span>
                      {option.id === 'live_active' && isCurrentlyShooting && (
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <p className={`text-xs ${textSecondary}`}>{option.description}</p>
                  </div>
                  {option.price && option.available && (
                    <div className="text-right">
                      <span className={`text-sm font-bold ${option.textColor}`}>{option.price}</span>
                    </div>
                  )}
                  {option.available && (
                    <ChevronRight className={`w-4 h-4 ${textSecondary}`} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
        
        {/* Spot Link */}
        {spotId && (
          <p className={`text-xs ${textSecondary} text-center mt-2`}>
            Booking for session at this surf spot
          </p>
        )}
      </DialogContent>
    </Dialog>
  );

export default ForecastModal;
