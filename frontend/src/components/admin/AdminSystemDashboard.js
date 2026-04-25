import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import {
  Activity, Server, Database, Cpu, HardDrive,
  Loader2, RefreshCw, Check, X, AlertTriangle, Bell, CheckCircle, XCircle, AlertCircle
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import logger from '../../utils/logger';


/**
 * Admin System Health Dashboard
 * - CPU, Memory, Disk usage
 * - Database performance
 * - Background job status
 * - System alerts
 */
export const AdminSystemDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [healthData, setHealthData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';

  useEffect(() => {
    if (user?.id) {
      fetchAllData();
      // Auto-refresh every 30 seconds
      const interval = setInterval(fetchAllData, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const fetchAllData = async () => {
    try {
      const [healthRes, jobsRes, alertsRes] = await Promise.all([
        apiClient.get(`/admin/system/health`),
        apiClient.get(`/admin/system/jobs`),
        apiClient.get(`/admin/system/alerts`)
      ]);
      setHealthData(healthRes.data);
      setJobs(jobsRes.data.jobs || []);
      setAlerts(alertsRes.data.alerts || []);
    } catch (error) {
      logger.error('Failed to load system data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleJob = async (jobName, currentState) => {
    try {
      await apiClient.put(`/admin/system/jobs/${jobName}/toggle`);
      toast.success(`Job ${currentState ? 'disabled' : 'enabled'}`);
      fetchAllData();
    } catch (error) {
      toast.error('Failed to toggle job');
    }
  };

  const handleAcknowledgeAlert = async (alertId) => {
    try {
      await apiClient.post(`/admin/system/alerts/acknowledge`, {
        alert_ids: [alertId]
      });
      toast.success('Alert acknowledged');
      fetchAllData();
    } catch (error) {
      toast.error('Failed to acknowledge alert');
    }
  };

  const handleResolveAlert = async (alertId) => {
    try {
      await apiClient.post(`/admin/system/alerts/${alertId}/resolve`);
      toast.success('Alert resolved');
      fetchAllData();
    } catch (error) {
      toast.error('Failed to resolve alert');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-400 bg-green-500/20';
      case 'warning': return 'text-yellow-400 bg-yellow-500/20';
      case 'critical': return 'text-red-400 bg-red-500/20';
      default: return 'text-muted-foreground bg-gray-500/20';
    }
  };

  const getJobStatusIcon = (status) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-400" />;
      case 'running': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default: return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatBytes = (gb) => gb?.toFixed(1) + ' GB';

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-system-dashboard">
      {/* Overall Status */}
      {healthData && (
        <>
          <Card className={`${cardBgClass} border-l-4 ${
            healthData.overall_status === 'healthy' ? 'border-l-green-500' :
            healthData.overall_status === 'warning' ? 'border-l-yellow-500' : 'border-l-red-500'
          }`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity className={`w-8 h-8 ${
                    healthData.overall_status === 'healthy' ? 'text-green-400' :
                    healthData.overall_status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                  }`} />
                  <div>
                    <p className="text-xs text-gray-500">System Status</p>
                    <p className={`text-2xl font-bold capitalize ${
                      healthData.overall_status === 'healthy' ? 'text-green-400' :
                      healthData.overall_status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {healthData.overall_status}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {healthData.unacknowledged_alerts > 0 && (
                    <Badge className="bg-red-500/20 text-red-400">
                      <Bell className="w-3 h-3 mr-1" />
                      {healthData.unacknowledged_alerts} Alerts
                    </Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={fetchAllData}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resource Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {healthData.components.map(comp => (
              <Card key={comp.name} className={`${cardBgClass} ${
                comp.status === 'healthy' ? 'border-green-500/30' :
                comp.status === 'warning' ? 'border-yellow-500/30' : 'border-red-500/30'
              }`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{comp.name}</span>
                    {comp.name === 'CPU' && <Cpu className="w-4 h-4 text-gray-500" />}
                    {comp.name === 'Memory' && <Server className="w-4 h-4 text-gray-500" />}
                    {comp.name === 'Disk' && <HardDrive className="w-4 h-4 text-gray-500" />}
                    {comp.name === 'Database' && <Database className="w-4 h-4 text-gray-500" />}
                  </div>
                  <p className={`text-xl font-bold ${
                    comp.status === 'healthy' ? 'text-green-400' :
                    comp.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {comp.value !== null ? `${comp.value}${comp.unit}` : 'N/A'}
                  </p>
                  <Badge className={`text-[10px] mt-1 ${getStatusColor(comp.status)}`}>
                    {comp.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Detailed System Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className={cardBgClass}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm ${textClass}`}>Memory Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Used</span>
                    <span className="text-foreground">{formatBytes(healthData.system.memory_used_gb)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${
                        healthData.system.memory_percent < 70 ? 'bg-green-500' :
                        healthData.system.memory_percent < 90 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${healthData.system.memory_percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-gray-500">{formatBytes(healthData.system.memory_total_gb)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cardBgClass}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm ${textClass}`}>Disk Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Used</span>
                    <span className="text-foreground">{formatBytes(healthData.system.disk_used_gb)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${
                        healthData.system.disk_percent < 70 ? 'bg-green-500' :
                        healthData.system.disk_percent < 90 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${healthData.system.disk_percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-gray-500">{formatBytes(healthData.system.disk_total_gb)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Background Jobs */}
      <Card className={cardBgClass}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm ${textClass}`}>Background Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {jobs.map(job => (
              <div key={job.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  {getJobStatusIcon(job.last_run_status)}
                  <div>
                    <p className={`text-sm font-medium ${textClass}`}>{job.job_name.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500">{job.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{job.schedule}</p>
                    {job.last_run_at && (
                      <p className="text-[10px] text-gray-500">
                        Last: {new Date(job.last_run_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Badge className={`text-[10px] ${
                    job.success_rate >= 90 ? 'bg-green-500/20 text-green-400' :
                    job.success_rate >= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    {job.success_rate}%
                  </Badge>
                  <Switch
                    checked={job.is_enabled}
                    onCheckedChange={() => handleToggleJob(job.job_name, job.is_enabled)}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Alerts */}
      {alerts.length > 0 && (
        <Card className={`${cardBgClass} border-red-500/30`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
              <AlertTriangle className="w-4 h-4 text-red-400" />
              System Alerts ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.map(alert => (
                <div key={alert.id} className={`p-3 rounded-lg border ${
                  alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                  alert.severity === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30' :
                  'bg-blue-500/10 border-blue-500/30'
                }`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] ${
                          alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                          alert.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {alert.severity}
                        </Badge>
                        <span className="text-xs text-gray-500">{alert.alert_type}</span>
                      </div>
                      <p className={`text-sm font-medium ${textClass} mt-1`}>{alert.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                    </div>
                    <div className="flex gap-1">
                      {!alert.is_acknowledged && (
                        <Button size="sm" variant="outline" onClick={() => handleAcknowledgeAlert(alert.id)}>
                          <Check className="w-3 h-3" />
                        </Button>
                      )}
                      {!alert.is_resolved && (
                        <Button size="sm" variant="outline" onClick={() => handleResolveAlert(alert.id)}>
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminSystemDashboard;
