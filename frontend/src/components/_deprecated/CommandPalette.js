import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import {
  Search, User, MapPin, Calendar, Settings, BarChart2,
  Shield, DollarSign, Bell, FileText, X
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';


/**
 * Global Command Palette (Cmd+K)
 * - Quick search across users, bookings, spots
 * - Quick actions
 */
export const CommandPalette = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Quick actions for admins
  const quickActions = user?.is_admin ? [
    { id: 'admin', label: 'Admin Console', icon: Shield, path: '/admin' },
    { id: 'analytics', label: 'Analytics', icon: BarChart2, path: '/admin?tab=analytics' },
    { id: 'users', label: 'Manage Users', icon: User, path: '/admin?tab=users' },
    { id: 'spots', label: 'Manage Spots', icon: MapPin, path: '/admin?tab=spots' },
    { id: 'finance', label: 'Finance', icon: DollarSign, path: '/admin?tab=finance' },
  ] : [
    { id: 'profile', label: 'My Profile', icon: User, path: '/profile' },
    { id: 'bookings', label: 'My Bookings', icon: Calendar, path: '/bookings' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
    { id: 'notifications', label: 'Notifications', icon: Bell, path: '/notifications' },
  ];

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setQuery('');
      setResults(null);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const searchDebounce = setTimeout(async () => {
      if (query.length >= 2 && user?.is_admin) {
        setLoading(true);
        try {
          const response = await apiClient.get(`/admin/search?query=${encodeURIComponent(query)}&limit=10`);
          setResults(response.data);
          setSelectedIndex(0);
        } catch (error) {
          console.error('Search failed:', error);
        } finally {
          setLoading(false);
        }
      } else if (query.length < 2) {
        setResults(null);
      }
    }, 300);

    return () => clearTimeout(searchDebounce);
  }, [query, user]);

  const handleKeyDown = useCallback((e) => {
    const allItems = results?.combined?.length > 0 
      ? [...results.combined] 
      : quickActions.filter(a => !query || a.label.toLowerCase().includes(query.toLowerCase()));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && allItems[selectedIndex]) {
      e.preventDefault();
      handleSelect(allItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [results, selectedIndex, query, quickActions, onClose]);

  const handleSelect = (item) => {
    if (item.path) {
      navigate(item.path);
    } else if (item.type === 'user') {
      navigate(`/profile/${item.id}`);
    } else if (item.type === 'booking') {
      navigate(`/admin?tab=bookings&id=${item.id}`);
    } else if (item.type === 'spot') {
      navigate(`/spots/${item.id}`);
    }
    onClose();
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'user': return <User className="w-4 h-4 text-blue-400" />;
      case 'booking': return <Calendar className="w-4 h-4 text-green-400" />;
      case 'spot': return <MapPin className="w-4 h-4 text-purple-400" />;
      default: return <FileText className="w-4 h-4 text-gray-400" />;
    }
  };

  const filteredActions = quickActions.filter(a => 
    !query || a.label.toLowerCase().includes(query.toLowerCase())
  );

  const displayItems = results?.combined?.length > 0 ? results.combined : filteredActions;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 p-0 max-w-lg overflow-hidden">
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        {/* Search Input */}
        <div className="flex items-center border-b border-zinc-800 px-4">
          <Search className="w-5 h-5 text-gray-500" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={user?.is_admin ? "Search users, bookings, spots..." : "Quick navigation..."}
            className="border-0 bg-transparent focus-visible:ring-0 text-white placeholder:text-gray-500"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">Searching...</div>
          ) : displayItems.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No results found</div>
          ) : (
            <div className="py-2">
              {!results && query.length < 2 && (
                <p className="px-4 py-1 text-xs text-gray-500 font-medium">Quick Actions</p>
              )}
              {results?.combined?.length > 0 && (
                <p className="px-4 py-1 text-xs text-gray-500 font-medium">Search Results</p>
              )}
              {displayItems.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    index === selectedIndex 
                      ? 'bg-cyan-500/20 text-white' 
                      : 'text-gray-300 hover:bg-zinc-800'
                  }`}
                >
                  {item.icon ? (
                    <item.icon className="w-4 h-4 text-gray-400" />
                  ) : (
                    getTypeIcon(item.type)
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.label || item.name}</p>
                    {item.email && <p className="text-xs text-gray-500 truncate">{item.email}</p>}
                    {item.location && <p className="text-xs text-gray-500">{item.location}</p>}
                    {item.role && <p className="text-xs text-gray-500">{item.role}</p>}
                  </div>
                  {item.type && (
                    <span className="text-xs text-gray-500 capitalize">{item.type}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-gray-400">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-gray-400">↵</kbd>
            <span>Select</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-gray-400">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommandPalette;
