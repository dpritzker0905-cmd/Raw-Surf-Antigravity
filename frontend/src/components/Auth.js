import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import { toast } from 'sonner';
import { ArrowLeft, User, Camera, Building2, Trophy, Star, Eye, EyeOff, X, Shield } from 'lucide-react';
import { ROLES } from '../constants/roles';
import { CURRENT_TOS_VERSION } from '../constants/tos';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const ROLE_CONFIG = {
  surfer: {
    title: 'Surfers',
    icon: User,
    tagline: 'Get your sessions captured by local pros',
    benefits: ['Book photographers on the beach', 'Build your surf portfolio', 'Track streaks & compete'],
    roles: [
      { id: 'Grom', label: 'Grom', icon: '\u{1F3C4}', description: 'Under 18 \u2013 Parent-linked account', requiresParent: true },
      { id: 'Surfer', label: 'Surfer', icon: '\u{1F30A}', description: 'Casual to committed wave rider' }
    ]
  },
  photographer: {
    title: 'Photographers',
    icon: Camera,
    tagline: 'Turn your surf shots into income',
    benefits: ['Set your own prices', 'Get booked by surfers', 'AI-powered editing tools'],
    roles: [
      { id: 'Hobbyist', label: 'Hobbyist', icon: '\u{1F4F7}', description: 'Free \u00B7 Contribute \u00B7 Earn Gear Credits' },
      { id: 'Photographer', label: 'Photographer', icon: '\u{1F4F8}', description: 'Unlimited storage \u00B7 Set your prices \u00B7 Track surfers' },
      { id: 'Approved Pro', label: 'Verified Pro Photographer', icon: '\u{2B50}', description: 'Verified badge \u00B7 Lower commission \u00B7 Priority placement' }
    ]
  },
  business: {
    title: 'Surf Businesses',
    icon: Building2,
    tagline: 'Reach the surf community',
    benefits: ['List services & products', 'Book photographers for events', 'Sponsor local talent'],
    roles: [
      { id: 'School', label: 'Surf School', icon: '\u{1F3EB}', description: 'Lessons, camps & training' },
      { id: 'Coach', label: 'Surf Coach', icon: '\u{1F3C6}', description: 'Personal & group coaching' },
      { id: 'Shop', label: 'Shop/Brand', icon: '\u{1F6CD}\u{FE0F}', description: 'Retail, gear & apparel' },
      { id: 'Shaper', label: 'Shaper', icon: '\u{1FA93}', description: 'Custom boards & repairs' },
      { id: 'Resort', label: 'Resort/Retreat', icon: '\u{1F3D6}\u{FE0F}', description: 'Surf trips & accommodations' }
    ]
  }
};

