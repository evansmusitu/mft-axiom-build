-- ADDITIVE PRIVATE candidate; not yet applied to real PostgreSQL.
-- This is NOT a provider sending queue, and does not grant send authority.
-- Migration owner must be distinct from musitu_runtime and musitu_ingress.
BEGIN;
ALTER TABLE musitu.inbound_events
 ADD COLUMN provider_sent_at timestamptz;
-- Preserve exact signed-provider timestamp on newly ingested events only.
-- Legacy NULL timestamps can never authorize a customer-service session.
GRANT INSERT (tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at)
 ON musitu.inbound_events TO musitu_ingress;
-- Cross-column uniqueness ensures that a prepared recipient/channel actually
-- belongs to the authenticated tenant-scoped conversation.
ALTER TABLE musitu.conversations
 ADD CONSTRAINT conversations_preparation_binding_unique
 UNIQUE (tenant_id,conversation_id,phone_number_id,remote_wa_id);

-- Trusted consent is registered by a separately qualified operator, NOT by
-- the webhook ingress or public customer API. The proof reference is a pointer
-- to externally reviewed evidence, not automatic proof of legal consent.
CREATE TABLE musitu.channel_consent_evidence (
 tenant_id uuid NOT NULL,
 phone_number_id text NOT NULL,
 recipient_hash text NOT NULL CHECK(recipient_hash ~ '^hmac256:[a-f0-9]{64}$'),
 scope text NOT NULL CHECK(scope='CUSTOMER_SERVICE'),
 status text NOT NULL CHECK(status IN ('GRANTED','REVOKED')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 300),
 confirmed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,phone_number_id,recipient_hash),
 CHECK(expires_at>confirmed_at),
 FOREIGN KEY (tenant_id,phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);
ALTER TABLE musitu.channel_consent_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.channel_consent_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.channel_consent_evidence
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.channel_consent_evidence FROM PUBLIC;
GRANT SELECT ON musitu.channel_consent_evidence TO musitu_runtime;

CREATE TABLE musitu.outbound_preparations (
 tenant_id uuid NOT NULL,
 preparation_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 reservation_key text NOT NULL CHECK(length(trim(reservation_key)) BETWEEN 1 AND 180),
 channel_phone_number_id text NOT NULL,
 recipient_hash text NOT NULL CHECK(recipient_hash ~ '^hmac256:[a-f0-9]{64}$'),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'STAGED_OFFLINE' CHECK(status='STAGED_OFFLINE'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,preparation_id),
 UNIQUE(tenant_id,draft_id),
 UNIQUE(tenant_id,reservation_key),
 FOREIGN KEY(tenant_id,draft_id) REFERENCES musitu.reply_drafts(tenant_id,draft_id),
 FOREIGN KEY(tenant_id,conversation_id,channel_phone_number_id,recipient_hash)
 REFERENCES musitu.conversations(tenant_id,conversation_id,phone_number_id,remote_wa_id)
);
ALTER TABLE musitu.outbound_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.outbound_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.outbound_preparations
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.outbound_preparations FROM PUBLIC;
GRANT SELECT,INSERT ON musitu.outbound_preparations TO musitu_runtime;
-- NO UPDATE, DELETE, provider API, provider access-token, raw recipient,
-- outbound_attempts INSERT, or grant to the ingress service role.
COMMIT;
