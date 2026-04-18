import React, { useEffect, useState } from 'react';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { Camera, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';


export const TopStories = () => {
  const [livePhotographers, setLivePhotographers] = useState([]);

  useEffect(() => {
    fetchLivePhotographers();
    const interval = setInterval(fetchLivePhotographers, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchLivePhotographers = async () => {
    try {
      const response = await apiClient.get(`/profiles?is_live=true`);
      setLivePhotographers(response.data);
    } catch (error) {
      console.error('Error fetching live photographers:', error);
    }
  };

  if (livePhotographers.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-border bg-card" data-testid="top-stories">
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-4 p-4">
          {livePhotographers.map((photographer) => (
            <div
              key={photographer.id}
              className="flex flex-col items-center gap-2 min-w-[80px]"
              data-testid={`live-photographer-${photographer.id}`}
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-primary p-1">
                  <Avatar className="w-full h-full">
                    <AvatarImage src={photographer.avatar_url} />
                    <AvatarFallback>{photographer.full_name?.[0] || 'P'}</AvatarFallback>
                  </Avatar>
                </div>
                <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-1">
                  <Camera className="w-3 h-3 text-black" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium truncate w-20" data-testid="photographer-name">
                  {photographer.full_name || 'Live'}
                </p>
                {photographer.location && (
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1" data-testid="photographer-location">
                    <MapPin className="w-2 h-2" />
                    <span className="truncate w-16">{photographer.location}</span>
                  </p>
                )}
              </div>
              <Badge variant="outline" className="text-xs" data-testid="live-badge">LIVE</Badge>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};