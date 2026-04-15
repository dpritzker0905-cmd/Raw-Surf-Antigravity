import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import { 
  Users, Plus, Star, Check, Trash2, Edit2, 
  Loader2, ChevronDown, Clock, UserPlus, Save
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * SavedCrewSelector - Quick-select saved crew presets
 * For Pro/Comp surfers to initiate beach sessions in under 5 seconds
 */

export const SavedCrewSelector = ({ 
  onSelect,
  selectedCrew,
  currentMembers = [],
  compact = false
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [savedCrews, setSavedCrews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savingCrew, setSavingCrew] = useState(false);
  const [newCrewName, setNewCrewName] = useState('');
  const [setAsDefault, setSetAsDefault] = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchSavedCrews();
    }
  }, [user?.id]);

  const fetchSavedCrews = async () => {
    try {
      const response = await axios.get(`${API}/api/crews/saved?user_id=${user.id}`);
      setSavedCrews(response.data.crews || []);
    } catch (error) {
      logger.error('Failed to fetch saved crews:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCrew = async (crew) => {
    // Mark as used
    try {
      await axios.post(`${API}/api/crews/saved/${crew.id}/use?user_id=${user.id}`);
    } catch (error) {
      logger.error('Failed to mark crew as used:', error);
    }
    
    // Convert to member format expected by booking flow
    const members = (crew.members || []).map(m => ({
      type: m.user_id ? 'username' : 'email',
      value: m.username || m.email || m.name,
      user_id: m.user_id,
      name: m.name,
      avatar_url: m.avatar_url
    }));
    
    onSelect?.(members, crew);
    setShowDropdown(false);
    toast.success(`Loaded "${crew.name}"!`);
  };

  const handleSaveCurrentCrew = async () => {
    if (!newCrewName.trim()) {
      toast.error('Please enter a crew name');
      return;
    }
    
    if (currentMembers.length === 0) {
      toast.error('Add crew members first');
      return;
    }
    
    setSavingCrew(true);
    try {
      const membersData = currentMembers.map(m => ({
        user_id: m.user_id || null,
        name: m.name || m.value,
        email: m.type === 'email' ? m.value : null,
        username: m.type === 'username' ? m.value : null,
        avatar_url: m.avatar_url || null
      }));
      
      await axios.post(`${API}/api/crews/saved?user_id=${user.id}`, {
        name: newCrewName,
        members: membersData,
        is_default: setAsDefault
      });
      
      toast.success(`Saved "${newCrewName}" as a crew preset!`);
      setShowSaveDialog(false);
      setNewCrewName('');
      setSetAsDefault(false);
      fetchSavedCrews();
    } catch (error) {
      logger.error('Failed to save crew:', error);
      toast.error('Failed to save crew');
    } finally {
      setSavingCrew(false);
    }
  };

  const handleSetDefault = async (crewId) => {
    try {
      await axios.post(`${API}/api/crews/saved/${crewId}/set-default?user_id=${user.id}`);
      toast.success('Default crew updated!');
      fetchSavedCrews();
    } catch (error) {
      toast.error('Failed to set default');
    }
  };

  const handleDeleteCrew = async (crewId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this saved crew?')) return;
    
    try {
      await axios.delete(`${API}/api/crews/saved/${crewId}?user_id=${user.id}`);
      toast.success('Crew deleted');
      fetchSavedCrews();
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  // Compact mode for inline use
  if (compact) {
    return (
      <div className="relative" data-testid="saved-crew-selector-compact">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDropdown(!showDropdown)}
          className={`${isLight ? 'border-gray-300' : 'border-zinc-600'} gap-2`}
        >
          <Users className="w-4 h-4" />
          Saved Crews
          <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </Button>
        
        {showDropdown && (
          <div className={`absolute top-full left-0 mt-1 w-64 rounded-lg shadow-xl z-50 ${
            isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-700'
          }`}>
            {loading ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
              </div>
            ) : savedCrews.length === 0 ? (
              <div className="p-4 text-center">
                <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  No saved crews yet
                </p>
                {currentMembers.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => { setShowDropdown(false); setShowSaveDialog(true); }}
                    className="mt-2 bg-cyan-500 hover:bg-cyan-400 text-black"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save Current
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {savedCrews.map((crew) => (
                  <button
                    key={crew.id}
                    onClick={() => handleSelectCrew(crew)}
                    className={`w-full p-3 flex items-center justify-between hover:${isLight ? 'bg-gray-50' : 'bg-zinc-800'} transition-colors ${
                      selectedCrew?.id === crew.id ? (isLight ? 'bg-cyan-50' : 'bg-cyan-500/10') : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {crew.is_default && <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />}
                      <div className="text-left">
                        <p className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
                          {crew.name}
                        </p>
                        <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                          {crew.member_count} member{crew.member_count !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedCrew?.id === crew.id && (
                        <Check className="w-4 h-4 text-cyan-400" />
                      )}
                      <button
                        onClick={(e) => handleDeleteCrew(crew.id, e)}
                        className="p-1 hover:bg-red-500/20 rounded"
                      >
                        <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-400" />
                      </button>
                    </div>
                  </button>
                ))}
                
                {currentMembers.length > 0 && (
                  <button
                    onClick={() => { setShowDropdown(false); setShowSaveDialog(true); }}
                    className={`w-full p-3 flex items-center gap-2 ${isLight ? 'border-t border-gray-100 text-cyan-600' : 'border-t border-zinc-700 text-cyan-400'} hover:${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm">Save Current Crew</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Save Dialog */}
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent className={isLight ? 'bg-white' : 'bg-zinc-900 border-zinc-800'}>
            <DialogHeader>
              <DialogTitle className={isLight ? 'text-gray-900' : 'text-white'}>
                Save Crew Preset
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div>
                <label className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                  Crew Name
                </label>
                <Input
                  value={newCrewName}
                  onChange={(e) => setNewCrewName(e.target.value)}
                  placeholder="e.g., Dawn Patrol Crew"
                  className={`mt-1 ${isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}`}
                />
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="setDefault"
                  checked={setAsDefault}
                  onChange={(e) => setSetAsDefault(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="setDefault" className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                  Set as default for On-Demand sessions
                </label>
              </div>
              
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}>
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} mb-2`}>
                  Members ({currentMembers.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {currentMembers.map((m, i) => (
                    <Badge key={i} className="bg-cyan-500/20 text-cyan-400">
                      {m.name || m.value}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSaveCurrentCrew}
                disabled={savingCrew}
                className="bg-cyan-500 hover:bg-cyan-400 text-black"
              >
                {savingCrew ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Crew
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Full mode for crew hub
  return (
    <div className={`p-4 rounded-xl ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`} data-testid="saved-crew-selector">
      <div className="flex items-center justify-between mb-3">
        <h4 className={`text-sm font-medium flex items-center gap-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
          <Users className="w-4 h-4" />
          Saved Crews
        </h4>
        {currentMembers.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSaveDialog(true)}
            className="text-cyan-400"
          >
            <Plus className="w-4 h-4 mr-1" />
            Save Current
          </Button>
        )}
      </div>
      
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
        </div>
      ) : savedCrews.length === 0 ? (
        <p className={`text-sm text-center py-4 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
          No saved crews yet. Add crew members and save them for quick access!
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {savedCrews.map((crew) => (
            <button
              key={crew.id}
              onClick={() => handleSelectCrew(crew)}
              className={`p-3 rounded-lg text-left transition-all hover:scale-[1.02] ${
                selectedCrew?.id === crew.id 
                  ? 'bg-cyan-500/20 border-2 border-cyan-400' 
                  : isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-1 mb-1">
                {crew.is_default && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                <span className={`text-sm font-medium truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>
                  {crew.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {crew.member_count} members
                </Badge>
                {crew.times_used > 0 && (
                  <span className={`text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                    Used {crew.times_used}x
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      
      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className={isLight ? 'bg-white' : 'bg-zinc-900 border-zinc-800'}>
          <DialogHeader>
            <DialogTitle className={isLight ? 'text-gray-900' : 'text-white'}>
              Save Crew Preset
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                Crew Name
              </label>
              <Input
                value={newCrewName}
                onChange={(e) => setNewCrewName(e.target.value)}
                placeholder="e.g., Dawn Patrol Crew"
                className={`mt-1 ${isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}`}
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="setDefaultFull"
                checked={setAsDefault}
                onChange={(e) => setSetAsDefault(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="setDefaultFull" className={`text-sm ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                Set as default for On-Demand sessions
              </label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveCurrentCrew}
              disabled={savingCrew}
              className="bg-cyan-500 hover:bg-cyan-400 text-black"
            >
              {savingCrew ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save Crew
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SavedCrewSelector;
