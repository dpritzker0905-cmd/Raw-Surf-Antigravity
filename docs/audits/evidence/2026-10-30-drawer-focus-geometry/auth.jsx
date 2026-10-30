// Synthetic account seam only. No real JWT, provider or external authentication.
import React, { createContext, useContext, useState } from 'react';
const Context = createContext();
export const OWNER = '11111111-1111-4111-8111-111111111111';
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem('shell-user') || 'null'));
  const update = account => {
    if (account) {
      sessionStorage.setItem('shell-user', JSON.stringify(account));
      // Random ephemeral fixture marker, solely to exercise the real ToS API branch.
      localStorage.setItem('raw-surf-user', JSON.stringify({ ...account, access_token: crypto.randomUUID() }));
    } else {
      sessionStorage.removeItem('shell-user'); localStorage.removeItem('raw-surf-user');
    }
    setUser(account);
  };
  window.shellFixture.setUser = update;
  window.shellFixture.currentUser = user?.id;
  const login = async () => {
    const account = { id: OWNER, role: window.shellFixture.role || 'Grom', full_name: 'Synthetic owner', subscription_tier: null };
    update(account); return account;
  };
  return <Context.Provider value={{ user, loading: false, login, signup: login, logout: () => update(null),
    impersonation: null, updateUser: update }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
