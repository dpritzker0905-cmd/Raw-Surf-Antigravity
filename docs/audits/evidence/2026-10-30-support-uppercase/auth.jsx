import React, { createContext, useContext, useState } from 'react';
const Context = createContext();
export const OWNER = '11111111-1111-4111-8111-111111111111';
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem('uppercase-user') || 'null'));
  const update = account => {
    if (account) { sessionStorage.setItem('uppercase-user', JSON.stringify(account)); localStorage.setItem('raw-surf-user', JSON.stringify(account)); }
    else { sessionStorage.removeItem('uppercase-user'); localStorage.removeItem('raw-surf-user'); }
    setUser(account);
  };
  window.uppercaseFixture.setUser = update; window.uppercaseFixture.currentUser = user?.id;
  const login = async () => { const account = { id: OWNER, role: 'Grom' }; update(account); return account; };
  return <Context.Provider value={{ user, loading: false, login, signup: login }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
