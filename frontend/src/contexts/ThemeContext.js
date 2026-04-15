import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext();

// Theme color values for meta tag
const THEME_COLORS = {
  light: '#FFFFFF',
  dark: '#09090B',  // zinc-950
  beach: '#000000'  // pure black
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('raw-surf-theme') || 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'beach-mode');
    
    if (theme === 'beach') {
      root.classList.add('beach-mode');
    } else {
      root.classList.add(theme);
    }
    
    localStorage.setItem('raw-surf-theme', theme);
    
    // ============ DYNAMIC THEME-COLOR META TAG ============
    // Update the theme-color meta tag for browser chrome/status bar
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.dark);
    }
    
    // Also update apple-mobile-web-app-status-bar-style for iOS
    const appleStatusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleStatusBar) {
      // Use 'default' for light (shows dark text), 'black-translucent' for dark themes (shows light text)
      appleStatusBar.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
    }
  }, [theme]);

  const toggleTheme = (newTheme) => {
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};