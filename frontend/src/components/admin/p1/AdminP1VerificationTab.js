import React from 'react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Badge } from '../../ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar';
import { UserCheck, Camera, Award, RefreshCw, Globe, Instagram, ChevronRight } from 'lucide-react';
import { getFullUrl } from '../../../utils/media';
import { StatusBadge } from './AdminP1Modals';

const AdminP1VerificationTab = ({
  verificationQueue,
  verificationFilter,
  setVerificationFilter,
  fetchVerificationQueue,
  setSelectedVerification,
  setShowVerificationDetail,
  formatDate,
  cardBgClass,
  textClass,
  textSecondary
}) => {
  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2">
        <Select value={verificationFilter.type} onValueChange={(v) => setVerificationFilter({ type: v })}>
          <SelectTrigger className="w-48 bg-muted border-border">
            <SelectValue placeholder="Verification Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pro_surfer">Pro Surfer (WSL)</SelectItem>
            <SelectItem value="approved_pro_photographer">Approved Pro Photographer</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchVerificationQueue} aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Verification List */}
      {verificationQueue.length === 0 ? (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <UserCheck className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className={textSecondary}>No pending verification requests</p>
          </CardContent>
        </Card>
      ) : (
        verificationQueue.map(req => (
          <Card 
            key={req.id} 
            className={`${cardBgClass} cursor-pointer hover:border-purple-500/50 transition-colors`}
            onClick={() => { setSelectedVerification(req); setShowVerificationDetail(true); }}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={getFullUrl(req.user?.avatar_url)} />
                  <AvatarFallback>{req.user?.full_name?.[0]}</AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`font-medium ${textClass}`}>{req.user?.full_name}</p>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className={`text-sm ${textSecondary}`}>{req.user?.email}</p>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className={`text-xs ${
                      req.verification_type === 'pro_surfer' 
                        ? 'border-cyan-500 text-cyan-400' 
                        : 'border-purple-500 text-purple-400'
                    }`}>
                      {req.verification_type === 'pro_surfer' ? (
                        <><Award className="w-3 h-3 mr-1" /> Pro Surfer (WSL)</>
                      ) : (
                        <><Camera className="w-3 h-3 mr-1" /> Approved Pro Photographer</>
                      )}
                    </Badge>
                  </div>
                  
                  {/* Quick preview of verification data */}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {req.wsl_profile_url && (
                      <a 
                        href={req.wsl_profile_url} 
                        target="_blank" rel="noopener noreferrer" 
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-cyan-400 hover:underline"
                      >
                        <Globe className="w-3 h-3" /> WSL Profile
                      </a>
                    )}
                    {req.instagram_url && (
                      <a 
                        href={req.instagram_url} 
                        target="_blank" rel="noopener noreferrer" 
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-pink-400 hover:underline"
                      >
                        <Instagram className="w-3 h-3" /> Instagram
                      </a>
                    )}
                    {req.portfolio_website && (
                      <a 
                        href={req.portfolio_website} 
                        target="_blank" rel="noopener noreferrer" 
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-blue-400 hover:underline"
                      >
                        <Globe className="w-3 h-3" /> Portfolio
                      </a>
                    )}
                  </div>
                </div>
                
                <div className="text-right shrink-0">
                  <p className={`text-xs ${textSecondary}`}>{formatDate(req.created_at)}</p>
                  <ChevronRight className="w-5 h-5 text-gray-500 mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export default AdminP1VerificationTab;
