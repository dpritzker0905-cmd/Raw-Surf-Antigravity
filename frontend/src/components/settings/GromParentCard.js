import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Users, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { ROLES } from '../../constants/roles';
import LinkMyChildPanel from '../grom/LinkMyChildPanel';

/**
 * GromParentCard -- parent tools for an adult account.
 *
 * Being a Grom Parent is no longer a switch you flip on your own profile. It starts when a child's own account
 * confirms a link with you (a one-time code from the child, or an invite the child accepts), so anyone can try
 * "Link my child" here, and the parent tools open once a link exists.
 */
export const GromParentCard = ({ textPrimaryClass, textSecondaryClass, cardBgClass }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDedicatedGromParent = user?.role === ROLES.GROM_PARENT;
  const isEnabled = isDedicatedGromParent || user?.is_grom_parent === true;

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Users className="w-5 h-5 text-pink-400" aria-hidden="true" />
          Grom Parent
          {isEnabled && (
            <span className="ml-auto px-2 py-0.5 bg-pink-500/20 text-pink-400 text-xs rounded-full border border-pink-500/30">
              Active
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEnabled ? (
          <p className={`text-xs ${textSecondaryClass}`}>
            You have a linked child. Head to GromHQ to manage their profile, parental controls, and spending.
          </p>
        ) : (
          <p className={`text-xs ${textSecondaryClass}`}>
            Parent tools open when your child links their account to yours.
          </p>
        )}
        <LinkMyChildPanel />
        {isEnabled && (
          <button
            id="goto-gromhq"
            type="button"
            onClick={() => navigate('/grom-hq')}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 text-sm font-medium hover:bg-pink-500/20 transition-colors"
          >
            <span>Open GromHQ</span>
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </CardContent>
    </Card>
  );
};
