/**
 * AdminAccessControlPanel - Site Access Code Management
 * Extracted from UnifiedAdminConsole.js (v76 decomposition)
 */
import React from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';

export const AdminAccessControlPanel = ({
  siteSettings,
  setSiteSettings,
  savingSettings,
  updateSiteSettings,
  cardBgClass,
  textClass,
}) => {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const isLight = theme === 'light';

  return (
    <Card className={cardBgClass}>
      <CardHeader>
        <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
          <Lock className="w-4 h-4 text-cyan-400" />
          Site Access Control
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Require access code to view the site during private beta
        </p>
      </CardHeader>
      <CardContent>
        {!siteSettings ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Enable/Disable Toggle */}
            <div className={`flex items-center justify-between p-4 rounded-lg ${t.cellBg}`}>
              <div>
                <p className={`${t.textPrimary} font-medium`}>Access Code Required</p>
                <p className={`${t.textSecondary} text-sm`}>
                  {siteSettings.access_code_enabled 
                    ? 'Visitors must enter code to access the site' 
                    : 'Site is publicly accessible'}
                </p>
              </div>
              <button
                onClick={() => updateSiteSettings({ access_code_enabled: !siteSettings.access_code_enabled })}
                disabled={savingSettings}
                className={`relative w-14 h-8 rounded-full transition-colors ${
                  siteSettings.access_code_enabled 
                    ? 'bg-cyan-500' 
                    : theme === 'beach'
                      ? 'bg-amber-200'
                      : isLight
                        ? 'bg-gray-200'
                        : 'bg-zinc-700'
                }`}
                data-testid="access-code-toggle"
              >
                <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                  siteSettings.access_code_enabled ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>
            
            {/* Access Code Input */}
            {siteSettings.access_code_enabled && (
              <div className={`p-4 rounded-lg ${t.cellBg}`}>
                <label className={`block font-medium mb-2 ${t.textPrimary}`}>Access Code</label>
                <div className="flex gap-2">
                  <Input
                    value={siteSettings.access_code || ''}
                    onChange={(e) => setSiteSettings(prev => ({ ...prev, access_code: e.target.value.toUpperCase() }))}
                    placeholder="Enter access code"
                    className={`border uppercase tracking-widest font-mono ${t.inputBg} ${t.textPrimary}`}
                    data-testid="access-code-input"
                  />
                  <Button aria-label="Loader2"
                    onClick={() => updateSiteSettings({ access_code: siteSettings.access_code })}
                    disabled={savingSettings}
                    className="bg-cyan-500 hover:bg-cyan-600 text-black font-bold"
                    data-testid="save-access-code-btn"
                  >
                    {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
                <p className="text-yellow-400 text-xs mt-2">
                  {String.fromCodePoint(0x26A0, 0xFE0F)} Changing the code will require ALL users to re-enter the new code
                </p>
              </div>
            )}
            
            {/* Status Indicator */}
            <div className={`p-4 rounded-lg border ${
              siteSettings.access_code_enabled 
                ? 'bg-yellow-500/10 border-yellow-500/30' 
                : 'bg-green-500/10 border-green-500/30'
            }`}>
              <p className={`text-sm font-medium ${
                siteSettings.access_code_enabled ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {siteSettings.access_code_enabled 
                  ? `${String.fromCodePoint(0x1F512)} Site is protected - Current code: ${siteSettings.access_code || 'Not set'}` 
                  : `${String.fromCodePoint(0x1F513)} Site is public - Anyone can access`}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminAccessControlPanel;
