/**
 * AdminLogsPanel - Admin Action Logs Viewer
 * Extracted from UnifiedAdminConsole.js (v76 decomposition)
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

export var AdminLogsPanel = ({
  logs,
  cardBgClass,
  textClass,
}) => {
  return (
    <Card className={cardBgClass}>
      <CardHeader>
        <CardTitle className={`${textClass} text-sm`}>Admin Action Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <p className="text-foreground text-sm">
                  <span className="text-yellow-400">{log.admin_name || 'Unknown'}</span>
                  {' '}{log.action?.replace(/_/g, ' ')}{' '}
                  <span className="text-gray-500">({log.target_type})</span>
                </p>
              </div>
              <span className="text-gray-500 text-xs">
                {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="text-muted-foreground text-center py-4">No admin logs yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AdminLogsPanel;
