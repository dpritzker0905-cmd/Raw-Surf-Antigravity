import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { toast } from 'sonner';
import { ShieldCheck, Link2, Instagram, Globe, FileText, CheckCircle, Clock } from 'lucide-react';

export const ProOnboarding = () => {
  const navigate = useNavigate();
  const { user, submitProOnboarding } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    portfolio_url: '',
    instagram_url: '',
    website_url: '',
    bio: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.portfolio_url) {
      toast.error('Portfolio URL is required');
      return;
    }

    setLoading(true);

    try {
      await submitProOnboarding(user.id, formData);
      toast.success('Application submitted! We\'ll review within 48 hours.');
      
      // After onboarding, check if user needs to select a subscription
      if (!user.subscription_tier) {
        navigate('/photographer-subscription', { state: { userType: 'verified_pro' } });
      } else {
        navigate('/feed');
      }
    } catch (error) {
      toast.error('Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 py-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 flex items-center justify-center">
            <ShieldCheck className="w-10 h-10 text-black" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'Oswald' }}>
            Approved Pro Application
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Join our elite network of verified surf photographers. Get priority placement, verified badge, and exclusive features.
          </p>
        </div>

        {/* Benefits Card */}
        <Card className="bg-zinc-900 border-zinc-700 mb-8">
          <CardContent className="p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Approved Pro Benefits
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                'Verified badge on profile',
                'Priority in search results',
                'Featured photographer eligibility',
                'Advanced booking tools',
                'Lower platform commission',
                'Direct brand partnerships'
              ].map((benefit, idx) => (
                <div key={idx} className="flex items-center gap-2 text-gray-300 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                  {benefit}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Application Form */}
        <Card className="bg-zinc-900 border-zinc-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-yellow-400" />
              Submit Your Application
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Portfolio URL - Required */}
              <div>
                <Label htmlFor="portfolio_url" className="text-gray-300 flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  Portfolio URL <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="portfolio_url"
                  type="url"
                  value={formData.portfolio_url}
                  onChange={(e) => setFormData({ ...formData, portfolio_url: e.target.value })}
                  placeholder="https://yourportfolio.com"
                  className="bg-zinc-800 border-zinc-700 text-white mt-2"
                  required
                  data-testid="portfolio-url-input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Link to your best surf photography work (SmugMug, 500px, personal site, etc.)
                </p>
              </div>

              {/* Instagram URL - Optional */}
              <div>
                <Label htmlFor="instagram_url" className="text-gray-300 flex items-center gap-2">
                  <Instagram className="w-4 h-4" />
                  Instagram Profile
                </Label>
                <Input
                  id="instagram_url"
                  type="url"
                  value={formData.instagram_url}
                  onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                  placeholder="https://instagram.com/yourhandle"
                  className="bg-zinc-800 border-zinc-700 text-white mt-2"
                  data-testid="instagram-url-input"
                />
              </div>

              {/* Website URL - Optional */}
              <div>
                <Label htmlFor="website_url" className="text-gray-300 flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Personal Website
                </Label>
                <Input
                  id="website_url"
                  type="url"
                  value={formData.website_url}
                  onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                  placeholder="https://yourwebsite.com"
                  className="bg-zinc-800 border-zinc-700 text-white mt-2"
                  data-testid="website-url-input"
                />
              </div>

              {/* Bio */}
              <div>
                <Label htmlFor="bio" className="text-gray-300">
                  Tell us about yourself
                </Label>
                <textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Years of experience, equipment you use, notable clients or publications..."
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-md p-3 mt-2 min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  data-testid="bio-textarea"
                />
              </div>

              {/* Review Time Notice */}
              <div className="bg-zinc-800 rounded-lg p-4 flex items-start gap-3">
                <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium text-sm">48-Hour Review</p>
                  <p className="text-gray-400 text-xs">
                    Our team reviews every application personally. You'll receive an email notification once approved.
                  </p>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] bg-gradient-to-r from-emerald-400 via-yellow-400 to-orange-400 hover:from-emerald-500 hover:via-yellow-500 hover:to-orange-500 text-black font-bold"
                data-testid="submit-application-btn"
              >
                {loading ? 'Submitting...' : 'Submit Application'}
              </Button>

              {/* Skip for now */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate('/feed')}
                  className="text-gray-500 hover:text-gray-300 text-sm underline"
                  data-testid="skip-onboarding"
                >
                  Skip for now (you can complete this later)
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
