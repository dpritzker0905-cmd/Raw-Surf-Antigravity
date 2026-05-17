import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

export const useOnDemandCrew = (user, baseSessionPrice, perSurferFee, step) => {
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [crewMembers, setCrewMembers] = useState([]);
  const [newCrewInput, setNewCrewInput] = useState('');
  const [showAddCrewInput, setShowAddCrewInput] = useState(false);
  const [recentBuddies, setRecentBuddies] = useState([]);
  const [following, setFollowing] = useState([]);
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [searchingFriends, setSearchingFriends] = useState(false);

  const loadCrewSuggestions = async () => {
    if (!user?.id) return;
    try {
      const [buddiesRes, followingRes] = await Promise.all([
        apiClient.get(`/users/${user.id}/recent-buddies?limit=10`).catch(() => ({ data: { buddies: [] } })),
        apiClient.get(`/users/${user.id}/following?limit=20`).catch(() => ({ data: { following: [] } }))
      ]);
      setRecentBuddies(buddiesRes.data.buddies || []);
      setFollowing(followingRes.data.following || []);
    } catch (e) { /* silent */ }
  };

  useEffect(() => {
    if (step === 'crew') loadCrewSuggestions();
  }, [step, user?.id]);

  useEffect(() => {
    if (newCrewInput.length < 2) {
      setFriendSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearchingFriends(true);
      try {
        const response = await apiClient.get(`/users/search?query=${encodeURIComponent(newCrewInput)}&limit=8`);
        const existingIds = new Set([user?.id, ...crewMembers.map(m => m.user_id || m.id)]);
        const filtered = (response.data.users || []).filter(u => !existingIds.has(u.id));
        setFriendSearchResults(filtered);
      } catch (error) {
        logger.error('Friend search error:', error);
        setFriendSearchResults([]);
      } finally {
        setSearchingFriends(false);
      }
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [newCrewInput, user?.id, crewMembers]);

  const totalPrice = baseSessionPrice + (perSurferFee * crewMembers.length);
  const totalParticipants = crewMembers.length + 1;
  const perPersonSplit = (totalPrice / totalParticipants).toFixed(2);
  
  const crewCoversAmount = crewMembers.reduce((sum, m) => sum + (m.covered_by_captain ? 0 : (m.share_amount ?? parseFloat(perPersonSplit))), 0);
  const captainPayAmount = Math.max(0, totalPrice - crewCoversAmount);

  const handleAddCrewMember = () => {
    if (!newCrewInput.trim()) return;
    const isEmail = newCrewInput.includes('@') && !newCrewInput.startsWith('@');
    const newTotalParticipants = crewMembers.length + 2;
    const equalShare = totalPrice / newTotalParticipants;
    const member = {
      id: Date.now(),
      value: newCrewInput.trim(),
      type: isEmail ? 'email' : 'username',
      status: 'pending',
      share_amount: equalShare,
      share_percentage: 100 / newTotalParticipants,
      covered_by_captain: false
    };
    const updatedCrew = crewMembers.map(m => ({
      ...m,
      share_amount: m.covered_by_captain ? 0 : equalShare,
      share_percentage: 100 / newTotalParticipants
    }));
    setCrewMembers([...updatedCrew, member]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${member.value} to crew`);
  };

  const handleSelectFriend = (friend) => {
    const newTotalParticipants = crewMembers.length + 2;
    const equalShare = totalPrice / newTotalParticipants;
    const member = {
      id: friend.id,
      value: friend.username ? `@${friend.username}` : friend.full_name,
      name: friend.full_name,
      username: friend.username,
      avatar_url: friend.avatar_url,
      type: 'user',
      status: 'pending',
      share_amount: equalShare,
      share_percentage: 100 / newTotalParticipants,
      covered_by_captain: false
    };
    const updatedCrew = crewMembers.map(m => ({
      ...m,
      share_amount: m.covered_by_captain ? 0 : equalShare,
      share_percentage: 100 / newTotalParticipants
    }));
    setCrewMembers([...updatedCrew, member]);
    setNewCrewInput('');
    setFriendSearchResults([]);
    setShowAddCrewInput(false);
    toast.success(`Added ${friend.full_name} to crew`);
  };

  const handleRemoveCrewMember = (memberId) => {
    const filtered = crewMembers.filter(m => m.id !== memberId);
    if (filtered.length > 0) {
      const newTotalParticipants = filtered.length + 1;
      const newEqualShare = totalPrice / newTotalParticipants;
      const updatedCrew = filtered.map(m => ({
        ...m,
        share_amount: m.covered_by_captain ? 0 : newEqualShare,
        share_percentage: 100 / newTotalParticipants
      }));
      setCrewMembers(updatedCrew);
    } else {
      setCrewMembers([]);
    }
  };

  const handleCrewPercentageChange = (memberId, requestedPercentage) => {
    setCrewMembers(prev => {
      const otherMembersTotal = prev.reduce((sum, m) => {
        if (m.id === memberId || m.covered_by_captain) return sum;
        return sum + (m.share_percentage || (100 / totalParticipants));
      }, 0);
      
      const maxAllowed = Math.max(0, 100 - otherMembersTotal);
      const clampedPercentage = Math.min(requestedPercentage, maxAllowed);
      const newAmount = (clampedPercentage / 100) * totalPrice;
      
      return prev.map(m => {
        if (m.id === memberId) {
          return { 
            ...m, 
            share_percentage: clampedPercentage, 
            share_amount: newAmount, 
            covered_by_captain: false 
          };
        }
        return m;
      });
    });
  };

  const handleToggleCoverMember = (memberId) => {
    const equalPercentage = 100 / totalParticipants;
    const equalAmount = (equalPercentage / 100) * totalPrice;
    setCrewMembers(prev => prev.map(m => 
      m.id === memberId 
        ? { 
            ...m, 
            covered_by_captain: !m.covered_by_captain,
            share_amount: !m.covered_by_captain ? 0 : equalAmount,
            share_percentage: !m.covered_by_captain ? 0 : equalPercentage
          }
        : m
    ));
  };

  const handleDistributeEvenly = () => {
    const equalShare = totalPrice / totalParticipants;
    const equalPercentage = 100 / totalParticipants;
    setCrewMembers(prev => prev.map(m => ({
      ...m,
      share_amount: equalShare,
      share_percentage: equalPercentage,
      covered_by_captain: false
    })));
    toast.success('Split evenly among all surfers');
  };

  const handleCoverAllCrew = () => {
    setCrewMembers(prev => prev.map(m => ({
      ...m,
      share_amount: 0,
      covered_by_captain: true
    })));
    toast.success("You're covering the whole crew!");
  };

  return {
    splitEnabled, setSplitEnabled,
    crewMembers, setCrewMembers,
    newCrewInput, setNewCrewInput,
    showAddCrewInput, setShowAddCrewInput,
    recentBuddies, following,
    friendSearchResults, searchingFriends,
    totalPrice, totalParticipants, perPersonSplit,
    crewCoversAmount, captainPayAmount,
    handleAddCrewMember, handleSelectFriend, handleRemoveCrewMember,
    handleCrewPercentageChange, handleToggleCoverMember,
    handleDistributeEvenly, handleCoverAllCrew
  };
};

export default useOnDemandCrew;
