/**
 * DutyStationIcon -- Extracted from DutyStationDrawer.js (v79)
 *
 * TopNav icon button that shows a pulsing ring when a mode (Live or On-Demand)
 * is active, and opens the DutyStationDrawer on click.
 */
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { Radio, Zap } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { ROLES } from '../../constants/roles';
import { MODE_CONFIG, DutyStationDrawer } from '../DutyStationDrawer';

const DutyStationIcon = ({ className }) => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [onDemandActive, setOnDemandActive] = useState(false);
  
  const effectiveRole = getEffectiveRole(user?.role);
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  
  // Close drawer when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);
  
  useEffect(() => {
    if (user?.id) {
      fetchActiveStatus();
    }
  }, [user?.id]);
  
  const fetchActiveStatus = async () => {
    try {
      const liveResponse = await apiClient.get(`/photographer/${user.id}/status`);
      setLiveActive(liveResponse.data?.is_shooting || false);
      
      if (!isHobbyist) {
        const onDemandResponse = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
        setOnDemandActive(onDemandResponse.data?.is_available || false);
      }
    } catch (error) {
      logger.error('Failed to fetch active status');
    }
  };
  
  const isActive = liveActive || onDemandActive;
  const activeMode = liveActive ? 'live' : onDemandActive ? 'onDemand' : null;
  const config = activeMode ? MODE_CONFIG[activeMode] : MODE_CONFIG.live;
  const Icon = liveActive ? Radio : Zap;
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`relative p-1 transition-colors ${isActive ? config.colors.text : 'text-zinc-400 hover:text-white'} ${className}`}
        data-testid="topnav-duty-station"
        aria-label="Duty Station"
      >
        {isActive && (
          <span 
            className={`absolute inset-0 rounded-full ${config.colors.ring} animate-ping animate-duration-2s`}
          />
        )}
        <Icon className="w-5 h-5 relative z-10" />
      </button>
      
      <DutyStationDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};

export default DutyStationIcon;
