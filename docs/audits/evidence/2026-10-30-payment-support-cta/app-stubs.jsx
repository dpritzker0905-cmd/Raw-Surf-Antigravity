import React from 'react';
export const ThemeProvider=({children})=><>{children}</>;export const PricingProvider=ThemeProvider;export const PersonaProvider=ThemeProvider;
export const useTheme=()=>({theme:'light',setTheme:()=>{}});
export const usePricing=()=>({});export const usePersona=()=>({});
export const Toaster=()=>null;export const CallManager=()=>null;export const PushNotificationInit=()=>null;export const BackButtonHandler=()=>null;
export const Home=()=><p>Fixture home</p>;export const Feed=()=><p>Fixture feed</p>;export const ForgotPassword=Home;export const ResetPassword=Home;
export const ensureAudioUnlocked=()=>{};export const useUnreadCounts=()=>({refresh:()=>{}});
export default function Shell({children}){return <div data-fixture-shell>{children}</div>}

export const useThemeName=()=>'light';

export const RequestProSelfieModal=()=>null;
