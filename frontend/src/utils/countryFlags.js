/**
 * countryFlags.js
 * Country flag emoji helper and popular surf location presets
 * Extracted from Explore.js for reusability and reduced file size
 */

/**
 * Returns a flag emoji for a given country name using Unicode escape sequences
 * (per project rules -- raw emoji bytes corrupt during PowerShell/git operations)
 */
export const getCountryFlag = (countryName) => {
  const flags = {
    'USA': '\u{1F1FA}\u{1F1F8}',
    'United States': '\u{1F1FA}\u{1F1F8}',
    'Australia': '\u{1F1E6}\u{1F1FA}',
    'Indonesia': '\u{1F1EE}\u{1F1E9}',
    'Brazil': '\u{1F1E7}\u{1F1F7}',
    'Portugal': '\u{1F1F5}\u{1F1F9}',
    'South Africa': '\u{1F1FF}\u{1F1E6}',
    'France': '\u{1F1EB}\u{1F1F7}',
    'Spain': '\u{1F1EA}\u{1F1F8}',
    'Mexico': '\u{1F1F2}\u{1F1FD}',
    'Costa Rica': '\u{1F1E8}\u{1F1F7}',
    'Japan': '\u{1F1EF}\u{1F1F5}',
    'New Zealand': '\u{1F1F3}\u{1F1FF}',
    'Peru': '\u{1F1F5}\u{1F1EA}',
    'Morocco': '\u{1F1F2}\u{1F1E6}',
    'United Kingdom': '\u{1F1EC}\u{1F1E7}',
    'UK': '\u{1F1EC}\u{1F1E7}',
    'Canada': '\u{1F1E8}\u{1F1E6}',
    'Chile': '\u{1F1E8}\u{1F1F1}',
    'Hawaii': '\u{1F3CA}',
    'Fiji': '\u{1F1EB}\u{1F1EF}',
    'French Polynesia': '\u{1F1F5}\u{1F1EB}',
    'Tahiti': '\u{1F1F5}\u{1F1EB}',
    'Maldives': '\u{1F1F2}\u{1F1FB}',
    'Philippines': '\u{1F1F5}\u{1F1ED}',
    'Sri Lanka': '\u{1F1F1}\u{1F1F0}',
    'Nicaragua': '\u{1F1F3}\u{1F1EE}',
    'Panama': '\u{1F1F5}\u{1F1E6}',
    'El Salvador': '\u{1F1F8}\u{1F1FB}',
    'Ecuador': '\u{1F1EA}\u{1F1E8}',
    'Ireland': '\u{1F1EE}\u{1F1EA}',
    'Italy': '\u{1F1EE}\u{1F1F9}',
    'Thailand': '\u{1F1F9}\u{1F1ED}',
    'Colombia': '\u{1F1E8}\u{1F1F4}',
    'Dominican Republic': '\u{1F1E9}\u{1F1F4}',
    'Puerto Rico': '\u{1F1F5}\u{1F1F7}',
    'Cuba': '\u{1F1E8}\u{1F1FA}',
    'Jamaica': '\u{1F1EF}\u{1F1F2}',
    'Barbados': '\u{1F1E7}\u{1F1E7}',
    'Bahamas': '\u{1F1E7}\u{1F1F8}',
    'Bermuda': '\u{1F1E7}\u{1F1F2}',
    'Taiwan': '\u{1F1F9}\u{1F1FC}',
    'China': '\u{1F1E8}\u{1F1F3}',
    'India': '\u{1F1EE}\u{1F1F3}',
    'Vietnam': '\u{1F1FB}\u{1F1F3}',
    'Samoa': '\u{1F1FC}\u{1F1F8}',
    'Tonga': '\u{1F1F9}\u{1F1F4}',
    'Angola': '\u{1F1E6}\u{1F1F4}',
    'Senegal': '\u{1F1F8}\u{1F1F3}',
    'Ghana': '\u{1F1EC}\u{1F1ED}',
    'Madagascar': '\u{1F1F2}\u{1F1EC}',
    'Mozambique': '\u{1F1F2}\u{1F1FF}',
    'Namibia': '\u{1F1F3}\u{1F1E6}',
    'Guatemala': '\u{1F1EC}\u{1F1F9}',
    'Honduras': '\u{1F1ED}\u{1F1F3}',
    'Argentina': '\u{1F1E6}\u{1F1F7}',
    'Uruguay': '\u{1F1FA}\u{1F1FE}',
    'Israel': '\u{1F1EE}\u{1F1F1}',
    'Malaysia': '\u{1F1F2}\u{1F1FE}',
    'Vanuatu': '\u{1F1FB}\u{1F1FA}',
    'Papua New Guinea': '\u{1F1F5}\u{1F1EC}',
    'Solomon Islands': '\u{1F1F8}\u{1F1E7}',
    'Saudi Arabia': '\u{1F1F8}\u{1F1E6}',
    'United Arab Emirates': '\u{1F1E6}\u{1F1EA}',
    'Oman': '\u{1F1F4}\u{1F1F2}',
    'Qatar': '\u{1F1F6}\u{1F1E6}',
    'Norway': '\u{1F1F3}\u{1F1F4}',
    'Iceland': '\u{1F1EE}\u{1F1F8}',
    'Aruba': '\u{1F1E6}\u{1F1FC}',
    'Curacao': '\u{1F1E8}\u{1F1FC}',
    'Trinidad & Tobago': '\u{1F1F9}\u{1F1F9}',
    'Mauritius': '\u{1F1F2}\u{1F1FA}',
    'Cape Verde': '\u{1F1E8}\u{1F1FB}',
    'Cook Islands': '\u{1F1E8}\u{1F1F0}'
  };
  return flags[countryName] || '\u{1F30A}';
};

/**
 * Popular quick-access surf locations for the Explore surf spots tab
 */
export const getPopularLocations = () => [
  { label: `${getCountryFlag('USA')} Florida`, country: 'USA', state: 'Florida' },
  { label: `${getCountryFlag('USA')} California`, country: 'USA', state: 'California' },
  { label: `${getCountryFlag('USA')} Hawaii`, country: 'USA', state: 'Hawaii' },
  { label: `${getCountryFlag('USA')} North Carolina`, country: 'USA', state: 'North Carolina' },
  { label: `${getCountryFlag('Australia')} Australia`, country: 'Australia' },
  { label: `${getCountryFlag('Indonesia')} Indonesia`, country: 'Indonesia' },
  { label: `${getCountryFlag('Brazil')} Brazil`, country: 'Brazil' },
  { label: `${getCountryFlag('Portugal')} Portugal`, country: 'Portugal' },
  { label: `${getCountryFlag('Costa Rica')} Costa Rica`, country: 'Costa Rica' },
  { label: `${getCountryFlag('Mexico')} Mexico`, country: 'Mexico' },
  { label: `${getCountryFlag('South Africa')} South Africa`, country: 'South Africa' },
  { label: `${getCountryFlag('Japan')} Japan`, country: 'Japan' },
];
