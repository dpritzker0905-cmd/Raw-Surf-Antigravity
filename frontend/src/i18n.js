/**
 * i18n Configuration - Internationalization Setup
 * 
 * This sets up react-i18next for the app. Currently English-only,
 * but structured for easy addition of new languages.
 * 
 * Usage in components:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *   <p>{t('common.welcome')}</p>
 * 
 * Adding a new language:
 *   1. Create /public/locales/{lang}/common.json
 *   2. Add language code to supportedLngs array below
 *   3. That's it - language detector will handle the rest
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';

// Supported languages - add new languages here
const supportedLngs = ['en', 'es', 'pt'];

i18n
  // Load translations from /public/locales
  .use(HttpBackend)
  // Detect user language from browser
  .use(LanguageDetector)
  // Pass i18n instance to react-i18next
  .use(initReactI18next)
  .init({
    // Default/fallback language
    fallbackLng: 'en',
    
    // Supported languages
    supportedLngs,
    
    // Debug mode (disable in production)
    debug: process.env.NODE_ENV === 'development',
    
    // Namespace configuration
    ns: ['common', 'booking', 'auth', 'admin', 'profile'],
    defaultNS: 'common',
    
    // Backend configuration - where to load translations from
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    
    // Language detection configuration
    detection: {
      // Order of detection methods
      order: ['querystring', 'localStorage', 'navigator', 'htmlTag'],
      // Cache user language preference
      caches: ['localStorage'],
      // Query param to force language (?lng=es)
      lookupQuerystring: 'lng',
      // LocalStorage key
      lookupLocalStorage: 'i18nextLng',
    },
    
    // React-specific options
    react: {
      // Wait for translations to load before rendering
      useSuspense: true,
    },
    
    // Interpolation settings
    interpolation: {
      // React already escapes values
      escapeValue: false,
      // Format functions for dates, numbers, etc.
      format: (value, format, lng) => {
        if (format === 'number') {
          return new Intl.NumberFormat(lng).format(value);
        }
        if (format === 'currency') {
          return new Intl.NumberFormat(lng, {
            style: 'currency',
            currency: 'USD'
          }).format(value);
        }
        if (value instanceof Date) {
          return new Intl.DateTimeFormat(lng).format(value);
        }
        return value;
      }
    },
  });

export default i18n;
