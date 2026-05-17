import React, { useState } from 'react';
import { Loader2, ChevronDown, Check, Eye, EyeOff, Shield, Lock, KeyRound, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';

/**
 * PasswordSecurityCard - Allows authenticated users to change their password.
 * Uses current password as 2FA verification before accepting a new password.
 */
export var PasswordSecurityCard = ({ textPrimaryClass, textSecondaryClass, borderClass, cardBgClass, expandedSections, toggleSection }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const getPasswordStrength = (password) => {
    if (!password) return { score: 0, label: '', color: '' };
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' };
    if (score === 2) return { score: 2, label: 'Fair', color: 'bg-orange-500' };
    if (score === 3) return { score: 3, label: 'Good', color: 'bg-yellow-500' };
    if (score >= 4) return { score: 4, label: 'Strong', color: 'bg-green-500' };
    return { score: 0, label: '', color: '' };
  };

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const canSubmit = currentPassword && newPassword.length >= 6 && passwordsMatch && !saving;

  const handleChangePassword = async () => {
    setError(''); setSuccess(false);
    if (newPassword !== confirmPassword) { setError('New passwords do not match'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (newPassword === currentPassword) { setError('New password must be different from current password'); return; }
    setSaving(true);
    try {
      await apiClient.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      setSuccess(true); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      toast.success('Password changed successfully!');
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to change password';
      setError(detail); toast.error(detail);
    } finally { setSaving(false); }
  };

  const resetForm = () => { setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setError(''); setSuccess(false); };

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="password-security-card">
      <CardHeader className="cursor-pointer" onClick={() => toggleSection('security')}>
        <div className="flex items-center justify-between">
          <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Lock className="w-5 h-5 text-amber-400" />Password & Security
          </CardTitle>
          <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.security ? 'rotate-180' : ''}`} />
        </div>
      </CardHeader>
      {expandedSections.security && (
        <CardContent className="space-y-4">
          {success && (<div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center gap-2"><Check className="w-5 h-5 text-green-400 flex-shrink-0" /><div><p className="text-green-400 font-medium text-sm">Password Updated</p><p className={`text-xs ${textSecondaryClass}`}>Your password has been changed successfully.</p></div></div>)}
          {error && (<div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" /><p className="text-red-400 text-sm">{error}</p></div>)}

          <div className="flex items-center gap-2 pb-2"><KeyRound className="w-4 h-4 text-amber-400" /><p className={`text-sm font-medium ${textPrimaryClass}`}>Change Password</p></div>
          <p className={`text-xs ${textSecondaryClass} -mt-2`}>Enter your current password as verification, then choose a new password.</p>

          {/* Current Password */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium ${textSecondaryClass} flex items-center gap-1`}><Shield className="w-3 h-3 text-amber-400" />Current Password (required for verification)</label>
            <div className="relative">
              <Input id="current-password" type={showCurrent ? 'text' : 'password'} value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setError(''); setSuccess(false); }} placeholder="Enter current password" className={`${cardBgClass} ${borderClass} pr-10`} autoComplete="current-password" />
              <button type="button" aria-expanded={showCurrent} onClick={() => setShowCurrent(!showCurrent)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textSecondaryClass} hover:text-foreground transition-colors`} tabIndex={-1} aria-label="Hide">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className={`border-t ${borderClass}`} />

          {/* New Password */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium ${textSecondaryClass}`}>New Password</label>
            <div className="relative">
              <Input id="new-password" type={showNew ? 'text' : 'password'} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setError(''); setSuccess(false); }} placeholder="Enter new password (min 6 chars)" className={`${cardBgClass} ${borderClass} pr-10`} autoComplete="new-password" />
              <button type="button" aria-expanded={showNew} onClick={() => setShowNew(!showNew)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textSecondaryClass} hover:text-foreground transition-colors`} tabIndex={-1} aria-label="Hide">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {newPassword && (
              <div className="space-y-1">
                <div className="flex gap-1">{[1,2,3,4].map((level) => (<div key={level} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${level <= strength.score ? strength.color : 'bg-muted'}`} />))}</div>
                <p className={`text-xs ${strength.score <= 1 ? 'text-red-400' : strength.score === 2 ? 'text-orange-400' : strength.score === 3 ? 'text-yellow-400' : 'text-green-400'}`}>{strength.label}{strength.score <= 2 && ' - try adding uppercase, numbers, or symbols'}</p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label className={`text-xs font-medium ${textSecondaryClass}`}>Confirm New Password</label>
            <div className="relative">
              <Input id="confirm-password" type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }} placeholder="Re-enter new password" className={`${cardBgClass} ${borderClass} pr-10`} autoComplete="new-password" />
              <button type="button" aria-expanded={showConfirm} onClick={() => setShowConfirm(!showConfirm)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${textSecondaryClass} hover:text-foreground transition-colors`} tabIndex={-1} aria-label="Hide">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmPassword && (<p className={`text-xs flex items-center gap-1 ${passwordsMatch ? 'text-green-400' : 'text-red-400'}`}>{passwordsMatch ? (<><Check className="w-3 h-3" /> Passwords match</>) : (<><AlertCircle className="w-3 h-3" /> Passwords do not match</>)}</p>)}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button aria-label="Loader2" id="change-password-btn" onClick={handleChangePassword} disabled={!canSubmit} className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold disabled:opacity-40" data-testid="change-password-btn">
              {saving ? (<><Loader2 className="w-4 h-4 animate-spin mr-2" /> Updating...</>) : (<><Lock className="w-4 h-4 mr-2" /> Update Password</>)}
            </Button>
            {(currentPassword || newPassword || confirmPassword) && (<Button variant="outline" onClick={resetForm} className={`${borderClass} ${textSecondaryClass}`}>Clear</Button>)}
          </div>

          {/* Security Tips */}
          <div className={`p-3 rounded-xl bg-muted/40 border ${borderClass} mt-2`}>
            <p className={`text-xs font-medium ${textPrimaryClass} mb-1.5 flex items-center gap-1`}><Shield className="w-3 h-3 text-amber-400" /> Security Tips</p>
            <ul className={`text-xs ${textSecondaryClass} space-y-1 list-none`}>
              <li>- Use a unique password you don't use elsewhere</li>
              <li>- Mix uppercase, lowercase, numbers & symbols</li>
              <li>- Aim for 10+ characters for maximum security</li>
              <li>- Never share your password with anyone</li>
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
