import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import { toast } from 'sonner';
import { ArrowLeft, Mail, Lock, Eye, EyeOff, Check, Loader2 } from 'lucide-react';
import logger from '../utils/logger';


export const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiClient.post(`/auth/forgot-password`, { email });
      setSent(true);
      toast.success('Reset link sent! Check your email.');
      
      // DEV: Show token for testing (remove in production)
      if (response.data._dev_token) {
        setDevToken(response.data._dev_token);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 overflow-hidden" data-testid="forgot-password-card">
        {/* Header */}
        <div className="text-center pt-8 pb-4">
          <div className="flex items-center justify-center gap-2 mb-6">
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="w-10 h-10"
            />
            <span className="text-2xl font-bold text-white" style={{ fontFamily: 'Oswald' }}>Raw Surf</span>
          </div>
          <h2 className="text-xl font-bold text-white">Forgot Password</h2>
          <p className="text-gray-400 mt-2 text-sm">
            {sent ? "Check your email for the reset link" : "Enter your email to reset your password"}
          </p>
        </div>

        <div className="px-6 pb-6">
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white h-12 pl-10"
                  required
                  data-testid="forgot-email-input"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
                data-testid="forgot-submit"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Reset Link'}
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-emerald-500/20 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-gray-300">
                If an account exists with <span className="text-white font-medium">{email}</span>, 
                you'll receive a password reset link shortly.
              </p>
              
              {/* DEV ONLY - Token display for testing */}
              {devToken && (
                <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-yellow-400 text-xs font-medium mb-2">DEV MODE - Reset Link:</p>
                  <button
                    onClick={() => navigate(`/reset-password?token=${devToken}`)}
                    className="text-yellow-400 hover:text-yellow-300 text-sm underline break-all"
                  >
                    Click here to reset password
                  </button>
                </div>
              )}

              <Button
                onClick={() => navigate('/auth?tab=login')}
                variant="outline"
                className="mt-4 border-zinc-700 text-white hover:bg-zinc-800"
              >
                Back to Login
              </Button>
            </div>
          )}

          {/* Back to login link */}
          {!sent && (
            <button
              onClick={() => navigate('/auth?tab=login')}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mt-4 mx-auto"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to login
            </button>
          )}
        </div>
      </Card>
    </div>
  );
};

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Extract token with multiple fallback methods to handle URL encoding issues
  const extractToken = () => {
    // Method 1: Standard search params
    let token = searchParams.get('token');
    if (token) {
      // Decode any URL encoding
      try {
        token = decodeURIComponent(token);
      } catch (e) {
        // Already decoded or invalid
      }
      return token;
    }
    
    // Method 2: Parse from full URL (handles double-encoding from email trackers)
    const fullUrl = window.location.href;
    const tokenMatch = fullUrl.match(/[?&]token=([^&]+)/);
    if (tokenMatch) {
      token = tokenMatch[1];
      try {
        // Try double-decode in case of double encoding
        token = decodeURIComponent(decodeURIComponent(token));
      } catch (e) {
        try {
          token = decodeURIComponent(token);
        } catch (e2) {
          // Use as-is
        }
      }
      return token;
    }
    
    // Method 3: Check if token is embedded in a redirect URL (email tracker unwrapping)
    const redirectMatch = fullUrl.match(/token%3D([^&%]+)/i) || fullUrl.match(/token=([^&]+)/i);
    if (redirectMatch) {
      token = redirectMatch[1];
      try {
        token = decodeURIComponent(token);
      } catch (e) {
        // Use as-is
      }
      return token;
    }
    
    return null;
  };
  
  const token = extractToken();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState(null);
  const [email, setEmail] = useState('');

  // Verify token on mount
  React.useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        logger.error('[Password Reset] No token found in URL:', window.location.href);
        setTokenValid(false);
        return;
      }

      logger.debug('[Password Reset] Verifying token:', token.substring(0, 10) + '...');

      try {
        const response = await apiClient.post(`/auth/verify-reset-token`, { token });
        setTokenValid(true);
        setEmail(response.data.email || '');
      } catch (error) {
        logger.error('[Password Reset] Token verification failed:', error.response?.data);
        setTokenValid(false);
        toast.error(error.response?.data?.detail || 'Invalid or expired reset link');
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await apiClient.post(`/auth/reset-password`, {
        token,
        new_password: password
      });
      setSuccess(true);
      toast.success('Password reset successful!');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  // Loading state while verifying token
  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  // Invalid token
  if (!tokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-black">
        <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Invalid Reset Link</h2>
          <p className="text-gray-400 mb-4">
            This password reset link is invalid or has expired.
          </p>
          {/* Debug info - helps diagnose email tracker issues */}
          {!token && (
            <p className="text-xs text-red-400/70 mb-4 font-mono break-all">
              Debug: No token found in URL. If you clicked a link from email, the URL may have been corrupted by email tracking.
            </p>
          )}
          {token && (
            <p className="text-xs text-yellow-400/70 mb-4 font-mono">
              Debug: Token found but invalid/expired.
            </p>
          )}
          <Button
            onClick={() => navigate('/forgot-password')}
            className="bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black font-bold"
          >
            Request New Link
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 overflow-hidden" data-testid="reset-password-card">
        {/* Header */}
        <div className="text-center pt-8 pb-4">
          <div className="flex items-center justify-center gap-2 mb-6">
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="w-10 h-10"
            />
            <span className="text-2xl font-bold text-white" style={{ fontFamily: 'Oswald' }}>Raw Surf</span>
          </div>
          <h2 className="text-xl font-bold text-white">
            {success ? 'Password Reset!' : 'Create New Password'}
          </h2>
          {email && !success && (
            <p className="text-gray-400 mt-2 text-sm">for {email}</p>
          )}
        </div>

        <div className="px-6 pb-6">
          {!success ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white h-12 pl-10 pr-10"
                  required
                  minLength={6}
                  data-testid="new-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white h-12 pl-10"
                  required
                  minLength={6}
                  data-testid="confirm-password-input"
                />
              </div>

              <p className="text-xs text-gray-500">Password must be at least 6 characters</p>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
                data-testid="reset-submit"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Reset Password'}
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-emerald-500/20 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-gray-300">
                Your password has been reset successfully. You can now log in with your new password.
              </p>
              <Button
                onClick={() => navigate('/auth?tab=login')}
                className="w-full h-12 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black font-bold"
              >
                Go to Login
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
