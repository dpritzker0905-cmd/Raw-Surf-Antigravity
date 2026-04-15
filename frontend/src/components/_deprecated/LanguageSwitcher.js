/**
 * LanguageSwitcher - Dropdown to change app language
 * 
 * Displays current language with flag and allows switching.
 * Can be placed in Settings, Header, or Footer.
 * 
 * Usage:
 *   <LanguageSwitcher />
 *   <LanguageSwitcher variant="minimal" />  // Just flag
 *   <LanguageSwitcher variant="full" />     // Flag + full name
 */

import React, { useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useLocale, SUPPORTED_LANGUAGES } from '../hooks/useLocale';

export const LanguageSwitcher = ({ 
  variant = 'default', // 'minimal', 'default', 'full'
  className = '' 
}) => {
  const { language, changeLanguage, currentLanguage } = useLocale();
  const [open, setOpen] = useState(false);

  const handleSelect = (langCode) => {
    changeLanguage(langCode);
    setOpen(false);
  };

  // Minimal variant - just flag
  if (variant === 'minimal') {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm"
            className={`px-2 ${className}`}
          >
            <span className="text-lg">{currentLanguage.flag}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className="flex items-center gap-2 cursor-pointer hover:bg-zinc-800"
            >
              <span className="text-lg">{lang.flag}</span>
              <span className="text-white">{lang.nativeName}</span>
              {language === lang.code && (
                <Check className="w-4 h-4 ml-auto text-cyan-400" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Full variant - flag + full name
  if (variant === 'full') {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            className={`border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 ${className}`}
          >
            <span className="text-lg mr-2">{currentLanguage.flag}</span>
            <span className="text-white">{currentLanguage.nativeName}</span>
            <ChevronDown className="w-4 h-4 ml-2 text-gray-400" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 w-48">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className="flex items-center gap-3 cursor-pointer hover:bg-zinc-800 py-2"
            >
              <span className="text-xl">{lang.flag}</span>
              <div className="flex-1">
                <p className="text-white text-sm">{lang.nativeName}</p>
                <p className="text-gray-500 text-xs">{lang.name}</p>
              </div>
              {language === lang.code && (
                <Check className="w-4 h-4 text-cyan-400" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Default variant - flag + code
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm"
          className={`gap-1.5 ${className}`}
        >
          <Globe className="w-4 h-4 text-gray-400" />
          <span className="text-lg">{currentLanguage.flag}</span>
          <span className="text-sm text-gray-400 uppercase">{language}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            className="flex items-center gap-2 cursor-pointer hover:bg-zinc-800"
          >
            <span className="text-lg">{lang.flag}</span>
            <span className="text-white">{lang.nativeName}</span>
            {language === lang.code && (
              <Check className="w-4 h-4 ml-auto text-cyan-400" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSwitcher;
