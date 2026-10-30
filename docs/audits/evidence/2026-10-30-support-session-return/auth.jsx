// Synthetic session provider; real Auth, MFA controls, Axios and rejection-state modules are tested.
import React, { createContext, useContext, useState } from 'react';
import apiClient from '@actual-client';
import { clearSessionRejected } from '@actual-rejection';
const Context = createContext();
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('raw-surf-user') || 'null'));
  const startSession = account => {
    localStorage.setItem('raw-surf-user', JSON.stringify(account)); clearSessionRejected(); setUser(account); return account;
  };
  window.returnFixture.setUser = startSession;
  const login = async (email, password) => {
    const { data } = await apiClient.post('/auth/login', { email, password });
    return data.mfa_required ? data : startSession(data);
  };
  const completeMfaLogin = async (challengeToken, code) => {
    const { data } = await apiClient.post('/auth/login/mfa', { challenge_token: challengeToken, code });
    return startSession(data);
  };
  return <Context.Provider value={{ user, loading: false, login, signup: login, completeMfaLogin, startSession }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
