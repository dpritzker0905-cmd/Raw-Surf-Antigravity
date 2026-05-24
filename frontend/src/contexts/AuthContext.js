import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../lib/apiClient';

const AuthContext = createContext();

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
    let storedUser = localStorage.getItem('raw-surf-user');
    if (!storedUser && process.env.NODE_ENV === 'development') {
      const mockDevUser = {
        id: 'dev-mock-user-id',
        email: 'dev@rawsurf.com',
        full_name: 'Dev User',
        username: 'devuser',
        role: 'user',
        subscription_tier: 'tier_1',
        is_admin: true
      };
      localStorage.setItem('raw-surf-user', JSON.stringify(mockDevUser));
      storedUser = JSON.stringify(mockDevUser);
    }
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      document.documentElement.classList.remove('no-god-mode');
      
      // Auto-refresh if username is missing (backwards compatibility)
      if (parsedUser?.id && parsedUser.id !== 'dev-mock-user-id' && !parsedUser?.username) {
        apiClient.get(`/profiles/${parsedUser.id}`)
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

  const signup = useCallback(async (email, password, full_name, username, role, parent_email, company_name, birthdate, grom_competes = false) => {
    const response = await apiClient.post('/auth/signup', {
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
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await apiClient.post('/auth/login', {
      email,
      password
    });
    const userData = response.data;
    setUser(userData);
    localStorage.setItem('raw-surf-user', JSON.stringify(userData));
    document.documentElement.classList.remove('no-god-mode');
    return userData;
  }, []);

  const endImpersonation = useCallback(async () => {
    if (!impersonation || !originalUser) return;
    
    try {
      await apiClient.post(`/admin/impersonate/${impersonation.session_id}/end`);
    } catch (e) {
      // Continue anyway
    }
    
    setUser(originalUser);
    localStorage.setItem('raw-surf-user', JSON.stringify(originalUser));
    
    setImpersonation(null);
    setOriginalUser(null);
    localStorage.removeItem('impersonation_session');
    localStorage.removeItem('raw-surf-user-original');
  }, [impersonation, originalUser]);

  const logout = useCallback(() => {
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
    localStorage.removeItem('impersonation_session');
    document.documentElement.classList.add('no-god-mode');
  }, [impersonation, endImpersonation]);

  const updateUser = useCallback((updates) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      localStorage.setItem('raw-surf-user', JSON.stringify(updatedUser));
    }
  }, [user]);

  const refreshUser = useCallback(async () => {
    if (!user?.id) return null;
    try {
      const response = await apiClient.get(`/profiles/${user.id}`);
      const refreshedUser = { ...user, ...response.data };
      setUser(refreshedUser);
      localStorage.setItem('raw-surf-user', JSON.stringify(refreshedUser));
      return refreshedUser;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      return null;
    }
  }, [user]);

  const updateSubscription = useCallback(async (profileId, subscriptionTier) => {
    const response = await apiClient.post(`/profiles/${profileId}/subscription`, {
      subscription_tier: subscriptionTier
    });
    updateUser({ subscription_tier: subscriptionTier });
    return response.data;
  }, [updateUser]);

  const submitProOnboarding = useCallback(async (profileId, data) => {
    const response = await apiClient.post(`/profiles/${profileId}/pro-onboarding`, data);
    updateUser({ portfolio_url: data.portfolio_url });
    return response.data;
  }, [updateUser]);

  const startImpersonation = useCallback((session) => {
    if (!user?.is_admin) return;
    
    setOriginalUser(user);
    localStorage.setItem('raw-surf-user-original', JSON.stringify(user));
    
    setImpersonation(session);
    localStorage.setItem('impersonation_session', JSON.stringify(session));
    
    const effectiveUser = {
      ...session.target_user,
      _isImpersonated: true,
      _adminId: user.id,
      _sessionId: session.session_id,
      _isReadOnly: session.is_read_only
    };
    setUser(effectiveUser);
    localStorage.setItem('raw-surf-user', JSON.stringify(effectiveUser));
  }, [user]);

  const getAdminId = useCallback(() => {
    if (impersonation && originalUser) {
      return originalUser.id;
    }
    return user?.is_admin ? user.id : null;
  }, [impersonation, originalUser, user]);

  const isReadOnlyMode = useCallback(() => {
    return impersonation?.is_read_only || user?._isReadOnly || false;
  }, [impersonation, user]);

  const getEffectiveUser = useCallback(() => {
    return user;
  }, [user]);

  const getOriginalAdmin = useCallback(() => {
    return originalUser;
  }, [originalUser]);

  const contextValue = useMemo(() => ({
    user,
    signup,
    login,
    logout,
    updateUser,
    refreshUser,
    updateSubscription,
    submitProOnboarding,
    loading,
    impersonation,
    originalUser,
    startImpersonation,
    endImpersonation,
    getAdminId,
    isReadOnlyMode,
    getEffectiveUser,
    getOriginalAdmin,
    isImpersonating: !!impersonation
  }), [
    user,
    signup,
    login,
    logout,
    updateUser,
    refreshUser,
    updateSubscription,
    submitProOnboarding,
    loading,
    impersonation,
    originalUser,
    startImpersonation,
    endImpersonation,
    getAdminId,
    isReadOnlyMode,
    getEffectiveUser,
    getOriginalAdmin
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
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
