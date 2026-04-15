/**
 * AccessCodeScreen - Gate screen requiring access code before viewing the app
 * Controlled via admin settings - can be disabled when going live
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Lock, Loader2, Waves } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

const API = process.env.REACT_APP_BACKEND_URL;
const ACCESS_CODE_KEY = 'site_access_code'; // Stores the actual code for re-validation

export const AccessCodeScreen = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      // First check if access code is even enabled
      const response = await axios.get(`${API}/api/site-access`);
      
      if (!response.data.access_code_enabled) {
        // Access code not required - grant access
        setAccessGranted(true);
        setChecking(false);
        return;
      }
      
      // Access code IS required - check if we have a stored code
      const storedCode = localStorage.getItem(ACCESS_CODE_KEY);
      
      if (storedCode) {
        // Verify the stored code is still valid against the backend
        try {
          const verifyResponse = await axios.post(`${API}/api/site-access/verify`, { code: storedCode });
          if (verifyResponse.data.valid) {
            setAccessGranted(true);
            setChecking(false);
            return;
          } else {
            // Code is no longer valid (admin changed it) - clear and require re-entry
            localStorage.removeItem(ACCESS_CODE_KEY);
          }
        } catch {
          // Verification failed - clear stored code
          localStorage.removeItem(ACCESS_CODE_KEY);
        }
      }
      
      // No valid stored code - require entry
      setAccessRequired(true);
    } catch (err) {
      // If endpoint fails, assume no access code needed
      setAccessGranted(true);
    } finally {
      setChecking(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter an access code');
      return;
    }

    setVerifying(true);
    setError('');

    try {
      const response = await axios.post(`${API}/api/site-access/verify`, { code: code.trim() });
      if (response.data.valid) {
        // Store the actual code for future re-validation
        localStorage.setItem(ACCESS_CODE_KEY, code.trim().toUpperCase());
        setAccessGranted(true);
      } else {
        setError('Invalid access code');
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  // Loading state
  if (checking) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // Access granted - show the app
  if (accessGranted || !accessRequired) {
    return children;
  }

  // Access code required - show gate screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 mb-4">
            <Waves className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Raw Surf</h1>
          <p className="text-zinc-400">Private Beta Access</p>
        </div>

        {/* Access Code Form */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-full bg-cyan-500/10">
              <Lock className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold">Enter Access Code</h2>
              <p className="text-zinc-500 text-sm">This site is currently in private beta</p>
            </div>
          </div>

          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <Input
                type="text"
                placeholder="Access code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError('');
                }}
                className="bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 text-center text-lg tracking-widest uppercase"
                autoComplete="off"
                autoFocus
              />
              {error && (
                <p className="text-red-400 text-sm mt-2 text-center">{error}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={verifying || !code.trim()}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-semibold py-3"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Enter Site'
              )}
            </Button>
          </form>

          <p className="text-zinc-600 text-xs text-center mt-6">
            Don't have a code? Contact the site owner for access.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AccessCodeScreen;
