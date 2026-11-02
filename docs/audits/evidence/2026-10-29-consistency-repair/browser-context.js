export const useAuth = () => ({ user: { id: 'fixture', role: 'surfer' } });
export const useTheme = () => ({ theme: new URLSearchParams(window.location.search).get('theme') || 'dark' });
