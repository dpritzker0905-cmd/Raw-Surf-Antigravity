-- Historical requests have no reliable record of which subscription was debited.
ALTER TABLE public.dispatch_requests
    ADD COLUMN IF NOT EXISTS included_subscription_id varchar(36)
        REFERENCES public.surfer_photo_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS included_checkout_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS included_session_restored_at timestamptz;
