import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { TopNavDrawerTray } from '../TopNavDrawerTray';
import { Settings } from '../Settings';
import { useNavigate } from 'react-router-dom';
import { ROLES } from '../../constants/roles';

// CRA's Jest resolver does not resolve react-router-dom 7's package exports.
// Use the actual router implementation, as the existing notification tests do.
jest.mock('react-router-dom', () => {
  global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
  global.TextDecoder = global.TextDecoder || require('util').TextDecoder;
  return jest.requireActual('react-router');
}, { virtual: true });

let mockUser;
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, logout: jest.fn() }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }),
  getExpandedRoleInfo: role => ({ label: role }) }));
jest.mock('../../hooks/useActiveSession', () => ({ __esModule: true, default: () => ({ activeSession: null }) }));
jest.mock('../../hooks/useUnreadCounts', () => ({ __esModule: true, default: () => ({ notifications: 0, messages: 0 }) }));
jest.mock('../../hooks/useRoutePreloader', () => ({ __esModule: true, default: () => () => {} }));
jest.mock('../SurfPassport', () => ({ SurfPassport: () => null }));
jest.mock('../GlobalSearchBar', () => ({ GlobalSearchBar: () => null }));
jest.mock('../AdaptiveBackground', () => ({ AdaptiveBackground: () => null }));
jest.mock('../BackpackDrawer', () => ({ BackpackDrawer: () => null }));
jest.mock('../PhotoToolsDrawer', () => ({ PhotoToolsDrawer: () => null }));
jest.mock('../SurferSessionHub', () => ({ SurferSessionHub: ({ children }) => children }));

const Location = () => <output data-testid="destination">{useLocation().pathname + useLocation().search + useLocation().hash}</output>;
const mount = (component, initial = '/settings?unrelated=synthetic#section') => render(<MemoryRouter initialEntries={[initial]}>{component}<Location /></MemoryRouter>);


jest.mock('../../hooks/useOfflineMode',()=>({__esModule:true,default:()=>({isOnline:true,getCacheSize:()=>0,formatCacheTime:()=>''})}));
jest.mock('../../hooks/useSettingsActions',()=>({__esModule:true,default:({setExpandedSections})=>({toggleSection:name=>setExpandedSections(prev=>({...prev,[name]:!prev[name]})),fetchPrivacySettings:jest.fn(),fetchNotificationPrefs:jest.fn(),fetchFriends:jest.fn(),handleLogout:jest.fn()})}));
jest.mock('../settings/AccountBillingHub',()=>({AccountBillingHub:()=>null}));
jest.mock('../settings/AdCenterPanel',()=>({AdCenterPanel:()=>null}));
jest.mock('../settings/SurfModeCard',()=>({SurfModeCard:()=>null}));
jest.mock('../settings/GromParentCard',()=>({GromParentCard:()=>null}));
jest.mock('../settings/UsernameCard',()=>({UsernameCard:()=>null}));
jest.mock('../settings/MetaConnectionsCard',()=>({MetaConnectionsCard:()=>null}));
jest.mock('../settings/PasswordSecurityCard',()=>({PasswordSecurityCard:()=>null}));
jest.mock('../settings/PrivacySection',()=>({PrivacySection:()=>null}));
jest.mock('../settings/NotificationSection',()=>({NotificationSection:()=>null}));
jest.mock('../settings/LegalSection',()=>({LegalSection:()=>null}));

describe.each(Object.values(ROLES))('Settings-only Customer Support for %s',role=>{
 beforeEach(()=>{mockUser={id:'synthetic-entry-owner',role,is_admin:role===ROLES.GOD};});
 test('first-level Settings row opens the plain owner inbox',()=>{
  mount(<Settings/>,'/settings');
  const row=screen.getByTestId('settings-support-entry');
  expect(screen.getByRole('heading',{name:'Settings',exact:true}).nextElementSibling).toBe(row);
  fireEvent.click(screen.getByRole('button',{name:/Customer Support/}));
  expect(screen.getByTestId('destination')).toHaveTextContent(/^\/support$/);
 });
 test('desktop exposes Settings and no separate customer Support link',()=>{
  mount(<Sidebar/>,'/profile');
  expect(screen.queryByTestId('nav-support')).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Settings',exact:true})).toHaveAttribute('href','/settings');
  expect(screen.getByTestId('nav-messages')).toHaveAttribute('href','/messages');
 });
 test('mobile tools expose Settings and no separate customer Support item',()=>{
  mount(<TopNavDrawerTray isOpen/>,'/profile');
  expect(screen.queryByTestId('drawer-support')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));
  expect(screen.getByTestId('destination')).toHaveTextContent(/^\/settings$/);
  expect(screen.getByTestId('drawer-backpack')).toBeInTheDocument();
 });
});
test('collapsing Account does not hide first-level Customer Support',()=>{
 mockUser={id:'synthetic-entry-owner',role:ROLES.SURFER};mount(<Settings/>,'/settings');
 fireEvent.click(screen.getByText('Account',{exact:true}));
 expect(screen.getByRole('button',{name:/Customer Support/})).toBeVisible();
});
const Back=()=>{const navigate=useNavigate();return <button onClick={()=>navigate(-1)}>Browser Back</button>;};
test('Settings navigation preserves a return history entry',()=>{
 mockUser={id:'synthetic-entry-owner',role:ROLES.SURFER};mount(<><Settings/><Back/></>,'/settings');
 fireEvent.click(screen.getByRole('button',{name:/Customer Support/}));fireEvent.click(screen.getByRole('button',{name:'Browser Back'}));
 expect(screen.getByTestId('destination')).toHaveTextContent(/^\/settings$/);
});
