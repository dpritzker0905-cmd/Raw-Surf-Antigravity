import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, AtSign, Clock, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';

export const UsernameCard = ({ userId, _textPrimaryClass, textSecondaryClass, borderClass, cardBgClass }) => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (userId) fetchStatus(); }, [userId]);

  const fetchStatus = async () => {
    try {
      const response = await apiClient.get(`/username/status`);
      setStatus(response.data);
      setNewUsername(response.data.username || '');
    } catch (error) {
      logger.error('Failed to fetch username status:', error);
    } finally { setLoading(false); }
  };

  const checkAvailability = async (username) => {
    if (!username || username.length < 3) { setAvailability(null); return; }
    setChecking(true);
    try {
      const response = await apiClient.get(`/username/check/${username}`);
      setAvailability(response.data);
    } catch (error) {
      setAvailability({ available: false, reason: 'Unable to check' });
    } finally { setChecking(false); }
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (editing && newUsername && newUsername !== status?.username) checkAvailability(newUsername);
    }, 400);
    return () => clearTimeout(debounce);
  }, [newUsername, editing, status?.username]);

  const handleSave = async () => {
    if (!availability?.available && newUsername !== status?.username) { toast.error('Username not available'); return; }
    setSaving(true);
    try {
      if (status?.has_username) { await apiClient.put(`/username/change`, { new_username: newUsername }); }
      else { await apiClient.post(`/username/set`, { username: newUsername }); }
      toast.success(`Username updated to @${newUsername}`);
      setEditing(false);
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update username');
    } finally { setSaving(false); }
  };

  if (loading) return (<div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-cyan-500" /></div>);

  return (
    <div className="space-y-4">
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2"><AtSign className="w-4 h-4 text-cyan-400" /><span className={textSecondaryClass}>Username</span></div>
        {status?.username ? (<span className="text-cyan-400 font-medium">@{status.username}</span>) : (<Badge className="bg-yellow-500/20 text-yellow-400">Not Set</Badge>)}
      </div>
      {editing ? (
        <div className="space-y-3">
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondaryClass}`}>@</span>
            <Input aria-label="username" value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} className={`pl-8 ${cardBgClass} ${borderClass}`} placeholder="username" maxLength={30} />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {checking ? (<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />) : availability?.available ? (<Check className="w-4 h-4 text-green-500" />) : availability && !availability.available && newUsername !== status?.username ? (<AlertCircle className="w-4 h-4 text-red-500" />) : null}
            </div>
          </div>
          {availability && !availability.available && newUsername !== status?.username && (<p className="text-sm text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{availability.reason}</p>)}
          <div className="flex gap-2">
            <Button aria-label="Loader2" onClick={handleSave} disabled={saving || (!availability?.available && newUsername !== status?.username)} className="flex-1 bg-cyan-500 hover:bg-cyan-600">{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Save</Button>
            <Button variant="outline" onClick={() => { setEditing(false); setNewUsername(status?.username || ''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {!status?.username ? (<Button onClick={() => navigate('/setup-username')} className="w-full bg-cyan-500 hover:bg-cyan-600"><AtSign className="w-4 h-4 mr-2" />Set Up Username</Button>
          ) : status?.can_change ? (<Button variant="outline" onClick={() => setEditing(true)} className="w-full">Change Username</Button>
          ) : (<div className={`p-3 rounded-lg ${cardBgClass} ${borderClass}`}><div className="flex items-center gap-2 text-sm text-yellow-400"><Clock className="w-4 h-4" /><span>Can change in {status.days_until_change} days</span></div><p className={`text-xs mt-1 ${textSecondaryClass}`}>Usernames can be changed once every 90 days</p></div>)}
        </>
      )}
    </div>
  );
};
