/**
 * AdminPersonaPanel - God Mode Persona Switcher
 * Extracted from UnifiedAdminConsole.js (v76 decomposition)
 */
import React from 'react';
import { Check } from 'lucide-react';
import { ALL_PERSONAS, getExpandedRoleInfo } from '../../contexts/PersonaContext';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

export const AdminPersonaPanel = ({
  activePersona,
  handleSelectPersona,
  cardBgClass,
  textClass,
  textSecondary,
}) => {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);

  return (
    <div className="space-y-4">
      <p className={`text-sm ${textSecondary} text-center`}>
        Select a persona to test how different users experience the app
      </p>
      
      <div className="grid grid-cols-1 gap-2">
        {ALL_PERSONAS.map((persona) => {
          const isActive = activePersona === persona.id;
          const roleInfo = getExpandedRoleInfo(persona.id);
          const colorClass = `text-${roleInfo?.color || 'cyan'}-400`;
          
          return (
            <button
              key={persona.id}
              onClick={() => handleSelectPersona(persona)}
              className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                isActive 
                  ? 'border-yellow-400 bg-yellow-400/10' 
                  : `${cardBgClass} hover:bg-amber-100/50 hover:border-amber-300 dark:hover:bg-zinc-800/40 dark:hover:border-zinc-600`
              }`}
              data-testid={`persona-${persona.id.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border-2 border-current">
                  <AvatarFallback className={`${t.avatarBg} ${colorClass}`}>
                    {persona.label.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${textClass}`}>{persona.label}</span>
                    {isActive && (
                      <span className="px-2 py-0.5 bg-yellow-400 text-black text-xs font-bold rounded-full">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    {roleInfo?.category || 'User'} - {roleInfo?.description || 'Test this role'}
                  </p>
                </div>
                {isActive && <Check className="w-5 h-5 text-yellow-400" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminPersonaPanel;
