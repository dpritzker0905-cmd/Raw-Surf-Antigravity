import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  ArrowLeft, Activity, CreditCard, Shield, Clock, DollarSign, 
  ShoppingBag, Camera, MessageSquare, Edit3, Radio, Loader2,
  TrendingUp, TrendingDown, ChevronRight, AlertCircle, CheckCircle,
  ToggleLeft, ToggleRight, Save, Users
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * GromManage - Activity monitoring and spending controls for a specific Grom
 */
export const GromManage = () => {
  const { gromId } = useParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('activity'); // 'activity', 'spending', 'controls'
  const [activityData, setActivityData] = useState(null);
  const [spendingData, setSpendingData] = useState(null);
  const [controls, setControls] = useState({
    can_post: false,
    can_stream: false,
    can_message: false,
    can_message_grom_channel: true,
    can_comment: true,
    view_only: false
  });
  const [spendingLimit, setSpendingLimit] = useState('');
  const [approvalThreshold, setApprovalThreshold] = useState('');
  const [saving, setSaving] = useState(false);

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  useEffect(() => {
    if (gromId && user?.id) {
      fetchData();
    }
  }, [gromId, user?.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [activityRes, spendingRes] = await Promise.all([
        axios.get(`${API}/grom-hq/activity/${gromId}?parent_id=${user.id}`),
        axios.get(`${API}/grom-hq/spending-summary/${gromId}?parent_id=${user.id}`)
      ]);
      
      setActivityData(activityRes.data);
      setSpendingData(spendingRes.data);
      
      // Set controls from response
      if (activityRes.data.parental_controls) {
        setControls(activityRes.data.parental_controls);
        if (activityRes.data.parental_controls.spending_limit) {
          setSpendingLimit(activityRes.data.parental_controls.spending_limit.toString());
        }
        if (activityRes.data.parental_controls.require_approval_above) {
          setApprovalThreshold(activityRes.data.parental_controls.require_approval_above.toString());
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Grom data:', error);
      toast.error('Failed to load Grom data');
    } finally {
      setLoading(false);
    }
  };

  const saveControls = async () => {
    setSaving(true);
    try {
      await axios.post(
        `${API}/grom-hq/update-parental-controls/${gromId}?parent_id=${user.id}`,
        controls
      );
      toast.success('Controls updated');
    } catch (error) {
      toast.error('Failed to update controls');
    } finally {
      setSaving(false);
    }
  };

  const saveSpendingControls = async () => {
    setSaving(true);
    try {
      await axios.post(
        `${API}/grom-hq/spending-controls/${gromId}?parent_id=${user.id}`,
        {
          monthly_limit: spendingLimit ? parseFloat(spendingLimit) : null,
          require_approval_above: approvalThreshold ? parseFloat(approvalThreshold) : null
        }
      );
      toast.success('Spending controls updated');
    } catch (error) {
      toast.error('Failed to update spending controls');
    } finally {
      setSaving(false);
    }
  };

  const toggleControl = (key) => {
    setControls(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  const gromName = activityData?.grom_name || 'Grom';

  return (
    <div className={`min-h-screen ${isLight ? 'bg-gray-50' : 'bg-black'} pb-24 md:pb-8`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <button 
            onClick={() => navigate('/grom-hq')}
            className="flex items-center gap-2 text-white/80 hover:text-white mb-3"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Grom HQ
          </button>
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border-2 border-white/30">
              <AvatarFallback className="bg-white/20 text-white">
                {gromName[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-bold text-white">{gromName}</h1>
              <p className="text-cyan-100 text-sm">Manage Activity & Controls</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { id: 'activity', icon: Activity, label: 'Activity' },
            { id: 'spending', icon: CreditCard, label: 'Spending' },
            { id: 'controls', icon: Shield, label: 'Controls' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                  : `${isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-800 text-gray-400'}`
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 space-y-4">
        {/* Activity Tab */}
        {activeTab === 'activity' && activityData && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <Card className={`${cardBg} ${borderColor}`}>
                <CardContent className="p-4 text-center">
                  <Edit3 className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                  <div className={`text-2xl font-bold ${textPrimary}`}>
                    {activityData.activity.total_posts}
                  </div>
                  <div className={`text-xs ${textSecondary}`}>Total Posts</div>
                </CardContent>
              </Card>
              
              <Card className={`${cardBg} ${borderColor}`}>
                <CardContent className="p-4 text-center">
                  <TrendingUp className="w-6 h-6 text-green-400 mx-auto mb-2" />
                  <div className={`text-2xl font-bold ${textPrimary}`}>
                    {activityData.activity.posts_this_week}
                  </div>
                  <div className={`text-xs ${textSecondary}`}>Posts This Week</div>
                </CardContent>
              </Card>
              
              <Card className={`${cardBg} ${borderColor}`}>
                <CardContent className="p-4 text-center">
                  <Camera className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
                  <div className={`text-2xl font-bold ${textPrimary}`}>
                    {activityData.activity.sessions_joined}
                  </div>
                  <div className={`text-xs ${textSecondary}`}>Sessions Joined</div>
                </CardContent>
              </Card>
              
              <Card className={`${cardBg} ${borderColor}`}>
                <CardContent className="p-4 text-center">
                  <DollarSign className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                  <div className={`text-2xl font-bold ${textPrimary}`}>
                    ${activityData.activity.credits_balance.toFixed(0)}
                  </div>
                  <div className={`text-xs ${textSecondary}`}>Credits Balance</div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Transactions */}
            <Card className={`${cardBg} ${borderColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className={`${textPrimary} text-base flex items-center gap-2`}>
                  <Clock className="w-5 h-5 text-gray-400" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activityData.recent_transactions.length === 0 ? (
                  <div className="text-center py-6">
                    <Activity className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                    <p className={`text-sm ${textSecondary}`}>No recent activity</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activityData.recent_transactions.map((t) => (
                      <div 
                        key={t.id}
                        className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          t.amount < 0 ? 'bg-red-500/20' : 'bg-green-500/20'
                        }`}>
                          {t.amount < 0 ? (
                            <TrendingDown className="w-4 h-4 text-red-400" />
                          ) : (
                            <TrendingUp className="w-4 h-4 text-green-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm ${textPrimary}`}>{t.description || t.type}</p>
                          <p className={`text-xs ${textSecondary}`}>
                            {new Date(t.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`font-bold ${t.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {t.amount < 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Spending Tab */}
        {activeTab === 'spending' && spendingData && (
          <>
            {/* Spending Overview */}
            <Card className={`${cardBg} border-2 border-emerald-500/30`}>
              <CardContent className="p-6 text-center">
                <div className={`text-4xl font-bold ${textPrimary}`}>
                  ${spendingData.monthly_spending.toFixed(0)}
                </div>
                <p className={`${textSecondary} text-sm mt-1`}>Spent This Month</p>
                {spendingData.spending_limit && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className={textSecondary}>Limit: ${spendingData.spending_limit}</span>
                      <span className={spendingData.monthly_spending > spendingData.spending_limit ? 'text-red-400' : 'text-green-400'}>
                        {Math.round((spendingData.monthly_spending / spendingData.spending_limit) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-zinc-700 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${spendingData.monthly_spending > spendingData.spending_limit ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, (spendingData.monthly_spending / spendingData.spending_limit) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Spending by Category */}
            <Card className={`${cardBg} ${borderColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className={`${textPrimary} text-base`}>
                  Spending by Category
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(spendingData.spending_by_category).length === 0 ? (
                  <div className="text-center py-6">
                    <ShoppingBag className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                    <p className={`text-sm ${textSecondary}`}>No spending yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(spendingData.spending_by_category).map(([category, amount]) => (
                      <div key={category} className="flex items-center justify-between">
                        <span className={`capitalize ${textPrimary}`}>
                          {category.replace('_', ' ')}
                        </span>
                        <span className="text-emerald-400 font-bold">
                          ${amount.toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Spending Controls */}
            <Card className={`${cardBg} ${borderColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className={`${textPrimary} text-base flex items-center gap-2`}>
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  Spending Limits
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className={`text-sm ${textSecondary} block mb-2`}>
                    Monthly Spending Limit ($)
                  </label>
                  <Input
                    type="number"
                    placeholder="No limit"
                    value={spendingLimit}
                    onChange={(e) => setSpendingLimit(e.target.value)}
                    className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800'} border-zinc-700`}
                  />
                </div>
                
                <div>
                  <label className={`text-sm ${textSecondary} block mb-2`}>
                    Require Approval Above ($)
                  </label>
                  <Input
                    type="number"
                    placeholder="No threshold"
                    value={approvalThreshold}
                    onChange={(e) => setApprovalThreshold(e.target.value)}
                    className={`${isLight ? 'bg-gray-100' : 'bg-zinc-800'} border-zinc-700`}
                  />
                </div>
                
                <Button 
                  onClick={saveSpendingControls}
                  disabled={saving}
                  className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 text-black"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Spending Limits
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        {/* Controls Tab */}
        {activeTab === 'controls' && (
          <Card className={`${cardBg} ${borderColor}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`${textPrimary} text-base flex items-center gap-2`}>
                <Shield className="w-5 h-5 text-cyan-400" />
                Feature Permissions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className={`text-sm ${textSecondary}`}>
                Control what {gromName} can do on Raw Surf OS
              </p>
              
              {/* Control Toggles */}
              {[
                { key: 'can_post', icon: Edit3, label: 'Can Post', desc: 'Allow posting photos and videos', color: 'blue' },
                { key: 'can_stream', icon: Radio, label: 'Can Go Live', desc: 'Allow live streaming', color: 'red' },
                { key: 'can_message', icon: MessageSquare, label: 'Can Message Adults', desc: 'Allow messaging non-Grom users', color: 'purple' },
                { key: 'can_message_grom_channel', icon: Users, label: 'Grom Zone Chat', desc: 'Allow messaging other Groms only', color: 'cyan' },
                { key: 'can_comment', icon: MessageSquare, label: 'Can Comment', desc: 'Allow commenting on posts', color: 'green' },
                { key: 'view_only', icon: AlertCircle, label: 'View Only Mode', desc: 'Restrict to viewing content only', color: 'yellow' }
              ].map((control) => (
                <div 
                  key={control.key}
                  className={`flex items-center gap-3 p-4 rounded-xl ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}
                >
                  <div className={`w-10 h-10 rounded-full bg-${control.color}-500/20 flex items-center justify-center`}>
                    <control.icon className={`w-5 h-5 text-${control.color}-400`} />
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${textPrimary}`}>{control.label}</p>
                    <p className={`text-xs ${textSecondary}`}>{control.desc}</p>
                  </div>
                  <button
                    onClick={() => toggleControl(control.key)}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      controls[control.key] 
                        ? 'bg-cyan-500' 
                        : isLight ? 'bg-gray-300' : 'bg-zinc-600'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                      controls[control.key] ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              ))}
              
              <Button 
                onClick={saveControls}
                disabled={saving}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white mt-4"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Controls
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default GromManage;
