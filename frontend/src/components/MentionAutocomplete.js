/**
 * MentionAutocomplete - Dropdown for @mention suggestions
 * Shows when user types @ in a text input
 */
import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { Loader2 } from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

const MentionAutocomplete = forwardRef(({ 
  text, 
  cursorPosition,
  onSelect,
  isVisible,
  onClose,
  position = { top: 0, left: 0 }
}, ref) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef(null);
  
  // Extract the mention query from text
  useEffect(() => {
    if (!text || cursorPosition === undefined) {
      setQuery('');
      return;
    }
    
    // Find the @ symbol before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex === -1) {
      setQuery('');
      return;
    }
    
    // Get text between @ and cursor
    const mentionText = textBeforeCursor.substring(lastAtIndex + 1);
    
    // Check if there's a space after @, which means mention is complete
    if (mentionText.includes(' ') || mentionText.includes('\n')) {
      setQuery('');
      return;
    }
    
    // Check if @ is at start or after whitespace
    const charBefore = lastAtIndex > 0 ? text[lastAtIndex - 1] : ' ';
    if (charBefore !== ' ' && charBefore !== '\n' && lastAtIndex !== 0) {
      setQuery('');
      return;
    }
    
    setQuery(mentionText);
  }, [text, cursorPosition]);
  
  // Fetch suggestions when query changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!query || query.length < 1) {
        setSuggestions([]);
        return;
      }
      
      setLoading(true);
      try {
        const response = await apiClient.get(`/api/username/search?q=${encodeURIComponent(query)}&limit=8`);
        setSuggestions(response.data || []);
        setSelectedIndex(0);
      } catch (error) {
        logger.error('Mention search failed:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };
    
    const debounce = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(debounce);
  }, [query]);
  
  // Expose methods for keyboard navigation
  useImperativeHandle(ref, () => ({
    handleKeyDown: (e) => {
      if (!isVisible || suggestions.length === 0) return false;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % suggestions.length);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
          return true;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          handleSelect(suggestions[selectedIndex]);
          return true;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          return true;
        default:
          return false;
      }
    }
  }));
  
  const handleSelect = (user) => {
    if (!user) return;
    
    // Find the position of the @ symbol
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    // Create the mention data
    const mention = {
      user_id: user.user_id || user.id,
      username: user.username,
      full_name: user.full_name,
      display: `@${user.username}`
    };
    
    onSelect?.(mention, lastAtIndex, cursorPosition);
    onClose?.();
  };
  
  if (!isVisible || !query || suggestions.length === 0) {
    return null;
  }
  
  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-72 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl"
      style={{
        top: position.top,
        left: position.left
      }}
      data-testid="mention-autocomplete"
    >
      <div className="p-1">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 text-cyan-500 animate-spin" />
          </div>
        ) : (
          suggestions.map((user, index) => (
            <button
              key={user.id || user.user_id}
              onClick={() => handleSelect(user)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors ${
                index === selectedIndex 
                  ? 'bg-cyan-500/20' 
                  : 'hover:bg-zinc-800'
              }`}
              data-testid={`mention-option-${user.username || user.id}`}
            >
              <Avatar className="w-8 h-8 border border-zinc-700">
                <AvatarImage src={user.avatar_url} />
                <AvatarFallback className="bg-zinc-800 text-white text-xs">
                  {(user.full_name || user.username || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-white truncate text-sm">
                  {user.full_name || user.username}
                </p>
                <p className="text-xs text-cyan-400 truncate">
                  @{user.username || 'no-username'}
                </p>
              </div>
              {user.is_verified && (
                <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                  <span className="text-white text-[8px]">✓</span>
                </div>
              )}
            </button>
          ))
        )}
      </div>
      
      {/* Hint */}
      <div className="px-2 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-between">
        <span>↑↓ to navigate</span>
        <span>Enter to select</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
});

MentionAutocomplete.displayName = 'MentionAutocomplete';

export default MentionAutocomplete;
