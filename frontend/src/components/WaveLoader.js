import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeTokens } from '../utils/themeTokens';

/**
 * WaveLoader - Surfing-themed loading animation for the Map
 * 
 * Features:
 * - Animated wave pattern that adapts to light/dark/beach themes
 * - Brand logo integration
 * - Subtle breathing animation on text
 * - Minimalist aesthetic
 */
export const WaveLoader = () => {
  const { theme } = useTheme();
  const t = getThemeTokens(theme);

  // Theme-aware wave fill colors (not class-based, needs raw hex)
  const bgColor = t.isLight ? '#f5f5f5' : t.isBeach ? '#fffbeb' : '#1a1a1a';
  const wave1 = t.isLight ? '#e5e7eb' : t.isBeach ? '#fde68a' : '#252525';
  const wave2 = t.isLight ? '#d1d5db' : t.isBeach ? '#fbbf24' : '#2a2a2a';
  const wave3 = t.isLight ? '#c4c8cf' : t.isBeach ? '#f59e0b' : '#303030';
  const dotColor = t.isLight ? 'bg-blue-400' : t.isBeach ? 'bg-amber-500' : 'bg-cyan-400';

  return (
    <div className={`h-full w-full flex flex-col items-center justify-center relative overflow-hidden`} style={{ backgroundColor: bgColor }}>
      {/* Animated Wave Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Wave 1 - Slowest, largest */}
        <svg 
          className="absolute bottom-0 w-[200%] animate-wave-slow"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          style={{ height: '40%', minHeight: '200px' }}
        >
          <path 
            fill={wave1} 
            d="M0,160L48,170.7C96,181,192,203,288,192C384,181,480,139,576,138.7C672,139,768,181,864,197.3C960,213,1056,203,1152,181.3C1248,160,1344,128,1392,112L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          />
        </svg>
        
        {/* Wave 2 - Medium speed */}
        <svg 
          className="absolute bottom-0 w-[200%] animate-wave-medium"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          style={{ height: '35%', minHeight: '175px' }}
        >
          <path 
            fill={wave2} 
            d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,218.7C672,235,768,245,864,234.7C960,224,1056,192,1152,181.3C1248,171,1344,181,1392,186.7L1440,192L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          />
        </svg>
        
        {/* Wave 3 - Fastest, front */}
        <svg 
          className="absolute bottom-0 w-[200%] animate-wave-fast"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          style={{ height: '30%', minHeight: '150px' }}
        >
          <path 
            fill={wave3} 
            d="M0,288L48,272C96,256,192,224,288,213.3C384,203,480,213,576,229.3C672,245,768,267,864,261.3C960,256,1056,224,1152,208C1248,192,1344,192,1392,192L1440,192L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          />
        </svg>
      </div>
      
      {/* Center Content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <img
          src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
          alt="Raw Surf"
          className="w-20 h-20 mb-6 animate-pulse"
          style={{ animationDuration: '2s' }}
        />
        
        {/* Loading Text */}
        <div className="text-center">
          <h2 
            className={`text-2xl font-bold ${t.textPrimary} mb-2 animate-pulse`}
            style={{ fontFamily: 'Oswald', animationDuration: '2s' }}
          >
            Loading Waves
          </h2>
          <p className={`${t.textMuted} text-sm`}>
            Finding surf spots near you...
          </p>
        </div>
        
        {/* Subtle loading indicator */}
        <div className="mt-6 flex gap-1">
          <div className={`w-2 h-2 ${dotColor} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }}></div>
          <div className={`w-2 h-2 ${dotColor} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }}></div>
          <div className={`w-2 h-2 ${dotColor} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }}></div>
        </div>
      </div>
      
      {/* Custom Wave Animation Styles */}
      <style>{`
        @keyframes wave-slow {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes wave-medium {
          0% { transform: translateX(-25%); }
          100% { transform: translateX(-75%); }
        }
        @keyframes wave-fast {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .animate-wave-slow {
          animation: wave-slow 15s linear infinite;
        }
        .animate-wave-medium {
          animation: wave-medium 10s linear infinite;
        }
        .animate-wave-fast {
          animation: wave-fast 7s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default WaveLoader;
