import React from 'react';
import { X, GripVertical, Move } from 'lucide-react';

export const DayCell = ({ date, isCurrentMonth, isToday, bookings, blockedDates, availabilityWindows,
  onClick, isLight, isDragEnabled, onDragStart, onDragEnd, onDrop, draggedBooking, isDropTarget
}) => {
  const dayNum = date.getDate();
  const dateStr = date.toISOString().split('T')[0];
  const dayBookings = bookings.filter(b => b.date === dateStr);
  const isBlocked = blockedDates.includes(dateStr);
  const hasAvailability = availabilityWindows.some(w => w.day === date.getDay() && w.enabled);
  
  const isValidDropTarget = isDragEnabled && draggedBooking && !isBlocked && hasAvailability;
  const isActiveDropTarget = isValidDropTarget && isDropTarget;
  
  const bgClass = isLight 
    ? (isToday ? 'bg-yellow-100' : isCurrentMonth ? 'bg-white' : 'bg-gray-50')
    : (isToday ? 'bg-yellow-500/20' : isCurrentMonth ? 'bg-zinc-800' : 'bg-zinc-900');
  
  const textClass = isLight
    ? (isCurrentMonth ? 'text-gray-900' : 'text-gray-400')
    : (isCurrentMonth ? 'text-white' : 'text-gray-600');
  
  const handleDragOver = (e) => { if (isValidDropTarget) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };
  const handleDrop = (e) => { e.preventDefault(); if (onDrop && isValidDropTarget) onDrop(date); };
  
  return (
    <div
      onClick={() => onClick(date)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`min-h-[80px] p-1 border ${isLight ? 'border-gray-200' : 'border-zinc-700'} ${bgClass} 
        hover:border-yellow-400 transition-all relative cursor-pointer
        ${isActiveDropTarget ? 'ring-2 ring-cyan-400 bg-cyan-500/10' : ''}
        ${isBlocked ? 'opacity-50' : ''}`}
    >
      <div className={`text-sm font-medium ${textClass} ${isToday ? 'text-yellow-500' : ''}`}>
        {dayNum}
      </div>
      
      {isBlocked && (
        <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center pointer-events-none">
          <X className="w-6 h-6 text-red-400" />
        </div>
      )}
      
      {!isBlocked && hasAvailability && (
        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400" />
      )}
      
      {isValidDropTarget && draggedBooking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Move className="w-4 h-4 text-cyan-400 opacity-50" />
        </div>
      )}
      
      <div className="mt-1 space-y-1">
        {dayBookings.slice(0, 2).map((booking, idx) => (
          <div 
            key={booking.id || idx}
            draggable={isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending')}
            onDragStart={(e) => {
              if (isDragEnabled) {
                e.stopPropagation();
                onDragStart(booking, e);
              }
            }}
            onDragEnd={(e) => {
              if (isDragEnabled) {
                e.stopPropagation();
                onDragEnd();
              }
            }}
            className={`text-xs px-1 py-0.5 rounded truncate flex items-center gap-1 ${
              booking.status === 'Confirmed' 
                ? 'bg-green-500/20 text-green-400'
                : booking.status === 'Pending'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-gray-500/20 text-gray-400'
            } ${isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending') ? 'cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-yellow-400' : ''}`}
            data-testid={`booking-block-${booking.id}`}
          >
            {isDragEnabled && (booking.status === 'Confirmed' || booking.status === 'Pending') && (
              <GripVertical className="w-3 h-3 flex-shrink-0 opacity-50" />
            )}
            <span className="truncate">{booking.time} - {booking.surfer_name?.split(' ')[0] || 'Booking'}</span>
          </div>
        ))}
        {dayBookings.length > 2 && (
          <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            +{dayBookings.length - 2} more
          </div>
        )}
      </div>
    </div>
  );
};
