import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { User, Camera, Building2 } from 'lucide-react';

export const AuthLanding = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black">
      <div className="text-center max-w-4xl mx-auto space-y-12">
        {/* Logo and Tagline */}
        <div className="space-y-6">
          <div className="relative inline-block">
            <div className="absolute inset-0 blur-2xl bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 opacity-40 rounded-full" />
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="relative w-32 h-32 mx-auto"
              data-testid="logo-image"
            />
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white" style={{ fontFamily: 'Oswald' }}>
            <span className="bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 bg-clip-text text-transparent">
              Raw Surf
            </span>
          </h1>
          <p className="text-xl text-gray-300 max-w-lg mx-auto">
            The social marketplace for the surf economy. Connect, capture, and share every session.
          </p>
        </div>

        {/* Three Main CTAs - Coderick Style */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {/* Surfer CTA - Primary */}
          <Button
            onClick={() => navigate('/auth/signup?category=surfer')}
            className="min-w-[200px] min-h-[56px] text-lg font-bold bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black border-0 shadow-lg shadow-yellow-400/30"
            data-testid="surfer-category-btn"
          >
            <User className="w-5 h-5 mr-2" />
            Get Started
          </Button>

          {/* Photographer CTA */}
          <Button
            onClick={() => navigate('/auth/signup?category=photographer')}
            className="min-w-[200px] min-h-[56px] text-lg font-medium bg-zinc-900 hover:bg-zinc-800 text-white border-2 border-zinc-700 hover:border-yellow-400 transition-all"
            data-testid="photographer-category-btn"
          >
            <Camera className="w-5 h-5 mr-2" />
            I Shoot Surf
          </Button>

          {/* Business CTA */}
          <Button
            onClick={() => navigate('/auth/signup?category=business')}
            className="min-w-[200px] min-h-[56px] text-lg font-medium bg-zinc-900 hover:bg-zinc-800 text-white border-2 border-zinc-700 hover:border-yellow-400 transition-all"
            data-testid="business-category-btn"
          >
            <Building2 className="w-5 h-5 mr-2" />
            Surf Co's
          </Button>
        </div>

        {/* Login Link */}
        <div className="mt-8">
          <button
            onClick={() => navigate('/auth/login')}
            className="text-gray-400 hover:text-white underline transition-colors"
            data-testid="already-have-account-link"
          >
            Already have an account? Log in
          </button>
        </div>
      </div>
    </div>
  );
};
