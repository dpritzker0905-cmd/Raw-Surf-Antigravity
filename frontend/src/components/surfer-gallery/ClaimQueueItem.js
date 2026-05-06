import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

const ClaimQueueItem = ({ item, onAction }) => (
  <div className="p-3 bg-muted rounded-xl border border-purple-500/20">
    <div className="flex gap-3">
      <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
        <img loading="lazy" decoding="async" 
          src={item.thumbnail_url || item.url} 
          alt=""
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge className="bg-purple-500/20 text-purple-400 text-xs">
            {Math.round(item.confidence * 100)}% match
          </Badge>
          <span className="text-xs text-muted-foreground">
            by {item.photographer_name}
          </span>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2">
          {item.session_date ? new Date(item.session_date).toLocaleDateString() : 'Recent session'}
          {item.spot_name && ` at ${item.spot_name}`}
        </p>
        <div className="flex gap-2 mt-2">
          <Button aria-label="Check Circle"
            size="sm"
            onClick={() => onAction(item.id, 'claim')}
            className="bg-green-500 hover:bg-green-600 text-foreground h-7 text-xs"
          >
            <CheckCircle className="w-3 h-3 mr-1" />
            That's me!
          </Button>
          <Button aria-label="Cancel"
            size="sm"
            variant="outline"
            onClick={() => onAction(item.id, 'reject')}
            className="h-7 text-xs border-zinc-600"
          >
            <XCircle className="w-3 h-3 mr-1" />
            Not me
          </Button>
        </div>
      </div>
    </div>
  </div>
);

export default ClaimQueueItem;
