/**
 * useExploreConditions.js - Extracted from Explore.js
 * Conditions, location hierarchy, surf spots, and archive data fetching.
 * 431 lines extracted.
 */
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

const useExploreConditions = ({
  user,
  locationHierarchy, userLocation, nearbyRadius,
  conditionsSubTab,
  selectedRegion,
  conditionsCountry,
  conditionsState,
  conditionsCity,
  selectedSpotsRegion,
  selectedCountry,
  selectedState,
  selectedCity,
  discoveryMode,
  archiveDate,
  // State setters
  setConditionReports, setConditionsLoading,
  setArchiveDates, setArchiveDate,
  setArchiveGalleries, setArchiveGalleriesLoading,
  setConditionsSubTab, setConditionsLocMode,
  setConditionsRegions, setShowRegionDropdown,
  setConditionsCountry, setConditionsState, setConditionsCity,
  setSurfSpots, setSurfSpotsLoading, setSurfSpotsRegions,
  setSelectedSpotsRegion, setShowSpotsRegionDropdown,
  setLocationHierarchy, setLocationHierarchyLoading,
  setNearbySpots, setNearbyLoading, setUserLocation,
  setSelectedRegion, setSelectedCountry, setSelectedState, setSelectedCity,
  setDiscoveryMode,
}) => {

  const fetchConditionReports = async (region = selectedRegion, locationOverride = null, dateFilter = conditionsSubTab, dateOverride = null, locOverride = null) => {
    setConditionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (region && region !== 'All') {
        params.append('region', region);
      }
      params.append('limit', '30');
      params.append('date_filter', dateFilter === 'archives' ? 'archive' : dateFilter);
      
      // For archive mode, pass the specific date
      const targetDate = dateOverride || archiveDate;
      if (dateFilter === 'archives' && targetDate) {
        params.append('archive_date', targetDate);
      }
      
      // Add user location for nearby sorting if available
      const location = locationOverride || userLocation;
      if (location) {
        params.append('user_lat', location.lat);
        params.append('user_lng', location.lng);
      }
      
      // Hierarchical location params
      const loc = locOverride || { country: conditionsCountry, state: conditionsState, city: conditionsCity };
      if (loc.country) params.append('country', loc.country);
      if (loc.state) params.append('state_province', loc.state);
      if (loc.city) params.append('city', loc.city);
      
      const response = await apiClient.get(`/condition-reports/feed?${params}`);
      setConditionReports(response.data.reports || []);
    } catch (error) {
      logger.error('Error fetching condition reports:', error);
      setConditionReports([]);
    } finally {
      setConditionsLoading(false);
    }
  };

  // Fetch archive dates for the date picker (with location filtering)
  const fetchArchiveDates = async (locOverride = null) => {
    try {
      const params = new URLSearchParams();
      params.append('limit', '30');
      const loc = locOverride || { country: conditionsCountry, state: conditionsState, city: conditionsCity };
      if (loc.country) params.append('country', loc.country);
      if (loc.state) params.append('state_province', loc.state);
      if (loc.city) params.append('city', loc.city);
      const response = await apiClient.get(`/condition-reports/archive-dates?${params}`);
      setArchiveDates(response.data.dates || []);
    } catch (error) {
      logger.error('Error fetching archive dates:', error);
      setArchiveDates([]);
    }
  };

  // Fetch public galleries for archive browsing (with location filtering)
  const fetchArchiveGalleries = async (date = null, locOverride = null) => {
    setArchiveGalleriesLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) params.append('date', date);
      params.append('limit', '20');
      const loc = locOverride || { country: conditionsCountry, state: conditionsState, city: conditionsCity };
      if (loc.country) params.append('country', loc.country);
      if (loc.state) params.append('state_province', loc.state);
      if (loc.city) params.append('city', loc.city);
      const response = await apiClient.get(`/condition-reports/public-galleries?${params}`);
      setArchiveGalleries(response.data.galleries || []);
    } catch (error) {
      logger.error('Error fetching archive galleries:', error);
      setArchiveGalleries([]);
    } finally {
      setArchiveGalleriesLoading(false);
    }
  };

  // Handle conditions sub-tab change (preserves location state across tabs)
  const handleConditionsSubTabChange = (subTab) => {
    setConditionsSubTab(subTab);
    const loc = { country: conditionsCountry, state: conditionsState, city: conditionsCity };
    if (subTab === 'today' || subTab === 'yesterday') {
      fetchConditionReports(selectedRegion, null, subTab, null, loc);
    } else if (subTab === 'archives') {
      fetchArchiveDates(loc);
      if (archiveDate) {
        fetchConditionReports(selectedRegion, null, 'archives', archiveDate, loc);
        fetchArchiveGalleries(archiveDate, loc);
      }
    }
  };

  // Handle archive date selection
  const handleArchiveDateSelect = (date) => {
    setArchiveDate(date);
    const loc = { country: conditionsCountry, state: conditionsState, city: conditionsCity };
    fetchConditionReports(selectedRegion, null, 'archives', date, loc);
    fetchArchiveGalleries(date, loc);
  };

  // Fetch available regions for filter
  const fetchConditionsRegions = async () => {
    try {
      const response = await apiClient.get(`/condition-reports/regions`);
      setConditionsRegions(['All', ...(response.data.regions || [])]);
    } catch (error) {
      logger.error('Error fetching regions:', error);
      setConditionsRegions(['All', 'North Shore', 'East Coast', 'West Coast', 'Gold Coast', 'SoCal']);
    }
  };

  // Handle region filter change
  const handleRegionChange = (region) => {
    setSelectedRegion(region);
    setShowRegionDropdown(false);
    fetchConditionReports(region);
  };
  
  // Get user location for nearby reports
  const getReportsNearby = () => {
    if (navigator.geolocation) {
      setConditionsLoading(true);
      setConditionsLocMode('nearby');
      // Clear hierarchical filters when switching to nearby
      setConditionsCountry('');
      setConditionsState('');
      setConditionsCity('');
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          fetchConditionReports('All', newLocation, conditionsSubTab, null, { country: '', state: '', city: '' });
          toast.success('=ƒτμ Showing nearby reports first');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setConditionsLoading(false);
          setConditionsLocMode('browse');
          toast.error('Could not get your location');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
    }
  };
  
  // ============ CONDITIONS LOCATION HIERARCHY ============
  
  // Computed dropdown options from the shared location hierarchy
  const conditionsCountryOptions = locationHierarchy?.countries?.map(c => c.name).sort() || [];
  
  const conditionsStateOptions = (() => {
    if (!conditionsCountry || !locationHierarchy) return [];
    const country = locationHierarchy.countries.find(c => c.name === conditionsCountry);
    if (!country?.states) return [];
    return country.states.filter(s => !s.is_virtual).map(s => s.name).sort();
  })();
  
  const conditionsCityOptions = (() => {
    if (!conditionsCountry || !conditionsState || !locationHierarchy) return [];
    const country = locationHierarchy.countries.find(c => c.name === conditionsCountry);
    const state = country?.states?.find(s => s.name === conditionsState);
    if (!state?.cities) return [];
    return state.cities.map(c => c.name).sort();
  })();
  
  // Cascading location change handlers for conditions
  const handleConditionsCountryChange = (countryName) => {
    setConditionsCountry(countryName);
    setConditionsState('');
    setConditionsCity('');
    setConditionsLocMode('browse');
    setUserLocation(null); // Clear GPS when switching to browse
    const loc = { country: countryName, state: '', city: '' };
    fetchConditionReports('All', null, conditionsSubTab, conditionsSubTab === 'archives' ? archiveDate : null, loc);
    if (conditionsSubTab === 'archives') {
      fetchArchiveDates(loc);
      if (archiveDate) fetchArchiveGalleries(archiveDate, loc);
    }
  };
  
  const handleConditionsStateChange = (stateName) => {
    setConditionsState(stateName);
    setConditionsCity('');
    const loc = { country: conditionsCountry, state: stateName, city: '' };
    fetchConditionReports('All', null, conditionsSubTab, conditionsSubTab === 'archives' ? archiveDate : null, loc);
    if (conditionsSubTab === 'archives') {
      fetchArchiveDates(loc);
      if (archiveDate) fetchArchiveGalleries(archiveDate, loc);
    }
  };
  
  const handleConditionsCityChange = (cityName) => {
    setConditionsCity(cityName);
    const loc = { country: conditionsCountry, state: conditionsState, city: cityName };
    fetchConditionReports('All', null, conditionsSubTab, conditionsSubTab === 'archives' ? archiveDate : null, loc);
    if (conditionsSubTab === 'archives') {
      fetchArchiveDates(loc);
      if (archiveDate) fetchArchiveGalleries(archiveDate, loc);
    }
  };
  
  const clearConditionsLocation = () => {
    setConditionsCountry('');
    setConditionsState('');
    setConditionsCity('');
    setConditionsLocMode('browse');
    setUserLocation(null);
    const loc = { country: '', state: '', city: '' };
    fetchConditionReports('All', null, conditionsSubTab, conditionsSubTab === 'archives' ? archiveDate : null, loc);
    if (conditionsSubTab === 'archives') {
      fetchArchiveDates(loc);
      if (archiveDate) fetchArchiveGalleries(archiveDate, loc);
    }
  };
  
  // Quick jump to a popular location for conditions
  const jumpToConditionsLocation = (loc) => {
    setConditionsLocMode('browse');
    setConditionsCountry(loc.country);
    setConditionsState(loc.state || '');
    setConditionsCity('');
    setUserLocation(null);
    const locParams = { country: loc.country, state: loc.state || '', city: '' };
    fetchConditionReports('All', null, conditionsSubTab, conditionsSubTab === 'archives' ? archiveDate : null, locParams);
    if (conditionsSubTab === 'archives') {
      fetchArchiveDates(locParams);
      if (archiveDate) fetchArchiveGalleries(archiveDate, locParams);
    }
  };
  
  // Fetch surf spots with forecasts and conditions
  // Supports filtering by region, country, and/or state_province for hierarchy browsing
  const fetchSurfSpots = async (region = selectedSpotsRegion, locationOverride = null, { country, state_province } = {}) => {
    setSurfSpotsLoading(true);
    try {
      const params = new URLSearchParams();
      if (country && country !== 'All') {
        params.append('country', country);
      }
      if (state_province && state_province !== 'All') {
        params.append('state_province', state_province);
      }
      if (region && region !== 'All') {
        params.append('region', region);
      }
      params.append('limit', '30');
      params.append('subscription_tier', user?.subscription_tier || 'free');
      
      // Add user location if available (use override if provided, otherwise use state)
      const location = locationOverride || userLocation;
      if (location) {
        params.append('user_lat', location.lat);
        params.append('user_lng', location.lng);
      }
      
      const response = await apiClient.get(`/explore/surf-spots?${params}`);
      setSurfSpots(response.data.spots || []);
      setSurfSpotsRegions(['All', ...(response.data.regions || [])]);
    } catch (error) {
      logger.error('Error fetching surf spots:', error);
      setSurfSpots([]);
    } finally {
      setSurfSpotsLoading(false);
    }
  };
  
  // Handle spots region filter change
  const handleSpotsRegionChange = (region) => {
    setSelectedSpotsRegion(region);
    setShowSpotsRegionDropdown(false);
    fetchSurfSpots(region);
  };
  
  // Get user location for nearby spots
  const getUserLocation = () => {
    if (navigator.geolocation) {
      // Show loading state immediately
      setSurfSpotsLoading(true);
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          // Pass location directly to avoid race condition with state update
          fetchSurfSpots(selectedSpotsRegion, newLocation);
          toast.success('Location updated! Showing nearby spots first.');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setSurfSpotsLoading(false);
          toast.error('Could not get your location');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
    }
  };
  
  // ============ LOCATION DISCOVERY ============
  
  // Fetch the hierarchical location tree
  const fetchLocationHierarchy = async () => {
    if (locationHierarchy) return; // Already loaded
    setLocationHierarchyLoading(true);
    try {
      const response = await apiClient.get('/surf-spots/locations');
      setLocationHierarchy(response.data);
    } catch (error) {
      logger.error('Error fetching location hierarchy:', error);
    } finally {
      setLocationHierarchyLoading(false);
    }
  };
  
  // Fetch nearby spots using GPS
  const fetchNearbySpots = (lat, lng, radius = nearbyRadius) => {
    setNearbyLoading(true);
    apiClient.get('/explore/surf-spots', {
      params: {
        user_lat: lat,
        user_lng: lng,
        limit: 30,
        subscription_tier: user?.subscription_tier || 'free'
      }
    }).then(response => {
      setNearbySpots(response.data.spots || []);
    }).catch(error => {
      logger.error('Error fetching nearby spots:', error);
      setNearbySpots([]);
    }).finally(() => {
      setNearbyLoading(false);
    });
  };
  
  // Activate GPS nearby mode
  const activateNearbyMode = () => {
    setDiscoveryMode('nearby');
    if (userLocation) {
      fetchNearbySpots(userLocation.lat, userLocation.lng);
      return;
    }
    if (navigator.geolocation) {
      setNearbyLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
          fetchNearbySpots(loc.lat, loc.lng);
          toast.success('Found your location!');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setNearbyLoading(false);
          toast.error('Could not get your location. Please enable location services.');
          setDiscoveryMode('browse');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
      setDiscoveryMode('browse');
    }
  };
  
  // ============ DROPDOWN LOCATION DISCOVERY ============
  
  // Computed dropdown options from hierarchy
  const countryOptions = locationHierarchy?.countries?.map(c => c.name).sort() || [];
  
  const stateOptions = (() => {
    if (!selectedCountry || !locationHierarchy) return [];
    const country = locationHierarchy.countries.find(c => c.name === selectedCountry);
    if (!country?.states) return [];
    return country.states.filter(s => !s.is_virtual).map(s => s.name).sort();
  })();
  
  const cityOptions = (() => {
    if (!selectedCountry || !selectedState || !locationHierarchy) return [];
    const country = locationHierarchy.countries.find(c => c.name === selectedCountry);
    const state = country?.states?.find(s => s.name === selectedState);
    if (!state?.cities) return [];
    return state.cities.map(c => c.name).sort();
  })();
  
  // Handle dropdown changes with cascading reset
  const handleCountryChange = (countryName) => {
    setSelectedCountry(countryName);
    setSelectedState('');
    setSelectedCity('');
    setSurfSpots([]);
    if (countryName) {
      const country = locationHierarchy?.countries?.find(c => c.name === countryName);
      const realStates = country?.states?.filter(s => !s.is_virtual) || [];
      if (realStates.length === 0) {
        fetchSurfSpots(null, null, { country: countryName });
      }
    }
  };
  
  const handleStateChange = (stateName) => {
    setSelectedState(stateName);
    setSelectedCity('');
    setSurfSpots([]);
    if (stateName) {
      const country = locationHierarchy?.countries?.find(c => c.name === selectedCountry);
      const state = country?.states?.find(s => s.name === stateName);
      const cities = state?.cities || [];
      if (cities.length === 0) {
        fetchSurfSpots(null, null, { country: selectedCountry, state_province: stateName });
      }
    }
  };
  
  const handleCityChange = (cityName) => {
    setSelectedCity(cityName);
    if (cityName) {
      fetchSurfSpots(cityName, null, { country: selectedCountry, state_province: selectedState });
    } else {
      setSurfSpots([]);
    }
  };

  return {
    fetchConditionReports,
    fetchArchiveDates,
    fetchArchiveGalleries,
    handleConditionsSubTabChange,
    handleArchiveDateSelect,
    fetchConditionsRegions,
    handleRegionChange,
    handleConditionsCountryChange,
    handleConditionsStateChange,
    handleConditionsCityChange,
    fetchSurfSpots,
    handleSpotsRegionChange,
    fetchLocationHierarchy,
    fetchNearbySpots,
    handleCountryChange,
    handleStateChange,
    handleCityChange,
    // Functions used by Explore JSX
    activateNearbyMode,
    clearConditionsLocation,
    jumpToConditionsLocation,
    getReportsNearby,
    conditionsCityOptions,
    conditionsStateOptions,
    conditionsCountryOptions,
    cityOptions,
    stateOptions,
    countryOptions,
  };
};

export default useExploreConditions;
