BEGIN;
CREATE TABLE IF NOT EXISTS public.gallery_copy_receipts (
    owner_id varchar(36) NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    operation_id varchar(36) NOT NULL,
    source_id varchar(36) NOT NULL,
    target_id varchar(36) NOT NULL,
    copy_id varchar(36) NOT NULL,
    PRIMARY KEY (owner_id, operation_id)
);
ALTER TABLE public.gallery_copy_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gallery_copy_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.gallery_copy_receipts TO service_role;
COMMIT;
