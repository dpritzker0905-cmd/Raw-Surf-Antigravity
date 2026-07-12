import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
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
  ChevronUp,
  Tag
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import PlatformCommissionRatesSection from './pricing/PlatformCommissionRatesSection';
import SurferSubscriptionDiscountRatesSection from './pricing/SurferSubscriptionDiscountRatesSection';


// Role display config - matches all RoleEnum values
const ROLE_CONFIG = {
 surfer: { label: 'Surfer', color: 'bg-cyan-500/20 text-cyan-400', icon: '\u{1F3C4}' },
 grom: { label: 'Grom', color: 'bg-yellow-500/20 text-yellow-400', icon: '\u{1F9D2}' },
 photographer: { label: 'Photographer', color: 'bg-purple-500/20 text-purple-400', icon: '\u{1F4F7}' },
  grom_parent: { label: 'Grom Parent', color: 'bg-blue-500/20 text-blue-400', icon: '\u{1F46A}' },
 hobbyist: { label: 'Hobbyist', color: 'bg-indigo-500/20 text-indigo-400', icon: '\u{1F4F8}' },
 comp_surfer: { label: 'Competition Surfer', color: 'bg-amber-500/20 text-amber-400', icon: '\u{1F3C6}' },
  pro_surfer: { label: 'Pro Surfer', color: 'bg-gold-500/20 text-yellow-400', icon: '\u{1F947}' },
 approved_pro_photographer: { label: 'Verified Pro Photographer', color: 'bg-blue-500/20 text-blue-400', icon: '\u{2705}' },
  surf_school: { label: 'Surf School / Coach', color: 'bg-teal-500/20 text-teal-400', icon: '\u{1F3EB}' },
  shop: { label: 'Surf Shop', color: 'bg-pink-500/20 text-pink-400', icon: '\u{1F6CD}\u{FE0F}' },
  shaper: { label: 'Shaper', color: 'bg-orange-500/20 text-orange-400', icon: '\u{1FA9A}' },
 resort: { label: 'Resort / Retreat', color: 'bg-emerald-500/20 text-emerald-400', icon: '\u{1F3D6}\u{FE0F}' },
 wave_pool: { label: 'Wave Pool', color: 'bg-sky-500/20 text-sky-400', icon: '\u{1F30A}' },
 destination: { label: 'Surf Destination', color: 'bg-rose-500/20 text-rose-400', icon: '\u{1F5FA}\u{FE0F}' }
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
  const [originalCommissionRates, setOriginalCommissionRates] = useState(null);
  const [commissionHasChanges, setCommissionHasChanges] = useState(false);

  // Surfer subscription discount rates state
  const [surferDiscountRates, setSurferDiscountRates] = useState({
    free: 0,       // Free tier - no discount
    tier_2: 10,    // Basic subscribers - 10% off media purchases
    tier_3: 20,    // Premium subscribers - 20% off media purchases
  });
  const [originalSurferDiscountRates, setOriginalSurferDiscountRates] = useState(null);
  const [surferDiscountHasChanges, setSurferDiscountHasChanges] = useState(false);

  const fetchPricing = useCallback(async () => {
    try {
      const response = await apiClient.get(`/admin/pricing/config`);
      setPricing(response.data.pricing);
      setOriginalPricing(JSON.parse(JSON.stringify(response.data.pricing)));
      setVersion(response.data.version);
      setUpdatedAt(response.data.updated_at);
      setIsFromDb(response.data.is_from_db);
      setHasChanges(false);

      const fetchedCommissionRates = response.data.commission_rates || commissionRates;
      setCommissionRates(fetchedCommissionRates);
      setOriginalCommissionRates(fetchedCommissionRates);
      setCommissionHasChanges(false);

      const fetchedSurferDiscountRates = response.data.surfer_discount_rates || surferDiscountRates;
      setSurferDiscountRates(fetchedSurferDiscountRates);
      setOriginalSurferDiscountRates(fetchedSurferDiscountRates);
      setSurferDiscountHasChanges(false);
    } catch (error) {
      logger.error('Failed to fetch pricing:', error);
      toast.error('Failed to load pricing configuration');
    } finally {
      setLoading(false);
    }
    // NOTE: no eslint-disable here — this project's eslint config does NOT register the
    // react-hooks plugin, and naming an unknown rule in a disable comment is itself a
    // compile-failing error on the Netlify build (deploy 6a540b87, 2026-07-12).
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

  // Surfer discount rate change handler
  const handleSurferDiscountChange = (tierKey, newRate) => {
    const rate = Math.min(100, Math.max(0, parseInt(newRate) || 0));
    setSurferDiscountRates(prev => ({
      ...prev,
      [tierKey]: rate
    }));
    setSurferDiscountHasChanges(true);
    setHasChanges(true);
  };
  
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiClient.post(
        `/admin/pricing/update`,
        {
          ...pricing,
          commission_rates: commissionRates,
          surfer_discount_rates: surferDiscountRates
        }
      );

      setPricing(response.data.pricing);
      setOriginalPricing(JSON.parse(JSON.stringify(response.data.pricing)));
      setVersion(response.data.version);
      setUpdatedAt(new Date().toISOString());
      setIsFromDb(true);
      setHasChanges(false);

      setCommissionRates(response.data.commission_rates);
      setOriginalCommissionRates(response.data.commission_rates);
      setCommissionHasChanges(false);

      setSurferDiscountRates(response.data.surfer_discount_rates);
      setOriginalSurferDiscountRates(response.data.surfer_discount_rates);
      setSurferDiscountHasChanges(false);

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
    if (originalCommissionRates) {
      setCommissionRates({ ...originalCommissionRates });
      setCommissionHasChanges(false);
    }
    if (originalSurferDiscountRates) {
      setSurferDiscountRates({ ...originalSurferDiscountRates });
      setSurferDiscountHasChanges(false);
    }
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
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-400" />
            Pricing Configuration
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Edit subscription prices in real-time. Changes apply immediately.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge className={isFromDb ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}>
            {isFromDb ? `v${version}` : 'Default'}
          </Badge>
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
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
            <p className="text-muted-foreground text-sm">You have unsaved changes to the pricing configuration.</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDiscard}
              className="border-border text-muted-foreground"
            >
              <X className="w-4 h-4 mr-1" />
              Discard
            </Button>
            <Button aria-label="Loader2"
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
      <div className="bg-card/50 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-foreground font-medium">Stoked Credit Rate</p>
          <p className="text-muted-foreground text-sm">1 Credit = $1.00 USD (1:1 Ratio)</p>
        </div>
        <Badge className="bg-green-500/20 text-green-400 text-lg px-4 py-1">
          1:1
        </Badge>
      </div>

      <PlatformCommissionRatesSection
        commissionRates={commissionRates}
        handleCommissionRateChange={handleCommissionRateChange}
        commissionHasChanges={commissionHasChanges}
      />

      <SurferSubscriptionDiscountRatesSection
        surferDiscountRates={surferDiscountRates}
        handleSurferDiscountChange={handleSurferDiscountChange}
        surferDiscountHasChanges={surferDiscountHasChanges}
      />

      {/* Pricing Grid */}
      <div className="space-y-4">
        {pricing && Object.entries(pricing).map(([roleKey, roleData]) => {
          const config = ROLE_CONFIG[roleKey] || { label: roleKey, color: 'bg-secondary', icon: '?' };
          const isExpanded = expandedRoles[roleKey] ?? true;
          
          return (
            <div key={roleKey} className="bg-background rounded-xl overflow-hidden">
              {/* Role Header */}
              <button
                onClick={() => toggleRoleExpand(roleKey)}
                className="w-full flex items-center justify-between p-4 hover:bg-card/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <div>
                    <h3 className="text-foreground font-bold text-left">{roleData.role_label || config.label}</h3>
                    <p className="text-muted-foreground text-sm">
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
                    <ChevronUp className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Tier Details */}
              {isExpanded && (
                <div className="border-t border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-card/50">
                        <tr>
                          <th className="text-left text-muted-foreground text-sm font-medium p-3 w-24">Tier</th>
                          <th className="text-left text-muted-foreground text-sm font-medium p-3 w-32">Name</th>
                          <th className="text-left text-muted-foreground text-sm font-medium p-3 w-32">Price</th>
                          <th className="text-left text-muted-foreground text-sm font-medium p-3">Features</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(roleData.tiers).map(([tierKey, tierData]) => {
                          const cellKey = `${roleKey}-${tierKey}`;
                          
                          return (
                            <tr key={tierKey} className="border-t border-border/50 hover:bg-card/30">
                              <td className="p-3">
                                <Badge className={
                                  tierKey === 'tier_3' ? 'bg-yellow-500/20 text-yellow-400' :
                                  tierKey === 'tier_2' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-secondary text-muted-foreground'
                                }>
                                  {TIER_LABELS[tierKey] || tierKey}
                                </Badge>
                              </td>
                              <td className="p-3">
                                {editingCell === `${cellKey}-name` ? (
                                  <Input aria-label="Text input"
                                    value={tierData.name}
                                    onChange={(e) => handleNameChange(roleKey, tierKey, e.target.value)}
                                    onBlur={() => setEditingCell(null)}
                                    autoFocus
                                    className="bg-card border-border text-foreground h-8 w-28"
                                  />
                                ) : (
                                  <button aria-label="Edit"
                                    onClick={() => setEditingCell(`${cellKey}-name`)}
                                    className="text-foreground hover:text-cyan-400 transition-colors flex items-center gap-1"
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
                                    <Input aria-label="Numeric input"
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={tierData.price}
                                      onChange={(e) => handlePriceChange(roleKey, tierKey, e.target.value)}
                                      onBlur={() => setEditingCell(null)}
                                      autoFocus
                                      className="bg-card border-border text-foreground h-8 w-20"
                                    />
                                  </div>
                                ) : (
                                  <button aria-label="Edit"
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
                                      className="px-2 py-0.5 bg-card text-muted-foreground text-xs rounded cursor-pointer hover:bg-secondary"
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
      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
        <Button aria-label="Loader2"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="bg-green-500 hover:bg-green-600 text-black flex-1 sm:flex-none"
          data-testid="save-pricing-btn"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
        
        <Button aria-label="History"
          onClick={() => {
            fetchHistory();
            setShowHistory(!showHistory);
          }}
          variant="outline"
          className="border-border text-muted-foreground"
        >
          <History className="w-4 h-4 mr-2" />
          History
        </Button>
        
        <Button aria-label="Refresh"
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
        <div className="bg-background rounded-xl p-4">
          <h4 className="text-foreground font-medium mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Pricing History
          </h4>
          <div className="space-y-2">
            {history.map((entry, _idx) => (
              <div
                key={entry.version}
                className={`flex items-center justify-between p-2 rounded-lg ${
                  entry.is_active ? 'bg-green-500/10 border border-green-500/30' : 'bg-card'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Badge className={entry.is_active ? 'bg-green-500/20 text-green-400' : 'bg-secondary text-muted-foreground'}>
                    v{entry.version}
                  </Badge>
                  {entry.is_active && (
                    <span className="text-green-400 text-xs flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Active
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground text-sm">
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