export const Auth = () => {
  const { signup, login, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const tab = searchParams.get('tab') || 'signup';
  const category = searchParams.get('category');
  const redirectPath = searchParams.get('redirect');
  
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showTosModal, setShowTosModal] = useState(false);
  const [authTosContent, setAuthTosContent] = useState({ sections: [], version: '', effective_date: '' });
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    username: '',  // Required @username handle
    parent_email: '',
    birthdate: '',  // YYYY-MM-DD for Groms
    company_name: '',
    grom_competes: false  // For competitive Groms
  });

  const categoryConfig = category ? ROLE_CONFIG[category] : null;
  const isLogin = tab === 'login';
  const showCategorySelection = tab === 'signup' && !category;

  // Auto-redirect authenticated users to feed
  useEffect(() => {
    if (user) {
      navigate('/feed', { replace: true });
    }
  }, [user, navigate]);

  // Fetch ToS content from DB when modal opens
  useEffect(() => {
    if (showTosModal && authTosContent.sections.length === 0) {
      apiClient.get('/compliance/tos-content/current?doc_type=tos')
        .then(res => setAuthTosContent(res.data))
        .catch(() => {});
    }
  }, [showTosModal]);

  const handleTabChange = (newTab) => {
    if (newTab === 'login') {
      setSearchParams({ tab: 'login' });
    } else {
      setSearchParams({ tab: 'signup' });
    }
    setSelectedRole(null);
  };

  const handleCategorySelect = (cat) => {
    setSearchParams({ tab: 'signup', category: cat });
    setSelectedRole(null);
  };

  const handleBackToCategories = () => {
    setSearchParams({ tab: 'signup' });
    setSelectedRole(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const userData = await login(formData.email, formData.password);
        toast.success('Welcome back!');
        
        // IMPORTANT: After login, we need to properly reset the history stack
        // so that the browser back button doesn't go back to /auth
        // This must happen BEFORE any navigation
        window.history.replaceState(null, '', window.location.pathname);
        
        // Check for redirect path from protected route
        if (redirectPath) {
          // Use replace to prevent back button going to /auth
          navigate(redirectPath, { replace: true });
          return;
        }
        
        // Check routing based on user state
        // Groms with linked & approved parents get auto-access (no subscription needed)
        const isLinkedGrom = userData.role === ROLES.GROM && userData.parent_id && userData.parent_link_approved;
        
        if (!userData.subscription_tier && ['Grom', 'Surfer', 'Comp Surfer', 'Pro'].includes(userData.role) && !isLinkedGrom) {
          navigate('/surfer-subscription', { replace: true });
        } else if (!userData.subscription_tier && userData.role === ROLES.PHOTOGRAPHER) {
          navigate('/photographer-subscription', { replace: true });
        } else if (userData.role === ROLES.APPROVED_PRO && !userData.portfolio_url) {
          navigate('/pro-onboarding', { replace: true });
        } else {
          navigate('/feed', { replace: true });
        }
      } else {
        if (!selectedRole) {
          toast.error('Please select a profile type');
          setLoading(false);
          return;
        }

        // Validate parent email for Groms
        if (selectedRole.requiresParent && !formData.parent_email) {
          toast.error('Parent/Guardian email is required for Grom accounts');
          setLoading(false);
          return;
        }

        // Validate password length
        if (formData.password.length < 8) {
          toast.error('Password must be at least 8 characters');
          setLoading(false);
          return;
        }

        // Validate username
        if (!formData.username || formData.username.length < 3) {
          toast.error('Username must be at least 3 characters');
          setLoading(false);
          return;
        }
        
        // Validate ToS acceptance
        if (!tosAccepted) {
          toast.error('Please accept the Terms of Service to continue');
          setLoading(false);
          return;
        }

        const isBusinessCategory = category === 'business';
        if (isBusinessCategory && !formData.company_name) {
          toast.error('Company name is required for business accounts');
          setLoading(false);
          return;
        }

        const userData = await signup(
          formData.email,
          formData.password,
          formData.full_name,
          formData.username.toLowerCase().replace('@', ''),  // Clean username
          selectedRole.id,
          selectedRole.requiresParent ? formData.parent_email : null,
          isBusinessCategory ? formData.company_name : null,
          selectedRole.requiresParent ? formData.birthdate : null,  // Birthdate for Groms
          selectedRole.id === 'Grom' ? formData.grom_competes : false  // Competition status for Groms
        );

        // Record ToS acceptance on the backend (fire-and-forget)
        try {
          await apiClient.post('/compliance/acknowledge-tos', {
            tos_version: CURRENT_TOS_VERSION
          });
        } catch (tosErr) {
          // Non-blocking - account is created, we just couldn't record ToS
          logger.warn('Failed to record ToS acceptance:', tosErr);
        }

        toast.success('Account created! Welcome to Raw Surf');
        // Clear auth page from history stack before navigating
        window.history.replaceState(null, '', window.location.pathname);
        
        // Check for redirect path from protected route
        if (redirectPath) {
          navigate(redirectPath, { replace: true });
          return;
        }
        
        // Route based on user role - same logic as login
        const isLinkedGrom = userData.role === ROLES.GROM && userData.parent_id && userData.parent_link_approved;
        
        if (!userData.subscription_tier && ['Grom', 'Surfer', 'Comp Surfer', 'Pro'].includes(userData.role) && !isLinkedGrom) {
          navigate('/surfer-subscription', { replace: true });
        } else if (!userData.subscription_tier && userData.role === ROLES.PHOTOGRAPHER) {
          navigate('/photographer-subscription', { replace: true });
        } else if (!userData.subscription_tier && userData.role === ROLES.HOBBYIST) {
          navigate('/photographer-subscription', { replace: true });
        } else if (userData.role === ROLES.APPROVED_PRO && !userData.portfolio_url) {
          navigate('/pro-onboarding', { replace: true });
        } else if (!userData.subscription_tier && userData.role === ROLES.APPROVED_PRO) {
          navigate('/photographer-subscription', { state: { userType: 'verified_pro' }, replace: true });
        } else if (['School', 'Coach', 'Shop', 'Shaper', 'Resort'].includes(userData.role)) {
          // Business roles - they get business tier automatically, go to feed
          navigate('/feed', { replace: true });
        } else {
          navigate('/feed', { replace: true });
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <Card className="auth-card w-full max-w-md overflow-hidden" data-testid="auth-card">
        {/* Header with Logo */}
        <div className="text-center pt-8 pb-4">
          <div 
            className="flex items-center justify-center gap-2 mb-6 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => navigate('/')}
            data-testid="auth-logo-link"
          >
            <img loading="lazy" decoding="async"
              src="/logo.svg"
              alt="Raw Surf"
              className="w-10 h-10"
            />
            <span className="auth-title text-2xl font-bold font-oswald" >Raw Surf</span>
          </div>

          {/* Login / Sign Up Tabs */}
          <div className="flex mx-6 bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => handleTabChange('login')}
              className={`flex-1 py-3 text-sm font-medium rounded-md transition-all ${
                isLogin 
                  ? 'bg-zinc-700 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
              data-testid="login-tab"
            >
              Log In
            </button>
            <button
              onClick={() => handleTabChange('signup')}
              className={`flex-1 py-3 text-sm font-medium rounded-md transition-all ${
                !isLogin 
                  ? 'bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black' 
                  : 'text-gray-400 hover:text-white'
              }`}
              data-testid="signup-tab"
            >
              Sign Up
            </button>
          </div>
        </div>

        <div className="px-6 pb-6">
          {/* Login Form */}
          {isLogin && (
            <form onSubmit={handleSubmit} className="space-y-4 mt-6">
              <label htmlFor="login-email" className="sr-only">Email address</label>
              <Input
                type="email"
                placeholder="Email"
                aria-label="Email address"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="auth-input h-12"
                required
                data-testid="login-email-input"
                id="login-email"
              />
              <div className="relative">
                <label htmlFor="login-password" className="sr-only">Password</label>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  aria-label="Password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="auth-input h-12 pr-10"
                  required
                  data-testid="login-password-input"
                  id="login-password"
                />
                <button
                  type="button"
                  aria-expanded={showPassword} onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
                data-testid="login-submit"
              >
                {loading ? 'Logging in...' : 'Log In'}
              </Button>
              
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors"
                data-testid="forgot-password-link"
              >
                Forgot your password?
              </button>
            </form>
          )}

          {/* Category Selection */}
          {showCategorySelection && (
            <div className="mt-6">
              <h3 className="text-center text-white text-lg mb-6">I am a...</h3>
              <div className="space-y-3">
                {Object.entries(ROLE_CONFIG).map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => handleCategorySelect(key)}
                      className="w-full flex items-start gap-4 p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-all text-left"
                      data-testid={`category-${key}`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-emerald-400/20 via-yellow-400/20 to-orange-400/20 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-yellow-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium">
                          {key === 'surfer' ? 'Surfer' : key === 'photographer' ? 'Photographer' : 'Business'}
                        </div>
                        <div className="text-gray-400 text-sm mt-0.5">
                          {config.tagline}
                        </div>
                        {config.benefits && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {config.benefits.slice(0, 2).map((benefit, idx) => (
                              <span key={idx} className="text-xs px-2 py-0.5 bg-zinc-700 rounded-full text-gray-300">
                                {benefit}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Signup Form with Category */}
          {!isLogin && category && categoryConfig && (
            <div className="mt-4">
              {/* Back to Categories */}
              <button aria-label="Go back"
                onClick={handleBackToCategories}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
                data-testid="back-to-categories"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to categories
              </button>

              {/* Category Badge */}
              <div className="flex justify-center mb-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full border border-zinc-700">
                  <categoryConfig.icon className="w-4 h-4 text-gray-400" />
                  <span className="text-white font-medium">{categoryConfig.title}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Business-specific fields */}
                {category === 'business' && (
                  <Input
                    type="text"
                    placeholder="Company Name"
                    aria-label="Company name"
                    value={formData.company_name}
                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    className="auth-input h-12"
                    required
                    data-testid="company-name-input"
                  />
                )}

                <Input
                  type="text"
                  placeholder={category === 'business' ? 'Contact Name' : 'Full Name'}
                  aria-label={category === 'business' ? 'Contact name' : 'Full name'}
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="auth-input h-12"
                  required
                  data-testid="full-name-input"
                />

                {/* Username field - Required */}
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                  <Input
                    type="text"
                    placeholder="username"
                    aria-label="Username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                    className="auth-input h-12 pl-8"
                    required
                    minLength={3}
                    maxLength={30}
                    aria-describedby="username-hint"
                    data-testid="username-input"
                  />
                </div>
                <p id="username-hint" className="text-xs text-gray-500 -mt-2">Letters, numbers, underscores. 3-30 characters.</p>
                <p id="password-hint" className="sr-only">Minimum 8 characters</p>

                <Input
                  type="email"
                  placeholder="Email"
                  aria-label="Email address"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="auth-input h-12"
                  required
                  data-testid="email-input"
                />

                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    aria-label="Password"
                    aria-describedby="password-hint"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="auth-input h-12 pr-10"
                    required
                    data-testid="password-input"
                  />
                  <button
                    type="button"
                    aria-expanded={showPassword} onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {/* Parent email for Groms */}
                {selectedRole?.requiresParent && (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-400 uppercase tracking-wider">
                      Parent/Guardian Information
                    </div>
                    <Input
                      type="email"
                      placeholder="Parent/Guardian Email"
                      aria-label="Parent or guardian email"
                      value={formData.parent_email}
                      onChange={(e) => setFormData({ ...formData, parent_email: e.target.value })}
                      className="auth-input h-12"
                      required
                      data-testid="parent-email-input"
                    />
                    <Input
                      type="date"
                      placeholder="Your Birthdate"
                      aria-label="Birthdate"
                      value={formData.birthdate}
                      onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })}
                      className="auth-input h-12"
                      required
                      max={new Date().toISOString().split('T')[0]}
                      data-testid="birthdate-input"
                    />
                    
                    {/* Grom Competes Toggle */}
                    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-yellow-400" />
                        <div>
                          <div className="text-sm font-medium text-white">Grom Competes</div>
                          <div className="text-xs text-gray-400">Participates in surf competitions</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formData.grom_competes}
                        aria-label="Grom competes in surf competitions"
                        onClick={() => setFormData({ ...formData, grom_competes: !formData.grom_competes })}
                        className={`w-12 h-6 rounded-full transition-colors ${
                          formData.grom_competes ? 'bg-yellow-500' : 'bg-zinc-700'
                        }`}
                        data-testid="grom-competes-toggle"
                      >
                        <div
                          className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                            formData.grom_competes ? 'translate-x-6' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                    {formData.grom_competes && (
                      <p className="text-xs text-yellow-400/80 flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        Competitive Groms get access to the Stoked dashboard and sponsorship opportunities!
                      </p>
                    )}
                    
                    <p className="text-xs text-gray-500">
                      Your parent will receive an invite to link your account
                    </p>
                  </div>
                )}

                {/* Role Selection */}
                <div className="pt-2">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">
                    Choose your profile type
                  </div>
                  <div className="space-y-2">
                    {categoryConfig.roles.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedRole(role)}
                        className={`w-full flex items-center gap-3 p-4 rounded-lg border transition-all ${
                          selectedRole?.id === role.id
                            ? 'bg-gradient-to-r from-emerald-400/20 via-yellow-400/20 to-orange-400/20 border-yellow-400'
                            : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'
                        }`}
                        data-testid={`role-${role.id}`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedRole?.id === role.id
                            ? 'border-yellow-400'
                            : 'border-zinc-600'
                        }`}>
                          {selectedRole?.id === role.id && (
                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                          )}
                        </div>
                        <span className="text-lg">{role.icon}</span>
                        <div className="text-left">
                          <div className="text-white font-medium">{role.label}</div>
                          <div className="text-gray-400 text-sm">{role.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ToS Acceptance */}
                <div className="pt-3">
                  <label className="flex items-start gap-3 cursor-pointer group" data-testid="tos-checkbox-label">
                    <div
                      onClick={() => setTosAccepted(!tosAccepted)}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        tosAccepted
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-zinc-600 group-hover:border-zinc-400'
                      }`}
                      data-testid="tos-checkbox"
                    >
                      {tosAccepted && (
                        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-gray-400 leading-tight">
                      I agree to the{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowTosModal(true); }}
                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                        data-testid="tos-link"
                      >
                        Terms of Service
                      </button>
                      {' '}and{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowTosModal(true); }}
                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                        data-testid="privacy-link"
                      >
                        Privacy Policy
                      </button>
                    </span>
                  </label>
                </div>

                <Button
                  type="submit"
                  disabled={loading || !tosAccepted}
                  className={`w-full h-12 font-bold mt-4 transition-all ${
                    tosAccepted
                      ? 'bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black'
                      : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                  }`}
                  data-testid="signup-submit"
                >
                  {loading ? 'Creating Account...' : 'Create Account'}
                </Button>
              </form>
            </div>
          )}
        </div>

        {/* Footer Link */}
        <div className="bg-zinc-800/50 py-4 text-center border-t border-zinc-800">
          {isLogin ? (
            <span className="text-gray-400">
              Don't have an account?{' '}
              <button
                onClick={() => handleTabChange('signup')}
                className="text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Sign up
              </button>
            </span>
          ) : (
            <span className="text-gray-400">
              Have an account?{' '}
              <button
                onClick={() => handleTabChange('login')}
                className="text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Log in
              </button>
            </span>
          )}
        </div>
      </Card>

      {/* ToS Modal */}
      {showTosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <Shield className="w-5 h-5 text-cyan-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Terms of Service</h2>
              </div>
              <button
                onClick={() => setShowTosModal(false)}
                className="p-1 rounded-full hover:bg-zinc-800 text-gray-400 hover:text-white transition-colors"
                aria-label="Close terms of service"
                data-testid="tos-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-gray-300 space-y-4" style={{ maxHeight: '60vh' }}>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Version {authTosContent.version || CURRENT_TOS_VERSION} \u00B7 Effective {authTosContent.effective_date || 'May 2026'}</p>
              {(authTosContent.sections || []).map((section, idx) => (
                <React.Fragment key={idx}>
                  <h3 className="text-white font-semibold text-base">{section.title}</h3>
                  <p>{section.body}</p>
                </React.Fragment>
              ))}
              {(!authTosContent.sections || authTosContent.sections.length === 0) && (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-zinc-800 flex gap-3">
              <Button
                onClick={() => setShowTosModal(false)}
                variant="outline"
                className="flex-1 border-zinc-700 text-gray-300 hover:bg-zinc-800"
              >
                Close
              </Button>
              <Button
                onClick={() => { setTosAccepted(true); setShowTosModal(false); }}
                className="flex-1 bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 text-black font-semibold"
                data-testid="tos-accept-button"
              >
                I Agree
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
