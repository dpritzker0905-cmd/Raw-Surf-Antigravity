-- ============================================
-- RAW SURF OS: MESSENGER RLS POLICIES & SCHEMA
-- ============================================
-- Run this in Supabase SQL Editor to enable messaging

-- ============================================
-- 1. ADD NEW COLUMNS TO MESSAGES TABLE
-- ============================================

-- Rich Media Support
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url VARCHAR(500);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_thumbnail_url VARCHAR(500);

-- Threaded Replies
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id VARCHAR(36) REFERENCES messages(id) ON DELETE SET NULL;

-- Voice Note Metadata
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration_seconds INTEGER;

-- ============================================
-- 2. RLS POLICIES FOR CONVERSATIONS TABLE
-- ============================================

-- Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Allow users to SELECT conversations they participate in
CREATE POLICY IF NOT EXISTS "Users can view their conversations"
ON conversations FOR SELECT
USING (
  participant_one_id = auth.uid()::text
  OR participant_two_id = auth.uid()::text
);

-- Allow users to INSERT new conversations
CREATE POLICY IF NOT EXISTS "Users can create conversations"
ON conversations FOR INSERT
WITH CHECK (
  participant_one_id = auth.uid()::text
);

-- Allow users to UPDATE conversations they participate in
CREATE POLICY IF NOT EXISTS "Users can update their conversations"
ON conversations FOR UPDATE
USING (
  participant_one_id = auth.uid()::text
  OR participant_two_id = auth.uid()::text
);

-- ============================================
-- 3. RLS POLICIES FOR MESSAGES TABLE
-- ============================================

-- Enable RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow users to SELECT messages in their conversations
CREATE POLICY IF NOT EXISTS "Users can view messages in their conversations"
ON messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
    AND (c.participant_one_id = auth.uid()::text OR c.participant_two_id = auth.uid()::text)
  )
);

-- Allow users to INSERT messages to conversations they participate in
CREATE POLICY IF NOT EXISTS "Users can send messages in their conversations"
ON messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
    AND (c.participant_one_id = auth.uid()::text OR c.participant_two_id = auth.uid()::text)
  )
);

-- Allow users to UPDATE (mark as read) messages in their conversations
CREATE POLICY IF NOT EXISTS "Users can update messages in their conversations"
ON messages FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
    AND (c.participant_one_id = auth.uid()::text OR c.participant_two_id = auth.uid()::text)
  )
);

-- ============================================
-- 4. RLS POLICIES FOR MESSAGE_REACTIONS TABLE
-- ============================================

-- Enable RLS
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Allow users to SELECT reactions on messages they can see
CREATE POLICY IF NOT EXISTS "Users can view reactions in their conversations"
ON message_reactions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE m.id = message_reactions.message_id
    AND (c.participant_one_id = auth.uid()::text OR c.participant_two_id = auth.uid()::text)
  )
);

-- Allow users to INSERT reactions (their own)
CREATE POLICY IF NOT EXISTS "Users can add reactions"
ON message_reactions FOR INSERT
WITH CHECK (
  user_id = auth.uid()::text
);

-- Allow users to DELETE their own reactions
CREATE POLICY IF NOT EXISTS "Users can remove their reactions"
ON message_reactions FOR DELETE
USING (
  user_id = auth.uid()::text
);

-- ============================================
-- 5. RLS POLICIES FOR VOICE_NOTES TABLE (if exists)
-- ============================================

-- Enable RLS (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'voice_notes') THEN
    ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;
    
    EXECUTE 'CREATE POLICY IF NOT EXISTS "Users can view voice notes in their conversations"
    ON voice_notes FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.id = voice_notes.message_id
        AND (c.participant_one_id = auth.uid()::text OR c.participant_two_id = auth.uid()::text)
      )
    )';
  END IF;
END $$;

-- ============================================
-- 6. CREATE INDEXES FOR PERFORMANCE
-- ============================================

-- Index for reply threads
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Index for message type filtering
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);

-- ============================================
-- 7. SUPABASE REALTIME SUBSCRIPTIONS
-- ============================================

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable realtime for conversations (for last_message updates)
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Enable realtime for reactions
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;

-- ============================================
-- NOTES:
-- - Run this SQL in Supabase Dashboard > SQL Editor
-- - Backend uses service key, so RLS is bypassed for API calls
-- - These policies enable direct Supabase Realtime subscriptions from frontend
-- ============================================
