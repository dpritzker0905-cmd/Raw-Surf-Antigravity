CREATE ROLE rawsurf_1274_ingress NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
CREATE SCHEMA rawsurf_1274_ingress;
REVOKE ALL ON SCHEMA rawsurf_1274_ingress FROM PUBLIC;
CREATE TABLE rawsurf_1274_ingress.receipts (
    event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9_]{1,240}$'),
    event_type text NOT NULL,
    object_id text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    livemode boolean NOT NULL DEFAULT false CHECK (NOT livemode),
    CHECK ((event_type = 'test_helpers.test_clock.created' AND object_id ~ '^clock_[A-Za-z0-9_]{1,240}$')
        OR (event_type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
            AND object_id ~ '^cs_test_[A-Za-z0-9_]{1,230}$'))
);
REVOKE ALL ON TABLE rawsurf_1274_ingress.receipts FROM PUBLIC;
ALTER TABLE rawsurf_1274_ingress.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ingress_append ON rawsurf_1274_ingress.receipts
    FOR INSERT TO rawsurf_1274_ingress WITH CHECK (NOT livemode);
GRANT USAGE ON SCHEMA rawsurf_1274_ingress TO rawsurf_1274_ingress;
GRANT INSERT(event_id, event_type, object_id) ON rawsurf_1274_ingress.receipts TO rawsurf_1274_ingress;
