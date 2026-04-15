import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { User, Camera, Building2, MapPin, Zap, TrendingUp, Sparkles, BadgeCheck } from 'lucide-react';

export const Home = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: Camera,
      title: 'Live Photographers',
      description: "See who's actively shooting at your break and book on the spot."
    },
    {
      icon: MapPin,
      title: 'Spot Discovery',
      description: 'Explore surf spots worldwide with real-time conditions.'
    },
    {
      icon: Zap,
      title: 'Instant Delivery',
      description: 'Get your session photos and videos delivered instantly.'
    },
    {
      icon: TrendingUp,
      title: 'Surf Streaks',
      description: 'Track sessions, earn achievements, climb leaderboards.'
    },
    {
      icon: Sparkles,
      title: 'AI Highlight Reels',
      description: 'Auto-curated highlight reels for easy social sharing.'
    },
    {
      icon: BadgeCheck,
      title: 'Verified Pros',
      description: 'Reliability scores and verified badges you can trust.'
    }
  ];

  return (
    <div className="bg-black text-white min-h-screen relative overflow-hidden">
      {/* Gradient Orbs - Coderick Style */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Large yellow-orange orb on the left */}
        <div 
          className="absolute rounded-full"
          style={{
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(255,180,50,0.4) 0%, rgba(255,140,0,0.2) 40%, transparent 70%)',
            left: '-200px',
            top: '200px',
            filter: 'blur(60px)'
          }}
        />
        {/* Yellow orb top right */}
        <div 
          className="absolute rounded-full"
          style={{
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(200,180,50,0.3) 0%, transparent 70%)',
            right: '-100px',
            top: '100px',
            filter: 'blur(40px)'
          }}
        />
        {/* Orange orb bottom right */}
        <div 
          className="absolute rounded-full"
          style={{
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(180,140,60,0.35) 0%, transparent 70%)',
            right: '-150px',
            bottom: '50px',
            filter: 'blur(50px)'
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-zinc-800/50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold" style={{ fontFamily: 'Oswald' }}>Raw Surf</span>
          </div>
          <Button
            onClick={() => navigate('/auth?tab=login')}
            variant="ghost"
            className="text-white hover:bg-zinc-800"
          >
            Log In
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4">
        <div className="container mx-auto max-w-4xl text-center space-y-8">
          {/* Logo */}
          <div className="flex justify-center">
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="w-24 h-24"
            />
          </div>

          {/* Live Photographers Badge */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/80 backdrop-blur-sm rounded-full border border-emerald-500/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-emerald-400 text-sm font-medium">4 Photographers shooting live now</span>
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-tight" style={{ fontFamily: 'Oswald' }}>
              <span className="text-white">Your surf.</span>
              <br />
              <span className="bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 bg-clip-text text-transparent">
                Captured live.
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              The Instagram for surfers. Share sessions, discover live photographers, track your streaks, and build your surf story.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-4">
            <Button
              onClick={() => navigate('/auth?tab=signup&category=surfer')}
              className="min-w-[180px] h-12 text-base font-bold bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black border-0"
              data-testid="cta-surfer"
            >
              <User className="w-4 h-4 mr-2" />
              I'm a Surfer
            </Button>

            <Button
              onClick={() => navigate('/auth?tab=signup&category=photographer')}
              className="min-w-[180px] h-12 text-base font-medium bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 hover:border-zinc-600"
              data-testid="cta-photographer"
            >
              <Camera className="w-4 h-4 mr-2" />
              I Shoot Surf
            </Button>

            <Button
              onClick={() => navigate('/auth?tab=signup&category=business')}
              className="min-w-[180px] h-12 text-base font-medium bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 hover:border-zinc-600"
              data-testid="cta-business"
            >
              <Building2 className="w-4 h-4 mr-2" />
              I'm a Business
            </Button>
          </div>

          {/* Value Props by User Type */}
          <div className="grid md:grid-cols-3 gap-4 pt-8 max-w-3xl mx-auto text-left">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-emerald-400 font-medium mb-2">
                <User className="w-4 h-4" />
                Surfers
              </div>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• Book photographers on the beach</li>
                <li>• Build your session portfolio</li>
                <li>• Get discounts on photo packages</li>
              </ul>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-yellow-400 font-medium mb-2">
                <Camera className="w-4 h-4" />
                Photographers
              </div>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• Set your own session prices</li>
                <li>• Get booked by local surfers</li>
                <li>• 15-20% platform fee on sales</li>
              </ul>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-orange-400 font-medium mb-2">
                <Building2 className="w-4 h-4" />
                Businesses
              </div>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• List services & products</li>
                <li>• Book event photographers</li>
                <li>• Sponsor local talent</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-20 px-4 bg-zinc-900/30">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-12" style={{ fontFamily: 'Oswald' }}>
            Built for the lineup
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={index}
                  className="bg-zinc-900/60 backdrop-blur-sm border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-black" />
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-white" style={{ fontFamily: 'Oswald' }}>
                    {feature.title}
                  </h3>
                  <p className="text-gray-400 text-sm">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 px-4">
        <div 
          className="container mx-auto max-w-4xl rounded-2xl p-12 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(52,211,153,0.9) 0%, rgba(250,204,21,0.9) 50%, rgba(249,115,22,0.9) 100%)'
          }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-black mb-4" style={{ fontFamily: 'Oswald' }}>
            Ready to paddle out?
          </h2>
          <p className="text-black/80 mb-8">
            Join the community making every session count.
          </p>
          <Button
            onClick={() => navigate('/auth?tab=signup')}
            className="min-w-[200px] h-14 text-lg font-bold bg-black hover:bg-zinc-900 text-white"
          >
            Create Account →
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-12 px-4 bg-black border-t border-zinc-800">
        <div className="container mx-auto text-center space-y-4">
          <div className="flex justify-center items-center gap-2">
            <img
              src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
              alt="Raw Surf"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold text-white" style={{ fontFamily: 'Oswald' }}>Raw Surf</span>
          </div>
          <p className="text-gray-500 text-sm">© 2026 Raw Surf. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
