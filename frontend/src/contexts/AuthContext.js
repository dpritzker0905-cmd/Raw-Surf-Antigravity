import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext();

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Impersonation state
  const [impersonation, setImpersonation] = useState(null);
  const [originalUser, setOriginalUser] = useState(null);

  // Check for impersonation session on load
  const checkImpersonationSession = useCallback(() => {
    const storedSession = localStorage.getItem('impersonation_session');
    if (storedSession) {
      try {
        const session = JSON.parse(storedSession);
        setImpersonation(session);
        // Store original user and switch to target user view
        const storedOriginalUser = localStorage.getItem('raw-surf-user-original');
        if (storedOriginalUser) {
          setOriginalUser(JSON.parse(storedOriginalUser));
        }
      } catch (e) {
        localStorage.removeItem('impersonation_session');
      }
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('raw-surf-user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      document.documentElement.classList.remove('no-god-mode');
      
      // Auto-refresh if username is missing (backwards compatibility)
      if (parsedUser?.id && !parsedUser?.username) {
        axios.get(`${API}/profiles/${parsedUser.id}`)
          .then(response => {
            if (response.data?.username) {
              const updatedUser = { ...parsedUser, username: response.data.username };
              setUser(updatedUser);
              localStorage.setItem('raw-surf-user', JSON.stringify(updatedUser));
            }
          })
          .catch(() => {}); // Silent fail
      }
    } else {
      document.documentElement.classList.add('no-god-mode');
    }
    checkImpersonationSession();
    setLoading(false);
  }, [checkImpersonationSession]);

  const signup = async (email, password, full_name, username, role, parent_email, company_name, birthdate, grom_competes = false) => {
    try {
      const response = await axios.post(`${API}/auth/signup`, {
        email,
        password,
        full_name,
        username,
        role,
        parent_email,
        company_name,
        birthdate,
        grom_competes
      });
      const userData = response.data;
      setUser(userData);
      localStorage.setItem('raw-surf-user', JSON.stringify(userData));
      document.documentElement.classList.remove('no-god-mode');
      return userData;
    } catch (error) {
      throw error;
    }
  };

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API}/auth/login`, {
        email,
        password
      });
      const userData = response.data;
      setUser(userData);
      localStorage.setItem('raw-surf-user', JSON.stringify(userData));
      document.documentElement.classList.remove('no-god-mode');
      return userData;
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    // End any active impersonation first
    if (impersonation) {
      endImpersonation();
    }
    setUser(null);
    localStorage.removeItem('raw-surf-user');
    localStorage.removeItem('raw-surf-user-original');
    localStorage.removeItem('godModeMinimized');
    localStorage.removeItem('godModeDesktopMinimized');
    localStorage.removeItem('isGodMode');
    localStorage.removeItem('isPersonaBarActive');
    localStorage.removeItem('activePersona');
    document.documentElement.classList.add('no-god-mode');
  };

  const updateUser = (updates) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      localStorage.setItem('raw-surf-user', JSON.stringify(updatedUser));
    }
  };

  // Refresh user data from server (useful when profile fields are updated)
  const refreshUser = async () => {
    if (!user?.id) return null;
    try {
      const response = await axios.get(`${API}/profiles/${user.id}`);
      const refreshedUser = { ...user, ...response.data };
      setUser(refreshedUser);
      localStorage.setItem('raw-surf-user', JSON.stringify(refreshedUser));
      return refreshedUser;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      return null;
    }
  };

  const updateSubscription = async (profileId, subscriptionTier) => {
    try {
      const response = await axios.post(`${API}/profiles/${profileId}/subscription`, {
        subscription_tier: subscriptionTier
      });
      updateUser({ subscription_tier: subscriptionTier });
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  const submitProOnboarding = async (profileId, data) => {
    try {
      const response = await axios.post(`${API}/profiles/${profileId}/pro-onboarding`, data);
      updateUser({ portfolio_url: data.portfolio_url });
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  // ============ IMPERSONATION METHODS ============
  
  /**
   * Start viewing as another user (admin only)
   * @param {Object} session - Impersonation session data from API
   */
  const startImpersonation = (session) => {
    if (!user?.is_admin) return;
    
    // Store original admin user
    setOriginalUser(user);
    localStorage.setItem('raw-surf-user-original', JSON.stringify(user));
    
    // Store impersonation session
    setImpersonation(session);
    localStorage.setItem('impersonation_session', JSON.stringify(session));
    
    // Switch effective user to target (for viewing purposes)
    // Note: We keep using original user's ID for API calls that need admin auth
    const effectiveUser = {
      ...session.target_user,
      _isImpersonated: true,
      _adminId: user.id,
      _sessionId: session.session_id,
      _isReadOnly: session.is_read_only
    };
    setUser(effectiveUser);
    localStorage.setItem('raw-surf-user', JSON.stringify(effectiveUser));
  };

  /**
   * End impersonation and return to admin view
   */
  const endImpersonation = async () => {
    if (!impersonation || !originalUser) return;
    
    try {
      // Call API to end session
      await axios.post(
        `${API}/admin/impersonate/${impersonation.session_id}/end?admin_id=${originalUser.id}`
      );
    } catch (e) {
      // Continue anyway - session cleanup is important
    }
    
    // Restore original admin user
    setUser(originalUser);
    localStorage.setItem('raw-surf-user', JSON.stringify(originalUser));
    
    // Clear impersonation state
    setImpersonation(null);
    setOriginalUser(null);
    localStorage.removeItem('impersonation_session');
    localStorage.removeItem('raw-surf-user-original');
  };

  /**
   * Get the real admin user ID (for API calls that need admin auth)
   */
  const getAdminId = () => {
    if (impersonation && originalUser) {
      return originalUser.id;
    }
    return user?.is_admin ? user.id : null;
  };

  /**
   * Check if currently in read-only impersonation mode
   */
  const isReadOnlyMode = () => {
    return impersonation?.is_read_only || user?._isReadOnly || false;
  };

  /**
   * Get the effective user for display (impersonated or real)
   */
  const getEffectiveUser = () => {
    return user;
  };

  /**
   * Get the original admin user (if impersonating)
   */
  const getOriginalAdmin = () => {
    return originalUser;
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      signup, 
      login, 
      logout, 
      updateUser,
      refreshUser,
      updateSubscription,
      submitProOnboarding,
      loading,
      // Impersonation
      impersonation,
      originalUser,
      startImpersonation,
      endImpersonation,
      getAdminId,
      isReadOnlyMode,
      getEffectiveUser,
      getOriginalAdmin,
      isImpersonating: !!impersonation
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
