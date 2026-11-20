-- Existing duplicate seats must be reconciled with their payments and escrow
-- before applying this migration. The index fails if duplicate active rows remain.
CREATE UNIQUE INDEX uq_live_session_active_seat
    ON public.live_session_participants (photographer_id, surfer_id)
    WHERE status = 'active';
