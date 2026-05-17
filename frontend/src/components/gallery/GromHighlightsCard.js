/**
 * GromHighlightsCard.js
 * Grom Highlights section for Gallery Hub - SPECIAL for Grom Parents
 * Shows tagged grom photos/videos with management actions
 */
import React from 'react';
import { Sparkles, X, Plus, Play, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';

var GromHighlightsCard = ({
  gromHighlights,
  linkedGroms,
  handleUntagGrom,
}) => {
  return (
    <Card className="mb-6 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-cyan-500 dark:text-cyan-400 flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Grom Highlights
          {gromHighlights.length > 0 && (
            <Badge variant="secondary" className="ml-2 bg-cyan-500/20 text-cyan-500 dark:text-cyan-400">
              {gromHighlights.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm mb-4">
          Tag photos to share them to your Grom's profile. They'll appear here and on their profile.
        </p>
        
        {/* Linked Groms Pills */}
        {linkedGroms.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {linkedGroms.map((grom) => (
              <div key={grom.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-sm">
                {grom.avatar ? (
                  <img loading="lazy" decoding="async" src={grom.avatar} alt={grom.name} className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-xs text-black font-bold">
                    {grom.name?.charAt(0) || 'G'}
                  </div>
                )}
                <span className="text-foreground">{grom.name}</span>
                {grom.is_approved && (
                  <Check className="w-3 h-3 text-green-400" />
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Highlights Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {gromHighlights.map((item) => (
            <div 
              key={item.id} 
              className="relative aspect-square rounded-lg overflow-hidden group"
            >
              {item.media_type === 'video' ? (
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(item.thumbnail_url || item.preview_url)} 
                  alt={item.title || 'Grom video'} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(item.thumbnail_url || item.preview_url)} 
                  alt={item.title || 'Grom photo'} 
                  className="w-full h-full object-cover"
                />
              )}
              
              {/* Overlay with remove button */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8"
                  onClick={() => handleUntagGrom(item.id, item.grom_id)}
                >
                  <X className="w-3 h-3 mr-1" />
                  Remove
                </Button>
              </div>
              
              {/* Media type badge */}
              {item.media_type === 'video' && (
                <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1.5 py-0.5">
                  <Play className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          ))}
          
          {/* Add photo placeholder */}
          <div 
            className="aspect-square bg-muted/50 rounded-lg flex items-center justify-center border-2 border-dashed border-cyan-500/30 cursor-pointer hover:border-cyan-500/60 transition-colors"
            onClick={() => {
              if (linkedGroms.length === 0) {
                toast.error('No linked Groms found. Link a Grom first.');
                return;
              }
              toast.info('Select a photo below and use the "Tag Grom" button to add it here.');
            }}
          >
            <div className="text-center p-3">
              <Plus className="w-6 h-6 text-cyan-500 mx-auto mb-1" />
              <span className="text-xs text-muted-foreground">Tag a photo</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GromHighlightsCard;
