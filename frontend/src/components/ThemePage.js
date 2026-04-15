import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Moon, Sun, Waves, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

export const ThemePage = () => {
  const { theme, toggleTheme } = useTheme();

  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-900' : 'bg-zinc-800 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';

  // Get dynamic icon for current theme
  const getCurrentThemeIcon = () => {
    if (theme === 'light') return Sun;
    if (theme === 'beach') return Waves;
    return Moon;
  };
  const CurrentIcon = getCurrentThemeIcon();

  const themes = [
    { 
      value: 'light', 
      label: 'Light Mode', 
      icon: Sun, 
      description: 'Clean and bright for daytime use',
      gradient: 'from-yellow-100 to-orange-100',
    },
    { 
      value: 'dark', 
      label: 'Dark Mode', 
      icon: Moon, 
      description: 'Easy on the eyes for night sessions',
      gradient: 'from-zinc-700 to-zinc-900',
    },
    { 
      value: 'beach', 
      label: 'Beach Mode', 
      icon: Waves, 
      description: 'High contrast for outdoor visibility',
      gradient: 'from-cyan-400 to-blue-500',
    },
  ];

  return (
    <div className={`pb-20 ${mainBgClass} min-h-screen transition-colors duration-300`} data-testid="theme-page">
      <div className="max-w-md mx-auto p-4">
        {/* Header with Dynamic Icon */}
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            isLight ? 'bg-gray-100' : 'bg-zinc-800'
          }`}>
            <CurrentIcon className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
              Theme
            </h1>
            <p className={`text-sm ${textSecondaryClass}`}>Customize your visual experience</p>
          </div>
        </div>

        {/* Theme Options */}
        <Card className={`${cardBgClass} transition-colors duration-300`}>
          <CardHeader>
            <CardTitle className={`${textPrimaryClass} text-lg`}>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {themes.map((t) => {
              const Icon = t.icon;
              const isSelected = theme === t.value;
              
              return (
                <button
                  key={t.value}
                  onClick={() => toggleTheme(t.value)}
                  className={`w-full p-4 rounded-xl border-2 transition-all duration-200 ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-400/10'
                      : isLight 
                        ? 'border-gray-200 hover:border-gray-300 hover:bg-gray-50' 
                        : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/50'
                  }`}
                  data-testid={`theme-${t.value}`}
                >
                  <div className="flex items-center gap-4">
                    {/* Theme Preview */}
                    <div className={`w-14 h-14 rounded-lg bg-gradient-to-br ${t.gradient} flex items-center justify-center shadow-lg`}>
                      <Icon className={`w-7 h-7 ${t.value === 'dark' ? 'text-white' : 'text-black/70'}`} />
                    </div>
                    
                    {/* Theme Info */}
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${textPrimaryClass}`}>{t.label}</span>
                        {isSelected && (
                          <span className="px-2 py-0.5 bg-cyan-400 text-black text-xs font-bold rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            Active
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${textSecondaryClass} mt-0.5`}>{t.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* System Preview - No user data */}
        <Card className={`${cardBgClass} mt-4 transition-colors duration-300`}>
          <CardHeader>
            <CardTitle className={`${textPrimaryClass} text-lg`}>System Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-700/50'}`}>
              {/* Color Palette Preview */}
              <div className="flex gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-cyan-400" title="Primary" />
                <div className={`w-8 h-8 rounded-full ${isLight ? 'bg-gray-300' : 'bg-zinc-600'}`} title="Secondary" />
                <div className={`w-8 h-8 rounded-full ${isLight ? 'bg-gray-900' : 'bg-white'}`} title="Text" />
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400" title="Accent" />
              </div>
              
              {/* Typography Preview */}
              <div className="space-y-1">
                <p className={`font-bold ${textPrimaryClass}`}>Heading Text</p>
                <p className={`text-sm ${textSecondaryClass}`}>Body text appears like this</p>
                <p className="text-xs text-cyan-400">Links and accents</p>
              </div>
              
              {/* Button Preview */}
              <div className="flex gap-2 mt-3">
                <span className="px-3 py-1.5 bg-cyan-400 text-black text-xs font-medium rounded-lg">
                  Primary Button
                </span>
                <span className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                  isLight ? 'border-gray-300 text-gray-700' : 'border-zinc-600 text-gray-300'
                }`}>
                  Secondary
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info */}
        <p className={`text-center text-xs ${textSecondaryClass} mt-6`}>
          Theme preference is saved automatically.
        </p>
      </div>
    </div>
  );
};

export default ThemePage;
