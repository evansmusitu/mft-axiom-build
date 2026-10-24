-- PostgreSQL candidate for isolated deployment; application service is not a
-- table owner. Before applying, create a dedicated musitu_runtime LOGIN role
-- with NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS and a separate
-- migration owner. Run all three migrations as the schema owner.
-- No live deployment of this migration is authorized by this source package.
BEGIN;
REVOKE ALL ON SCHEMA musitu FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA musitu FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA musitu FROM musitu_runtime;
GRANT USAGE ON SCHEMA musitu TO musitu_runtime;
-- Only explicitly scoped reads and reservation writes; no tenant creation,
-- membership grants, messaging outbox writes or payment processing.
GRANT SELECT ON musitu.tenants,musitu.memberships,musitu.whatsapp_channels,
  musitu.conversations,musitu.inbound_events,musitu.message_status_events,
  musitu.resources,musitu.bookings,musitu.outbound_attempts,
  musitu.faqs,musitu.reply_drafts TO musitu_runtime;
GRANT INSERT ON musitu.bookings TO musitu_runtime;
COMMIT;
