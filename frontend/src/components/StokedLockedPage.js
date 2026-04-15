import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Lock, Zap, Trophy, Target, ChevronRight, Waves } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';

/**
 * Stoked Locked Page - For regular Surfers who haven't competed
 * Shows how to unlock the Stoked Sponsorship Engine
 */
export const StokedLockedPage = () => {
  const { theme } = useTheme();
  const navigate = useNavigate();

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  return (
    <div 
      className="space-y-6 pb-24 md:pb-6 flex flex-col items-center justify-center min-h-[60vh]" 
      data-testid="stoked-locked-page"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
    >
      {/* Lock Icon */}
      <div className="w-24 h-24 rounded-full bg-zinc-800 border-2 border-yellow-500/30 flex items-center justify-center mb-4">
        <div className="relative">
          <Zap className="w-12 h-12 text-yellow-400/50" />
          <Lock className="w-6 h-6 text-zinc-400 absolute -bottom-1 -right-1" />
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <h1 className={`text-2xl font-bold ${textPrimary}`} style={{ fontFamily: 'Oswald' }}>
          Stoked is Locked
        </h1>
        <p className={`${textSecondary} mt-2 max-w-sm mx-auto`}>
          Compete to unlock the Stoked Sponsorship Engine
        </p>
      </div>

      {/* How to Unlock */}
      <Card className={`${cardBg} max-w-md w-full border-2 border-yellow-500/30`}>
        <CardContent className="pt-6">
          <h3 className={`${textPrimary} font-bold mb-4 flex items-center gap-2`}>
            <Target className="w-5 h-5 text-yellow-400" />
            How to Unlock
          </h3>
          
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <div className={`font-medium ${textPrimary}`}>Compete in Events</div>
                <div className={`text-sm ${textSecondary}`}>
                  Enter local, regional, or pro competitions
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                <Waves className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <div className={`font-medium ${textPrimary}`}>Log Competition Results</div>
                <div className={`text-sm ${textSecondary}`}>
                  Add your results to earn your Competitive status
                </div>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-pink-500/20 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-pink-400" />
              </div>
              <div>
                <div className={`font-medium ${textPrimary}`}>Unlock Stoked</div>
                <div className={`text-sm ${textSecondary}`}>
                  Get access to sponsorships, brand credits, and more
                </div>
              </div>
            </div>
          </div>

          <Button 
            className="w-full mt-6 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
            onClick={() => navigate('/career/the-peak')}
          >
            Start Competing <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      {/* Benefits Preview */}
      <Card className={`${cardBg} max-w-md w-full opacity-75`}>
        <CardContent className="pt-4">
          <h4 className={`text-sm font-medium ${textSecondary} mb-3`}>What you'll unlock:</h4>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <div className="text-yellow-400 text-xs font-medium">Sponsorships</div>
            </div>
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <div className="text-cyan-400 text-xs font-medium">Brand Credits</div>
            </div>
            <div className="p-2 bg-pink-500/10 rounded-lg">
              <div className="text-pink-400 text-xs font-medium">Gear Discounts</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StokedLockedPage;
