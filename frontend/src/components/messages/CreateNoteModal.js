/**
 * CreateNoteModal GÇö Modal for creating Instagram-style notes in Messages.
 * Includes emoji picker, character limit, and mutual-followers notice.
 * Extracted from MessagesPage.js for maintainability.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from 'sonner';

const SURF_EMOJIS = ['=ƒñÖ', '=ƒîè', '=ƒÅä', '=ƒöÑ', '=ƒÆ»', '=ƒÿÄ', '=ƒîà', '=ƒÉÜ', '=ƒªê', 'GÿÇn+Å', '=ƒî¦', 'G£¿'];

const CreateNoteModal = ({ isOpen, onClose, onSubmit }) => {
  const [noteText, setNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!noteText.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(noteText.trim());
      setNoteText('');
      onClose();
    } catch (error) {
      toast.error('Failed to create note');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const addEmoji = (emoji) => {
    setNoteText(prev => (prev + emoji).slice(0, 60));
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-foreground mb-2 text-center">Share a note</h3>
        <p className="text-sm text-muted-foreground mb-1 text-center">Shared with followers you follow back</p>
        <p className="text-xs text-emerald-500 dark:text-emerald-400 mb-4 text-center">Notes disappear after 24 hours</p>
        
        <form onSubmit={handleSubmit}>
          <Input aria-label="What's on your mind? =ƒñÖ"
            ref={inputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value.slice(0, 60))}
            placeholder="What's on your mind? =ƒñÖ"
            className="bg-muted border-border text-foreground text-lg text-center h-14 mb-2"
            maxLength={60}
            data-testid="note-input"
          />
          
          {/* Emoji Picker */}
          <div className="flex justify-center flex-wrap gap-2 mb-3" data-testid="note-emoji-picker">
            {SURF_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => addEmoji(emoji)}
                className="text-xl hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
          
          <div className="flex justify-between text-xs text-muted-foreground mb-4">
            <span>{noteText.length}/60</span>
            <span>Mutual followers only</span>
          </div>
          
          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1 text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!noteText.trim() || isSubmitting}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
              data-testid="submit-note-btn"
            >
              {isSubmitting ? 'Sharing...' : 'Share'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateNoteModal;
