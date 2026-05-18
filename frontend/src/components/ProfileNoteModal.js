import React from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

/**
 * Note modal - allows users to create, view, and delete Instagram-style
 * 24-hour ephemeral status notes.
 * Extracted from Profile.js to reduce god-component complexity.
 */
export const ProfileNoteModal = ({
  isOpen,
  onClose,
  isOwnProfile,
  profileName,
  userNote,
  noteText,
  setNoteText,
  noteSubmitting,
  onCreateNote,
  onDeleteNote,
}) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
      <DialogHeader>
        <DialogTitle className="text-xl font-bold text-center">
          {isOwnProfile ? (userNote ? 'Your Note' : 'Share a Note') : `${profileName}'s Note`}
        </DialogTitle>
      </DialogHeader>
      
      <div className="py-4">
        {/* Viewing someone else's note */}
        {!isOwnProfile && userNote && (
          <div className="text-center space-y-4">
            <div className="bg-zinc-800 rounded-2xl p-6">
              <p className="text-lg text-white">{userNote.content}</p>
              <p className="text-sm text-emerald-400 mt-2">{userNote.time_remaining} remaining</p>
            </div>
            <p className="text-xs text-gray-500">
              Notes are shared with mutual followers only
            </p>
          </div>
        )}
        
        {/* Own profile - create/edit note */}
        {isOwnProfile && (
          <div className="space-y-4">
            {userNote ? (
              // Show existing note with option to delete
              <div className="text-center space-y-4">
                <div className="bg-zinc-800 rounded-2xl p-6">
                  <p className="text-lg text-white">{userNote.content}</p>
                  <p className="text-sm text-emerald-400 mt-2">{userNote.time_remaining} remaining</p>
                </div>
                <p className="text-xs text-gray-400">
                  Shared with {userNote.view_count || 0} mutual followers
                </p>
                <Button
                  variant="ghost"
                  onClick={onDeleteNote}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  data-testid="delete-note-btn"
                >
                  Delete Note
                </Button>
              </div>
            ) : (
              // Create new note with emoji support
              <div className="space-y-4">
                <p className="text-sm text-gray-400 text-center">
                  Shared with followers you follow back
                </p>
                <p className="text-xs text-emerald-400 text-center">
                  Notes disappear after 24 hours
                </p>
 <Input aria-label="What's happening? ="
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value.slice(0, 60))}
 placeholder="What's happening? ="
                  className="bg-zinc-800 border-zinc-700 text-white text-lg text-center h-14"
                  maxLength={60}
                  data-testid="note-input"
                />
                {/* Quick Emoji Picker */}
                <div className="flex justify-center flex-wrap gap-2" data-testid="emoji-picker">
 {['=', '=', '=', '=', 'Gn+', '=', '=', '=', '=', '=', '=+', '='].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNoteText(prev => (prev + emoji).slice(0, 60))}
                      className="text-2xl hover:scale-125 transition-transform p-1"
                      data-testid={`emoji-${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{noteText.length}/60</span>
                  <span>Mutual followers only</span>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => onClose(false)}
                    className="flex-1 text-gray-400"
                  >
                    Cancel
                  </Button>
                  <Button aria-label="Loader2"
                    onClick={onCreateNote}
                    disabled={!noteText.trim() || noteSubmitting}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700"
                    data-testid="submit-note-btn"
                  >
                    {noteSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Share'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DialogContent>
  </Dialog>
);
