-- CANDIDATE ONLY — native PostgreSQL 17 validation required before use.
-- Apply after 001-003 with dedicated migration owner.
-- Service identity `musitu_ingress` must be separate from `musitu_runtime`,
-- created by the test/provisioning administrator as NON-OWNER/NOBYPASSRLS.
BEGIN;
ALTER TABLE musitu.inbound_events
  ADD COLUMN conversation_id uuid,
  ADD COLUMN payload_fingerprint text CHECK
    (payload_fingerprint IS NULL OR payload_fingerprint ~ '^[a-f0-9]{64}$');
ALTER TABLE musitu.inbound_events
  ADD CONSTRAINT inbound_event_conversation_tenant_fk
    FOREIGN KEY (tenant_id,conversation_id)
    REFERENCES musitu.conversations (tenant_id,conversation_id);

-- Reconcile legacy events before enabling true live ingress. Legacy NULL
-- fingerprints remain unreadable for idempotent replay and therefore FAIL
-- CLOSED in application code rather than being silently accepted.
REVOKE ALL ON SCHEMA musitu FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA musitu FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA musitu FROM musitu_ingress;
GRANT USAGE ON SCHEMA musitu TO musitu_ingress;
GRANT SELECT ON musitu.tenants,musitu.whatsapp_channels,musitu.conversations,
  musitu.inbound_events,musitu.faqs,musitu.reply_drafts TO musitu_ingress;
GRANT INSERT ON musitu.conversations,musitu.inbound_events,musitu.reply_drafts TO musitu_ingress;
GRANT UPDATE (handling_mode) ON musitu.conversations TO musitu_ingress;
-- No membership editing, booking, outbound action, payment, or cross-tenant
-- privilege is granted to the ingress service role.
COMMIT;
