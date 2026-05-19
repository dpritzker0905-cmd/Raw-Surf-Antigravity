import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Users, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { ROLES } from '../../constants/roles';

/**
 * GromParentCard -- Lets any non-Grom surfer opt in to Grom Parent mode.
 * Being a Grom Parent is an AND: a Competitive Surfer can ALSO be a Grom Parent.
 * Enabling it gives access to GromHQ, parental controls, and Grom gallery management.
 */
export const GromParentCard = ({ textPrimaryClass, textSecondaryClass, cardBgClass }) => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [toggling, setToggling] = useState(false);
  // Dedicated Grom Parent accounts have is_grom_parent true by default in login response
  const isDedicatedGromParent = user?.role === ROLES.GROM_PARENT;
  const isEnabled = isDedicatedGromParent || user?.is_grom_parent === true;

  const handleToggle = async () => {
    if (isDedicatedGromParent) return; // Can't toggle off a dedicated account
    setToggling(true);
    const newVal = !user?.is_grom_parent;
    try {
      await apiClient.patch(`/profiles/${user.id}`, { is_grom_parent: newVal });
      updateUser({ ...user, is_grom_parent: newVal });
      if (newVal) {
 toast.success('Grom Parent mode enabled -- access GromHQ to link your child\'s account');
      } else {
        toast.success('Grom Parent mode disabled');
      }
    } catch (e) {
      toast.error('Failed to update Grom Parent setting');
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Users className="w-5 h-5 text-pink-400" />
          Grom Parent
          {isEnabled && (
            <span className="ml-auto px-2 py-0.5 bg-pink-500/20 text-pink-400 text-xs rounded-full border border-pink-500/30">
              Active
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isDedicatedGromParent ? (
          <p className={`text-xs ${textSecondaryClass}`}>
            Your account is a dedicated Grom Parent account. Head to GromHQ to manage your child's profile, parental controls, and linked sessions.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${textPrimaryClass}`}>Enable Grom Parent Mode</p>
              <p className={`text-xs ${textSecondaryClass} mt-0.5`}>
                Adds GromHQ access to link and manage your child's Grom account alongside your surfer identity.
              </p>
            </div>
            <button
              id="grom-parent-toggle"
              onClick={handleToggle}
              disabled={toggling}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                isEnabled ? 'bg-pink-500' : 'bg-zinc-600'
              }`}
            >
              <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                isEnabled ? 'left-5' : 'left-0.5'
              }`} />
            </button>
          </div>
        )}
        {isEnabled && (
          <button
            id="goto-gromhq"
            onClick={() => navigate('/grom-hq')}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 text-sm font-medium hover:bg-pink-500/20 transition-colors"
          >
            <span>Open GromHQ</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </CardContent>
    </Card>
  );
};
