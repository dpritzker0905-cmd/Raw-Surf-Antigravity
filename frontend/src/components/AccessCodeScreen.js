/**
 * AccessCodeScreen - Gate screen requiring access code before viewing the app
 * Controlled via admin settings - can be disabled when going live
 */
import React, { useState, useEffect } from 'react';
import apiClient from '../lib/apiClient';
import { Lock, Loader2, Waves } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

const ACCESS_CODE_KEY = 'site_access_code'; // Stores the actual code for re-validation

export const AccessCodeScreen = ({ children }) => {
  const [checking, setChecking] = useState(true);
  // MUST start false: the render guard below short-circuits on `accessGranted`, so any truthy
  // initial value renders the app before checkAccess() can decide. Every grant path calls
  // setAccessGranted(true) explicitly.
  const [accessGranted, setAccessGranted] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      // Dev bypass: skip access code check on localhost
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        setAccessGranted(true);
        setChecking(false);
        return;
      }
      // First check if access code is even enabled
      const response = await apiClient.get(`/site-access`);
      
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
          const verifyResponse = await apiClient.post(`/site-access/verify`, { code: storedCode });
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
      
      // No valid stored code - fall through with accessGranted still false, which renders the gate.
    } catch (err) {
      // FAIL CLOSED. This used to grant access on any error, so a single failed request opened
      // a private-beta site. An unreachable check is an UNKNOWN state, not a permissive one --
      // hold the gate and tell the user why, rather than guessing in the visitor's favour.
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const retryCheck = () => {
    setCheckFailed(false);
    setChecking(true);
    checkAccess();
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
      const response = await apiClient.post(`/site-access/verify`, { code: code.trim() });
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
      <div data-testid="access-code-screen" className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // Access granted - show the app. Gate on accessGranted ALONE: `|| !accessRequired` was a
  // second way in that opened the site whenever a path forgot to flag the requirement.
  if (accessGranted) {
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

          {checkFailed && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
            >
              <p className="text-amber-200 text-sm">
                Couldn't confirm access settings. Enter your code, or retry the check.
              </p>
              <Button
                type="button"
                onClick={retryCheck}
                className="mt-2 h-8 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-xs px-3"
              >
                Retry
              </Button>
            </div>
          )}

          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <Input aria-label="Access code"
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

            <Button aria-label="Loader2"
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
