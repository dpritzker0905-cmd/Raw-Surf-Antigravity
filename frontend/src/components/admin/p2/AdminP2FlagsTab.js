import React from 'react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Switch } from '../../ui/switch';
import { Flag as FlagIcon, Plus } from 'lucide-react';

export var AdminP2FlagsTab = ({
  featureFlags,
  setShowCreateFlag,
  handleUpdateRollout,
  handleToggleFlag,
  cardBgClass,
  textClass,
  textSecondary
}) => {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className={`font-medium ${textClass}`}>Feature Flags</h3>
        <Button size="sm" onClick={() => setShowCreateFlag(true)} className="bg-blue-500 hover:bg-blue-600" aria-label="Add">
          <Plus className="w-4 h-4 mr-1" /> Create Flag
        </Button>
      </div>

      {featureFlags.length === 0 ? (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <FlagIcon className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className={textSecondary}>No feature flags yet</p>
          </CardContent>
        </Card>
      ) : (
        featureFlags.map(flag => (
          <Card key={flag.id} className={`${cardBgClass} ${flag.kill_switch_enabled ? 'border-red-500/50' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-foreground bg-muted px-2 py-0.5 rounded">
                      {flag.key}
                    </code>
                    {flag.is_experiment && (
                      <Badge className="bg-purple-500/20 text-purple-400">Experiment</Badge>
                    )}
                    {flag.kill_switch_enabled && (
                      <Badge className="bg-red-500/20 text-red-400">Kill Switch ON</Badge>
                    )}
                  </div>
                  <p className={`text-sm ${textClass} mt-1`}>{flag.name}</p>
                  {flag.description && (
                    <p className={`text-xs ${textSecondary}`}>{flag.description}</p>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Rollout:</span>
                    <input aria-label="Range slider"
                      type="range"
                      min="0"
                      max="100"
                      value={flag.rollout_percentage}
                      onChange={(e) => handleUpdateRollout(flag.id, parseInt(e.target.value))}
                      className="w-20 h-2 bg-input rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-xs text-foreground w-8">{flag.rollout_percentage}%</span>
                  </div>
                  
                  <Switch
                    checked={flag.is_enabled}
                    onCheckedChange={() => handleToggleFlag(flag.id, flag.is_enabled)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};
