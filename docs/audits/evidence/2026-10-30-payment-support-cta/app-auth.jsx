import React,{createContext,useContext,useState} from 'react';
const C=createContext();window.fixture={requests:[],mode:'password'};
export const OWNER='11111111-1111-4111-8111-111111111111';
export function AuthProvider({children}){const [user,setUser]=useState({id:OWNER,role:'Surfer',tos_version:'fixture-current'});
window.fixture.setUser=setUser;window.fixture.user=user;
const finish=()=>{const value={id:OWNER,role:'Surfer',tos_version:'fixture-current'};setUser(value);return value;};
return <C.Provider value={{user,loading:false,login:async()=>window.fixture.mode==='mfa'?{mfa_required:true,challenge_token:'synthetic-only',methods:['totp']}:finish(),signup:async()=>finish(),completeMfaLogin:async()=>finish(),startSession:finish}}>{children}</C.Provider>}
export const useAuth=()=>useContext(C);
