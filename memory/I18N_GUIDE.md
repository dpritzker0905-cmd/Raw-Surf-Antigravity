# Internationalization (i18n) Guide

## Overview

Raw Surf OS uses `react-i18next` for internationalization. The infrastructure is set up to support multiple languages, though currently only English is fully translated.

## Quick Start

### Using translations in a component:

```jsx
import { useLocale } from '../hooks/useLocale';

const MyComponent = () => {
  const { t, formatCurrency, formatDate } = useLocale();
  
  return (
    <div>
      {/* Simple translation */}
      <h1>{t('common.welcome')}</h1>
      
      {/* With interpolation */}
      <p>{t('booking.goldPass.exclusiveSlots', { count: 5 })}</p>
      
      {/* Format currency */}
      <p>{formatCurrency(29.99)}</p>
      
      {/* Format date */}
      <p>{formatDate(new Date(), { weekday: 'long', month: 'short', day: 'numeric' })}</p>
    </div>
  );
};
```

### Using a different namespace:

```jsx
// Default namespace is 'common'
const { t } = useLocale();
t('welcome'); // Uses common.json

// Specify namespace
const { t } = useLocale('booking');
t('goldPass.title'); // Uses booking.json

// Or use namespace prefix
const { t } = useLocale();
t('booking:goldPass.title'); // Also uses booking.json
```

## File Structure

```
/public/locales/
├── en/                    # English (primary)
│   ├── common.json        # Common UI strings
│   ├── booking.json       # Booking-related strings
│   ├── auth.json          # Authentication strings
│   ├── admin.json         # Admin panel strings
│   └── profile.json       # Profile-related strings
├── es/                    # Spanish (placeholder)
│   └── common.json
└── pt/                    # Portuguese (placeholder)
    └── common.json
```

## Translation Keys Convention

Use dot notation for nested keys:

```json
{
  "booking": {
    "goldPass": {
      "title": "Gold Pass Bookings",
      "exclusiveSlots": "{{count}} exclusive slot available",
      "exclusiveSlots_plural": "{{count}} exclusive slots available"
    }
  }
}
```

Access: `t('booking.goldPass.title')`

## Pluralization

i18next handles plurals automatically:

```json
{
  "item": "{{count}} item",
  "item_plural": "{{count}} items"
}
```

```jsx
t('item', { count: 1 })  // "1 item"
t('item', { count: 5 })  // "5 items"
```

## Interpolation

```json
{
  "greeting": "Hello, {{name}}!",
  "price": "Price: {{amount, currency}}"
}
```

```jsx
t('greeting', { name: 'John' })  // "Hello, John!"
```

## Adding the Language Switcher

```jsx
import { LanguageSwitcher } from '../components/LanguageSwitcher';

// In your header or settings:
<LanguageSwitcher />           // Default: flag + language code
<LanguageSwitcher variant="minimal" />  // Just the flag
<LanguageSwitcher variant="full" />     // Flag + full language name
```

## Adding a New Language

1. Create folder: `/public/locales/{lang}/`
2. Copy all JSON files from `/public/locales/en/`
3. Translate the strings
4. Add to supported languages in `/src/hooks/useLocale.js`:

```js
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', nativeName: 'English' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷', nativeName: 'Português' },
  // Add new language here
  { code: 'id', name: 'Indonesian', flag: '🇮🇩', nativeName: 'Bahasa Indonesia' },
];
```

5. Add to `supportedLngs` in `/src/i18n.js`:

```js
const supportedLngs = ['en', 'es', 'pt', 'id'];
```

## Best Practices

1. **Always use translation keys** for user-facing text in new components
2. **Use namespaces** to organize translations logically
3. **Keep keys short but descriptive**: `booking.slot.available` not `the_booking_slot_is_currently_available`
4. **Use interpolation** for dynamic values, don't concatenate strings
5. **Handle plurals properly** using i18next's plural syntax
6. **Test with different languages** to catch layout issues

## Useful Hooks

```jsx
const { 
  t,                    // Translation function
  language,             // Current language code ('en')
  currentLanguage,      // Full language object { code, name, flag, nativeName }
  changeLanguage,       // Function to switch language
  formatNumber,         // Format numbers (1000 → "1,000")
  formatCurrency,       // Format currency ($29.99)
  formatDate,           // Format dates
  formatRelativeTime,   // "2 hours ago", "Yesterday"
} = useLocale();
```

## Testing Language Switching

Add `?lng=es` to any URL to force Spanish, or `?lng=pt` for Portuguese.

Example: `http://localhost:3000/bookings?lng=es`
