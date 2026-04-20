import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { 
  DollarSign, 
  Save, 
  RefreshCw, 
  Loader2, 
  Check, 
  X, 
  Edit2, 
  History,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import logger from '../../utils/logger';


// Role display config - matches all RoleEnum values
const ROLE_CONFIG = {
  surfer: { label: 'Surfer', color: 'bg-cyan-500/20 text-cyan-400', icon: '🏄' },
  grom: { label: 'Grom', color: 'bg-yellow-500/20 text-yellow-400', icon: '🐣' },
  photographer: { label: 'Photographer', color: 'bg-purple-500/20 text-purple-400', icon: '📷' },
  grom_parent: { label: 'Grom Parent', color: 'bg-blue-500/20 text-blue-400', icon: '👨‍👧' },
  hobbyist: { label: 'Hobbyist', color: 'bg-indigo-500/20 text-indigo-400', icon: '🔍' },
  comp_surfer: { label: 'Competition Surfer', color: 'bg-amber-500/20 text-amber-400', icon: '🏆' },
  pro_surfer: { label: 'Pro Surfer', color: 'bg-gold-500/20 text-yellow-400', icon: '⭐' },
  approved_pro_photographer: { label: 'Verified Pro Photographer', color: 'bg-blue-500/20 text-blue-400', icon: '📸' },
  surf_school: { label: 'Surf School / Coach', color: 'bg-teal-500/20 text-teal-400', icon: '🌬️' },
  shop: { label: 'Surf Shop', color: 'bg-pink-500/20 text-pink-400', icon: '🛍️' },
  shaper: { label: 'Shaper', color: 'bg-orange-500/20 text-orange-400', icon: '🛠️' },
  resort: { label: 'Resort / Retreat', color: 'bg-emerald-500/20 text-emerald-400', icon: '🌴' },
  wave_pool: { label: 'Wave Pool', color: 'bg-sky-500/20 text-sky-400', icon: '🌊' },
  destination: { label: 'Surf Destination', color: 'bg-rose-500/20 text-rose-400', icon: '📍' }
};

const TIER_LABELS = {
  tier_1: 'Free',
  tier_2: 'Basic',
  tier_3: 'Premium'
};

export const AdminPricingEditor = () => {
  const { user } = useAuth();
  const [pricing, setPricing] = useState(null);
  const [originalPricing, setOriginalPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isFromDb, setIsFromDb] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState({});
  const [editingCell, setEditingCell] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  
  // Commission rates state
  const [commissionRates, setCommissionRates] = useState({
    free: 25,      // Free tier - 25% (Hobbyists)
    tier_1: 25,    // Same as free
    tier_2: 20,    // Basic - 20%
    tier_3: 15,    // Premium - 15%
  });
  const [_originalCommissionRates, setOriginalCommissionRates] = useState(null);
  const [commissionHasChanges, setCommissionHasChanges] = useState(false);

  const fetchPricing = useCallback(async () => {
    try {
      const response = await apiClient.get(`/admin/pricing/config`);
      setPricing(response.data.pricing);
      setOriginalPricing(JSON.parse(JSON.stringify(response.data.pricing)));
      setVersion(response.data.version);
      setUpdatedAt(response.data.updated_at);
      setIsFromDb(response.data.is_from_db);
      setHasChanges(false);
    } catch (error) {
      logger.error('Failed to fetch pricing:', error);
      toast.error('Failed to load pricing configuration');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchHistory = async () => {
    try {
      const response = await apiClient.get(`/admin/pricing/history?limit=10`);
      setHistory(response.data.history);
    } catch (error) {
      logger.error('Failed to fetch history:', error);
    }
  };

  useEffect(() => {
    if (user?.id) {
      fetchPricing();
    }
  }, [user?.id, fetchPricing]);

  const toggleRoleExpand = (roleKey) => {
    setExpandedRoles(prev => ({
      ...prev,
      [roleKey]: !prev[roleKey]
    }));
  };

  const handlePriceChange = (roleKey, tierKey, newPrice) => {
    // Ensure whole dollar only
    const price = Math.max(0, Math.floor(parseInt(newPrice) || 0));
    
    setPricing(prev => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        tiers: {
          ...prev[roleKey].tiers,
          [tierKey]: {
            ...prev[roleKey].tiers[tierKey],
            price: price
          }
        }
      }
    }));
    setHasChanges(true);
  };

  const handleNameChange = (roleKey, tierKey, newName) => {
    setPricing(prev => ({
      ...prev,
      [roleKey]: {
        ...prev[roleKey],
        tiers: {
          ...prev[roleKey].tiers,
          [tierKey]: {
            ...prev[roleKey].tiers[tierKey],
            name: newName
          }
        }
      }
    }));
    setHasChanges(true);
  };

  const handleFeatureChange = (roleKey, tierKey, featureIndex, newFeature) => {
    setPricing(prev => {
      const newFeatures = [...prev[roleKey].tiers[tierKey].features];
      newFeatures[featureIndex] = newFeature;
      return {
        ...prev,
        [roleKey]: {
          ...prev[roleKey],
          tiers: {
            ...prev[roleKey].tiers,
            [tierKey]: {
              ...prev[roleKey].tiers[tierKey],
              features: newFeatures
            }
          }
        }
      };
    });
    setHasChanges(true);
  };
  
  // Commission rate change handler
  const handleCommissionRateChange = (tierKey, newRate) => {
    const rate = Math.min(100, Math.max(0, parseInt(newRate) || 0));
    setCommissionRates(prev => ({
      ...prev,
      [tierKey]: rate
    }));
    setCommissionHasChanges(true);
    setHasChanges(true);
  };
  
  // Save commission rates to localStorage (for now - can be migrated to DB later)
  const saveCommissionRates = () => {
    localStorage.setItem('admin_commission_rates', JSON.stringify(commissionRates));
    setOriginalCommissionRates({ ...commissionRates });
    setCommissionHasChanges(false);
    toast.success('Commission rates saved!');
  };
  
  // Load commission rates from localStorage
  useEffect(() => {
    const savedRates = localStorage.getItem('admin_commission_rates');
    if (savedRates) {
      const parsed = JSON.parse(savedRates);
      setCommissionRates(parsed);
      setOriginalCommissionRates(parsed);
    } else {
      setOriginalCommissionRates({ ...commissionRates });
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiClient.post(
        `/admin/pricing/update`,
        pricing
      );
      
      setPricing(response.data.pricing);
      setOriginalPricing(JSON.parse(JSON.stringify(response.data.pricing)));
      setVersion(response.data.version);
      setUpdatedAt(new Date().toISOString());
      setIsFromDb(true);
      setHasChanges(false);
      
      // Also save commission rates
      if (commissionHasChanges) {
        saveCommissionRates();
      }
      
      toast.success(`Pricing saved (v${response.data.version})`);
    } catch (error) {
      logger.error('Failed to save pricing:', error);
      toast.error('Failed to save pricing');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all pricing to default values? This cannot be undone.')) {
      return;
    }
    
    setSaving(true);
    try {
      const response = await apiClient.post(`/admin/pricing/reset`);
      
      setPricing(response.data.pricing);
      setOriginalPricing(JSON.parse(JSON.stringify(response.data.pricing)));
      setVersion(response.data.version);
      setUpdatedAt(new Date().toISOString());
      setIsFromDb(true);
      setHasChanges(false);
      
      toast.success('Pricing reset to defaults');
    } catch (error) {
      logger.error('Failed to reset pricing:', error);
      toast.error('Failed to reset pricing');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPricing(JSON.parse(JSON.stringify(originalPricing)));
    setHasChanges(false);
    setEditingCell(null);
    toast.info('Changes discarded');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-pricing-editor">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-400" />
            Pricing Configuration
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Edit subscription prices in real-time. Changes apply immediately.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge className={isFromDb ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}>
            {isFromDb ? `v${version}` : 'Default'}
          </Badge>
          {updatedAt && (
            <span className="text-xs text-gray-500">
              Updated: {new Date(updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Warning Banner */}
      {hasChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-yellow-400 font-medium">Unsaved Changes</p>
            <p className="text-gray-400 text-sm">You have unsaved changes to the pricing configuration.</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDiscard}
              className="border-zinc-700 text-gray-400"
            >
              <X className="w-4 h-4 mr-1" />
              Discard
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-green-500 hover:bg-green-600 text-black"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Credit Rate Info */}
      <div className="bg-zinc-800/50 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-white font-medium">Stoked Credit Rate</p>
          <p className="text-gray-400 text-sm">1 Credit = $1.00 USD (1:1 Ratio)</p>
        </div>
        <Badge className="bg-green-500/20 text-green-400 text-lg px-4 py-1">
          1:1
        </Badge>
      </div>

      {/* Commission Rates Section */}
      <div className="bg-zinc-900 rounded-xl overflow-hidden" data-testid="commission-rates-section">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-bold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-yellow-400" />
                Platform Commission Rates
              </h3>
              <p className="text-gray-400 text-sm mt-1">
                Set commission percentages charged to photographers by subscription tier
              </p>
            </div>
            {commissionHasChanges && (
              <Badge className="bg-yellow-500/20 text-yellow-400">Unsaved</Badge>
            )}
          </div>
        </div>
        
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Free/Hobbyist Tier */}
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm font-medium">Free / Hobbyist</span>
                <Badge className="bg-zinc-700 text-gray-400 text-xs">No Cash Payouts</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={commissionRates.free}
                  onChange={(e) => handleCommissionRateChange('free', e.target.value)}
                  className="bg-zinc-900 border-zinc-700 text-white text-lg font-bold w-20 text-center"
                  data-testid="commission-rate-free"
                />
                <span className="text-gray-400 text-xl">%</span>
              </div>
              <p className="text-gray-500 text-xs mt-2">Hobbyists can't withdraw cash</p>
            </div>
            
            {/* Basic Tier */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-blue-400 text-sm font-medium">Basic (tier_2)</span>
                <Badge className="bg-blue-500/20 text-blue-400 text-xs">Paid Plan</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={commissionRates.tier_2}
                  onChange={(e) => handleCommissionRateChange('tier_2', e.target.value)}
                  className="bg-zinc-900 border-blue-500/50 text-blue-400 text-lg font-bold w-20 text-center"
                  data-testid="commission-rate-tier2"
                />
                <span className="text-blue-400 text-xl">%</span>
              </div>
              <p className="text-gray-500 text-xs mt-2">Standard photographer tier</p>
            </div>
            
            {/* Premium Tier */}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-yellow-400 text-sm font-medium">Premium (tier_3)</span>
                <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pro Plan</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={commissionRates.tier_3}
                  onChange={(e) => handleCommissionRateChange('tier_3', e.target.value)}
                  className="bg-zinc-900 border-yellow-500/50 text-yellow-400 text-lg font-bold w-20 text-center"
                  data-testid="commission-rate-tier3"
                />
                <span className="text-yellow-400 text-xl">%</span>
              </div>
              <p className="text-gray-500 text-xs mt-2">Lowest commission rate</p>
            </div>
            
            {/* Quick Reference */}
            <div className="bg-zinc-800/30 rounded-lg p-4 flex flex-col justify-center">
              <p className="text-gray-400 text-sm font-medium mb-2">Earnings Example</p>
              <p className="text-white text-sm">
                On <span className="text-green-400 font-bold">$100</span> sale:
              </p>
              <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                <li>Free: <span className="text-gray-400">${100 - (100 * commissionRates.free / 100)} net</span></li>
                <li>Basic: <span className="text-blue-400">${100 - (100 * commissionRates.tier_2 / 100)} net</span></li>
                <li>Premium: <span className="text-yellow-400">${100 - (100 * commissionRates.tier_3 / 100)} net</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Grid */}
      <div className="space-y-4">
        {pricing && Object.entries(pricing).map(([roleKey, roleData]) => {
          const config = ROLE_CONFIG[roleKey] || { label: roleKey, color: 'bg-zinc-700', icon: '?' };
          const isExpanded = expandedRoles[roleKey] ?? true;
          
          return (
            <div key={roleKey} className="bg-zinc-900 rounded-xl overflow-hidden">
              {/* Role Header */}
              <button
                onClick={() => toggleRoleExpand(roleKey)}
                className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <div>
                    <h3 className="text-white font-bold text-left">{roleData.role_label || config.label}</h3>
                    <p className="text-gray-500 text-sm">
                      {Object.keys(roleData.tiers).length} tier{Object.keys(roleData.tiers).length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Quick price display */}
                  <div className="hidden md:flex items-center gap-2">
                    {Object.entries(roleData.tiers).map(([tierKey, tierData]) => (
                      <Badge key={tierKey} className={config.color}>
                        {TIER_LABELS[tierKey] || tierKey}: ${tierData.price}
                      </Badge>
                    ))}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Tier Details */}
              {isExpanded && (
                <div className="border-t border-zinc-800">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-zinc-800/50">
                        <tr>
                          <th className="text-left text-gray-400 text-sm font-medium p-3 w-24">Tier</th>
                          <th className="text-left text-gray-400 text-sm font-medium p-3 w-32">Name</th>
                          <th className="text-left text-gray-400 text-sm font-medium p-3 w-32">Price</th>
                          <th className="text-left text-gray-400 text-sm font-medium p-3">Features</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(roleData.tiers).map(([tierKey, tierData]) => {
                          const cellKey = `${roleKey}-${tierKey}`;
                          
                          return (
                            <tr key={tierKey} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                              <td className="p-3">
                                <Badge className={
                                  tierKey === 'tier_3' ? 'bg-yellow-500/20 text-yellow-400' :
                                  tierKey === 'tier_2' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-zinc-700 text-gray-400'
                                }>
                                  {TIER_LABELS[tierKey] || tierKey}
                                </Badge>
                              </td>
                              <td className="p-3">
                                {editingCell === `${cellKey}-name` ? (
                                  <Input
                                    value={tierData.name}
                                    onChange={(e) => handleNameChange(roleKey, tierKey, e.target.value)}
                                    onBlur={() => setEditingCell(null)}
                                    autoFocus
                                    className="bg-zinc-800 border-zinc-700 text-white h-8 w-28"
                                  />
                                ) : (
                                  <button
                                    onClick={() => setEditingCell(`${cellKey}-name`)}
                                    className="text-white hover:text-cyan-400 transition-colors flex items-center gap-1"
                                  >
                                    {tierData.name}
                                    <Edit2 className="w-3 h-3 opacity-50" />
                                  </button>
                                )}
                              </td>
                              <td className="p-3">
                                {editingCell === `${cellKey}-price` ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-green-400">$</span>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={tierData.price}
                                      onChange={(e) => handlePriceChange(roleKey, tierKey, e.target.value)}
                                      onBlur={() => setEditingCell(null)}
                                      autoFocus
                                      className="bg-zinc-800 border-zinc-700 text-white h-8 w-20"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setEditingCell(`${cellKey}-price`)}
                                    className="text-green-400 font-bold hover:text-green-300 transition-colors flex items-center gap-1"
                                  >
                                    ${tierData.price}
                                    <Edit2 className="w-3 h-3 opacity-50" />
                                  </button>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1">
                                  {tierData.features.map((feature, idx) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-0.5 bg-zinc-800 text-gray-400 text-xs rounded cursor-pointer hover:bg-zinc-700"
                                      onClick={() => {
                                        const newFeature = prompt('Edit feature:', feature);
                                        if (newFeature !== null) {
                                          handleFeatureChange(roleKey, tierKey, idx, newFeature);
                                        }
                                      }}
                                    >
                                      {feature}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-800">
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="bg-green-500 hover:bg-green-600 text-black flex-1 sm:flex-none"
          data-testid="save-pricing-btn"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
        
        <Button
          onClick={() => {
            fetchHistory();
            setShowHistory(!showHistory);
          }}
          variant="outline"
          className="border-zinc-700 text-gray-400"
        >
          <History className="w-4 h-4 mr-2" />
          History
        </Button>
        
        <Button
          onClick={handleReset}
          disabled={saving}
          variant="outline"
          className="border-red-500/50 text-red-400 hover:bg-red-500/10"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset to Defaults
        </Button>
      </div>

      {/* History Panel */}
      {showHistory && history.length > 0 && (
        <div className="bg-zinc-900 rounded-xl p-4">
          <h4 className="text-white font-medium mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            Pricing History
          </h4>
          <div className="space-y-2">
            {history.map((entry, _idx) => (
              <div
                key={entry.version}
                className={`flex items-center justify-between p-2 rounded-lg ${
                  entry.is_active ? 'bg-green-500/10 border border-green-500/30' : 'bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Badge className={entry.is_active ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-gray-400'}>
                    v{entry.version}
                  </Badge>
                  {entry.is_active && (
                    <span className="text-green-400 text-xs flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Active
                    </span>
                  )}
                </div>
                <span className="text-gray-500 text-sm">
                  {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPricingEditor;
