/**
 * useLocale - Custom hook for i18n functionality
 * 
 * Provides easy access to translation functions and language switching.
 * 
 * Usage:
 *   const { t, language, changeLanguage, languages } = useLocale();
 *   
 *   // Translate a key
 *   <p>{t('common.welcome')}</p>
 *   
 *   // With interpolation
 *   <p>{t('booking.goldPass.exclusiveSlots', { count: 5 })}</p>
 *   
 *   // Change language
 *   changeLanguage('es');
 */

import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

// Supported languages with display names
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', nativeName: 'English' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷', nativeName: 'Português' },
];

export const useLocale = (namespace = 'common') => {
  const { t, i18n } = useTranslation(namespace);
  
  // Current language code
  const language = i18n.language?.split('-')[0] || 'en';
  
  // Get language info object
  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === language) 
    || SUPPORTED_LANGUAGES[0];
  
  // Change language function
  const changeLanguage = useCallback((langCode) => {
    i18n.changeLanguage(langCode);
  }, [i18n]);
  
  // Check if a language is active
  const isLanguage = useCallback((langCode) => {
    return language === langCode;
  }, [language]);
  
  // Format number according to locale
  const formatNumber = useCallback((num) => {
    return new Intl.NumberFormat(language).format(num);
  }, [language]);
  
  // Format currency according to locale
  const formatCurrency = useCallback((amount, currency = 'USD') => {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
    }).format(amount);
  }, [language]);
  
  // Format date according to locale
  const formatDate = useCallback((date, options = {}) => {
    return new Intl.DateTimeFormat(language, options).format(new Date(date));
  }, [language]);
  
  // Format relative time (e.g., "2 hours ago")
  const formatRelativeTime = useCallback((date) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return t('time.justNow');
    if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
    
    return formatDate(date, { month: 'short', day: 'numeric' });
  }, [t, formatDate]);
  
  return {
    // Translation function
    t,
    
    // Language info
    language,
    currentLanguage,
    languages: SUPPORTED_LANGUAGES,
    
    // Language switching
    changeLanguage,
    isLanguage,
    
    // Formatting helpers
    formatNumber,
    formatCurrency,
    formatDate,
    formatRelativeTime,
    
    // Raw i18n instance (for advanced usage)
    i18n,
  };
};

export default useLocale;
