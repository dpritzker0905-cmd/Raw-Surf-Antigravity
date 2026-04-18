/**
 * UsernameSetup - Component for setting up @username
 * Shows after signup or when username is not set
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { AtSign, Check, X, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

// Debounce hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => clearTimeout(handler);
  }, [value, delay]);
  
  return debouncedValue;
};

const UsernameSetup = ({ onComplete, skipAllowed = false }) => {
  const { user, refreshUser } = useAuth();
  const { isLight } = useTheme();
  const navigate = useNavigate();
  
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  
  const debouncedUsername = useDebounce(username, 400);
  
  // Theme classes
  const bgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-zinc-400';
  const inputBg = isLight ? 'bg-gray-50' : 'bg-zinc-800';
  
  // Generate username suggestions based on user's name
  useEffect(() => {
    if (user?.full_name) {
      const nameParts = user.full_name.toLowerCase().split(' ').filter(Boolean);
      const _base = nameParts.join('');
      const first = nameParts[0] || 'surfer';
      const last = nameParts[nameParts.length - 1] || '';
      
      setSuggestions([
        first,
        `${first}${Math.floor(Math.random() * 999)}`,
        `${first}_${last}`.replace(/\s/g, ''),
        `${first}surfs`,
        `the${first}`
      ].filter(s => s.length >= 3 && s.length <= 30));
    }
  }, [user?.full_name]);
  
  // Check availability when username changes
  useEffect(() => {
    const checkAvailability = async () => {
      if (!debouncedUsername || debouncedUsername.length < 3) {
        setAvailability(null);
        return;
      }
      
      setChecking(true);
      try {
        const response = await apiClient.get(
          `/api/username/check/${debouncedUsername}?user_id=${user?.id}`
        );
        setAvailability(response.data);
      } catch (error) {
        logger.error('Username check failed:', error);
        setAvailability({ available: false, reason: 'Unable to check availability' });
      } finally {
        setChecking(false);
      }
    };
    
    checkAvailability();
  }, [debouncedUsername, user?.id]);
  
  const handleUsernameChange = (e) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(value);
  };
  
  const handleSubmit = async () => {
    if (!username || username.length < 3 || !availability?.available) {
      toast.error('Please enter a valid available username');
      return;
    }
    
    setSubmitting(true);
    try {
      await apiClient.post(`/api/username/set?user_id=${user.id}`, {
        username: username
      });
      
      toast.success(`Your username is now @${username}!`);
      
      // Refresh user data to get the new username
      let updatedUser = user;
      if (refreshUser) {
        updatedUser = await refreshUser();
      }
      
      if (onComplete) {
        onComplete(username);
      } else {
        // Navigate based on user's subscription/onboarding status
        navigateToNextStep(updatedUser || user);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to set username');
    } finally {
      setSubmitting(false);
    }
  };
  
  // Determine where to navigate after username setup
  const navigateToNextStep = (userData) => {
    // Check if user needs subscription
    const isLinkedGrom = userData.role === 'Grom' && userData.parent_id && userData.parent_link_approved;
    const surferRoles = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'];
    
    if (!userData.subscription_tier && surferRoles.includes(userData.role) && !isLinkedGrom) {
      navigate('/surfer-subscription', { replace: true });
    } else if (!userData.subscription_tier && userData.role === 'Photographer') {
      navigate('/photographer-subscription', { replace: true });
    } else if (userData.role === 'Approved Pro' && !userData.portfolio_url) {
      navigate('/pro-onboarding', { replace: true });
    } else {
      navigate('/feed', { replace: true });
    }
  };
  
  const handleSkip = () => {
    if (onComplete) {
      onComplete(null);
    } else {
      // Even when skipping, navigate to appropriate next step
      navigateToNextStep(user);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <Card className={`w-full max-w-md ${bgClass} ${borderClass} overflow-hidden`} data-testid="username-setup-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 p-3 rounded-full bg-cyan-500/20">
            <AtSign className="w-8 h-8 text-cyan-400" />
          </div>
          <CardTitle className={`text-2xl ${textClass}`}>
            Choose your username
          </CardTitle>
          <p className={`text-sm ${textSecondary} mt-2`}>
            This is how others will find and @mention you
          </p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Username Input */}
          <div className="space-y-2">
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary} font-medium`}>
                @
              </span>
              <Input
                type="text"
                value={username}
                onChange={handleUsernameChange}
                placeholder="username"
                className={`pl-8 pr-10 h-12 text-lg ${inputBg} ${borderClass} ${textClass}`}
                maxLength={30}
                autoFocus
                data-testid="username-input"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {checking ? (
                  <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                ) : availability?.available ? (
                  <Check className="w-5 h-5 text-green-500" />
                ) : availability && !availability.available ? (
                  <X className="w-5 h-5 text-red-500" />
                ) : null}
              </div>
            </div>
            
            {/* Availability message */}
            {availability && (
              <p className={`text-sm flex items-center gap-1 ${
                availability.available ? 'text-green-500' : 'text-red-400'
              }`}>
                {availability.available ? (
                  <>
                    <Check className="w-4 h-4" />
                    @{username} is available!
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    {availability.reason}
                  </>
                )}
              </p>
            )}
            
            {/* Character count */}
            <p className={`text-xs ${textSecondary} text-right`}>
              {username.length}/30 characters
            </p>
          </div>
          
          {/* Suggestions */}
          {suggestions.length > 0 && !username && (
            <div className="space-y-2">
              <p className={`text-sm ${textSecondary} flex items-center gap-1`}>
                <Sparkles className="w-4 h-4 text-yellow-400" />
                Suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => setUsername(suggestion)}
                    className={`px-3 py-1.5 rounded-full text-sm ${
                      isLight 
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-800' 
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                    } transition-colors`}
                    data-testid={`suggestion-${suggestion}`}
                  >
                    @{suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Rules */}
          <div className={`p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
            <p className={`text-xs ${isLight ? 'text-blue-800' : 'text-blue-300'}`}>
              <strong>Username rules:</strong>
              <br />• 3-30 characters
              <br />• Must start with a letter
              <br />• Only letters, numbers, and underscores
              <br />• Can be changed once every 60 days
            </p>
          </div>
        </CardContent>
        
        <CardFooter className="flex flex-col gap-3">
          <Button
            onClick={handleSubmit}
            disabled={!availability?.available || submitting}
            className="w-full h-12 bg-cyan-500 hover:bg-cyan-600 text-white font-medium"
            data-testid="set-username-btn"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <AtSign className="w-4 h-4 mr-2" />
                Claim @{username || 'username'}
              </>
            )}
          </Button>
          
          {skipAllowed && (
            <Button
              variant="ghost"
              onClick={handleSkip}
              className={`w-full ${textSecondary}`}
              data-testid="skip-username-btn"
            >
              Skip for now
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
};

export default UsernameSetup;
