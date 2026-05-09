/**
 * SurfboardsTab - Display and manage user's surfboard quiver
 * Features:
 * - Grid display of surfboards with photos
 * - Add/Edit surfboard modal
 * - Photo upload (up to 5 per board)
 * - Dimensions, brand, condition tracking
 * - Future: Marketplace listing integration
 */

import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import { Plus, Loader2, Waves } from 'lucide-react';
import { Button } from './ui/button';
import logger from '../utils/logger';

// Extracted Components
import { SurfboardCard } from './surfboards/SurfboardCard';
import { SurfboardModal } from './surfboards/SurfboardModal';
import { SurfboardDetailModal } from './surfboards/SurfboardDetailModal';

// Main SurfboardsTab Component
export const SurfboardsTab = ({ userId, isOwnProfile }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [editingBoard, setEditingBoard] = useState(null);
  
  const fetchBoards = async () => {
    try {
      const response = await apiClient.get(`/surfboards/user/${userId}`);
      setBoards(response.data.boards || []);
    } catch (error) {
      logger.error('Error fetching surfboards:', error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (userId) {
      fetchBoards();
    }
  }, [userId]);
  
  const handleBoardClick = (board) => {
    setSelectedBoard(board);
    setShowDetailModal(true);
  };
  
  const handleEdit = (board) => {
    setEditingBoard(board);
    setShowAddModal(true);
  };
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }
  
  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`font-bold ${textPrimary}`}>
            {isOwnProfile ? 'My Quiver' : 'Quiver'}
          </h3>
          <p className={`text-sm ${textSecondary}`}>
            {boards.length} board{boards.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isOwnProfile && (
          <Button aria-label="Add"
            onClick={() => {
              setEditingBoard(null);
              setShowAddModal(true);
            }}
            size="sm"
            className="bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Board
          </Button>
        )}
      </div>
      
      {/* Grid */}
      {boards.length === 0 ? (
        <div className="text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
            <Waves className={`w-8 h-8 ${isLight ? 'text-gray-400' : 'text-gray-500'}`} />
          </div>
          <h4 className={`font-semibold ${textPrimary} mb-1`}>No Boards Yet</h4>
          <p className={`text-sm ${textSecondary} mb-4`}>
            {isOwnProfile 
              ? 'Add your surfboards to build your quiver' 
              : 'No surfboards in this quiver yet'}
          </p>
          {isOwnProfile && (
            <Button aria-label="Add"
              onClick={() => {
                setEditingBoard(null);
                setShowAddModal(true);
              }}
              className="bg-gradient-to-r from-cyan-500 to-blue-600"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Board
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {boards.map((board) => (
            <SurfboardCard
              key={board.id}
              board={board}
              onClick={() => handleBoardClick(board)}
              isLight={isLight}
            />
          ))}
          {/* Add board placeholder */}
          {isOwnProfile && (
            <div
              onClick={() => {
                setEditingBoard(null);
                setShowAddModal(true);
              }}
              className={`aspect-[3/4] rounded-xl border-2 border-dashed ${
                isLight ? 'border-gray-300 hover:border-cyan-400' : 'border-zinc-700 hover:border-cyan-500'
              } flex flex-col items-center justify-center cursor-pointer transition-colors`}
            >
              <Plus className={`w-8 h-8 ${isLight ? 'text-gray-400' : 'text-zinc-500'} mb-2`} />
              <span className={`text-sm ${textSecondary}`}>Add Board</span>
            </div>
          )}
        </div>
      )}
      
      {/* Modals */}
      <SurfboardModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingBoard(null);
        }}
        board={editingBoard}
        onSave={fetchBoards}
        userId={userId}
      />
      
      <SurfboardDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedBoard(null);
        }}
        board={selectedBoard}
        onEdit={handleEdit}
        onDelete={fetchBoards}
        isOwnProfile={isOwnProfile}
        userId={userId}
      />
    </div>
  );
};

export default SurfboardsTab;
