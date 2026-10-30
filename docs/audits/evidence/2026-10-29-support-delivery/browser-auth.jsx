import React, { createContext, useContext, useState } from 'react';
const Context = createContext();
export const OWNER = '11111111-1111-4111-8111-111111111111';
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  window.supportFixture.setUser = setUser;
  window.supportFixture.currentUser = user?.id;
  const login = async () => {
    const account = { id: OWNER, role: 'Grom', tos_version: 'fixture-current' };
    setUser(account); return account;
  };
  return <Context.Provider value={{ user, loading: false, login, signup: login }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
