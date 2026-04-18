import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Trophy, CheckCircle, XCircle, Loader2, ExternalLink,
  Calendar, MapPin, Medal, Eye, Shield, Award
} from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Admin Competition Result Verification
 * Allows admins to verify/reject pending competition results
 */
export const AdminCompetitionVerification = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  
  const [pendingResults, setPendingResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState(null);
  const [showProofModal, setShowProofModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textPrimary = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    fetchPendingResults();
  }, []);

  const fetchPendingResults = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/career/admin/pending-verifications`);
      setPendingResults(res.data?.results || []);
    } catch (error) {
      logger.error('Failed to fetch pending results:', error);
      // If endpoint doesn't exist yet, show empty
      setPendingResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (resultId, approved) => {
    setProcessing(true);
    try {
      const _res = await axios.post(`${API}/career/competition-results/${resultId}/verify`, null, {
        params: {
          approved,
          admin_id: user.id
        }
      });
      
      toast.success(approved ? 'Result verified! XP awarded.' : 'Result rejected.');
      
      // Remove from list
      setPendingResults(prev => prev.filter(r => r.id !== resultId));
      setShowProofModal(false);
      setSelectedResult(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to process verification');
    } finally {
      setProcessing(false);
    }
  };

  const getPlaceBadge = (placing) => {
    if (placing === 1) return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">1st</Badge>;
    if (placing === 2) return <Badge className="bg-gray-300/20 text-gray-300 border-gray-300/30">2nd</Badge>;
    if (placing === 3) return <Badge className="bg-amber-600/20 text-amber-500 border-amber-600/30">3rd</Badge>;
    return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">{placing}th</Badge>;
  };

  const getTierBadge = (tier) => {
    const tiers = {
      'WSL_CT': { color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', label: 'WSL CT' },
      'WSL_QS': { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'WSL QS' },
      'Regional': { color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', label: 'Regional' },
      'Local': { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'Local' },
      'Grom_Series': { color: 'bg-pink-500/20 text-pink-400 border-pink-500/30', label: 'Grom Series' }
    };
    const tierInfo = tiers[tier] || { color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', label: tier || 'N/A' };
    return <Badge className={`${tierInfo.color}`}>{tierInfo.label}</Badge>;
  };

  if (!user?.is_admin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className={textPrimary}>Admin access required</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-competition-verification">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`} style={{ fontFamily: 'Oswald' }}>
            <Trophy className="w-6 h-6 text-yellow-400" />
            Competition Verification
          </h2>
          <p className={`${textSecondary} text-sm`}>Review and verify surfer competition results</p>
        </div>
        <Badge className="bg-yellow-500/20 text-yellow-400 border-0">
          {pendingResults.length} Pending
        </Badge>
      </div>

      {/* Pending Results */}
      {pendingResults.length > 0 ? (
        <div className="space-y-3">
          {pendingResults.map((result) => (
            <Card key={result.id} className={`${cardBg} hover:border-yellow-500/50 transition-colors`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Surfer Info */}
                  <Avatar 
                    className="w-12 h-12 border-2 border-yellow-500/30 cursor-pointer"
                    onClick={() => window.open(`/profile/${result.surfer_id}`, '_blank')}
                  >
                    <AvatarImage src={result.surfer_avatar} />
                    <AvatarFallback className="bg-yellow-500/20 text-yellow-400">
                      {result.surfer_name?.charAt(0) || 'S'}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-medium ${textPrimary}`}>{result.surfer_name}</span>
                      {getPlaceBadge(result.placing)}
                      {getTierBadge(result.event_tier)}
                    </div>
                    
                    <div className={`text-sm ${textSecondary} mb-2`}>
                      {result.event_name}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-gray-400">
                        <Calendar className="w-3 h-3" />
                        {new Date(result.event_date).toLocaleDateString()}
                      </span>
                      {result.event_location && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <MapPin className="w-3 h-3" />
                          {result.event_location}
                        </span>
                      )}
                      {result.heat_wins > 0 && (
                        <span className="flex items-center gap-1 text-cyan-400">
                          <Medal className="w-3 h-3" />
                          {result.heat_wins} heat wins
                        </span>
                      )}
                      {result.avg_wave_score && (
                        <span className="text-emerald-400">
                          Avg: {result.avg_wave_score.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    {result.proof_image_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                        onClick={() => {
                          setSelectedResult(result);
                          setShowProofModal(true);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        Proof
                      </Button>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-500 hover:bg-emerald-400 text-white"
                        onClick={() => handleVerify(result.id, true)}
                        disabled={processing}
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                        onClick={() => handleVerify(result.id, false)}
                        disabled={processing}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className={cardBg}>
          <CardContent className="py-12 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className={`${textPrimary} font-medium`}>All caught up!</p>
            <p className={`${textSecondary} text-sm`}>No pending competition results to verify</p>
          </CardContent>
        </Card>
      )}

      {/* Proof Modal */}
      <Dialog open={showProofModal} onOpenChange={setShowProofModal}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              Verify: {selectedResult?.event_name}
            </DialogTitle>
          </DialogHeader>
          
          {selectedResult && (
            <div className="space-y-4">
              {/* Result Summary */}
              <div className="p-3 bg-zinc-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Surfer</span>
                  <span className="font-medium">{selectedResult.surfer_name}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Place</span>
                  {getPlaceBadge(selectedResult.placing)}
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Date</span>
                  <span>{new Date(selectedResult.event_date).toLocaleDateString()}</span>
                </div>
                {selectedResult.heat_wins > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Heat Wins</span>
                    <span className="text-cyan-400">{selectedResult.heat_wins}</span>
                  </div>
                )}
              </div>
              
              {/* Proof Image */}
              {selectedResult.proof_image_url && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-400">Proof Image:</div>
                  <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                    <img 
                      src={selectedResult.proof_image_url} 
                      alt="Competition proof" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <a 
                    href={selectedResult.proof_image_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Open full size
                  </a>
                </div>
              )}
              
              {/* XP Preview */}
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-yellow-400" />
                  <span className="text-yellow-400 font-medium">XP to Award</span>
                </div>
                <p className="text-sm text-gray-400">
                  If verified, surfer will receive XP based on placing ({selectedResult.placing}), 
                  heat wins ({selectedResult.heat_wins || 0}), and event tier ({selectedResult.event_tier || 'Local'}).
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowProofModal(false)}
              className="border-zinc-700"
            >
              Cancel
            </Button>
            <Button 
              variant="outline"
              className="border-red-500/50 text-red-400 hover:bg-red-500/10"
              onClick={() => handleVerify(selectedResult?.id, false)}
              disabled={processing}
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
              Reject
            </Button>
            <Button 
              className="bg-emerald-500 hover:bg-emerald-400 text-white"
              onClick={() => handleVerify(selectedResult?.id, true)}
              disabled={processing}
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Verify & Award XP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminCompetitionVerification;
