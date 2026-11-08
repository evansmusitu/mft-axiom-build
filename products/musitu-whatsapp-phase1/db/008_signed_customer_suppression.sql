-- ADDITIVE candidate. NOT applied to any existing MUSITU production database.
-- Migration 007 must already have established the conversations composite binding.
-- A customer can revoke automation by replying STOP/UNSUBSCRIBE via a Meta-
-- signed message on the authenticated business number. This is NOT a grant of
-- opt-in permission: no automated START or staff action bypasses suppression.
-- Non-owner/non-BYPASSRLS ingress and runtime roles must be independently
-- qualified before this candidate is allowed anywhere near customer records.
BEGIN;
CREATE TABLE musitu.customer_suppressions (
 tenant_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 phone_number_id text NOT NULL,
 remote_wa_id text NOT NULL CHECK(remote_wa_id ~ '^hmac256:[a-f0-9]{64}$'),
 source_provider_message_id text NOT NULL,
 source_kind text NOT NULL DEFAULT 'SIGNED_META' CHECK(source_kind IN ('SIGNED_META','STAFF_ATTESTATION')),
 staff_actor_id text,
 CHECK ((source_kind='SIGNED_META' AND staff_actor_id IS NULL) OR
        (source_kind='STAFF_ATTESTATION' AND length(trim(staff_actor_id))>0)),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,conversation_id),
 FOREIGN KEY(tenant_id,conversation_id,phone_number_id,remote_wa_id)
   REFERENCES musitu.conversations(tenant_id,conversation_id,phone_number_id,remote_wa_id),
 CHECK(length(source_provider_message_id) BETWEEN 1 AND 160)
);
ALTER TABLE musitu.customer_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.customer_suppressions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.customer_suppressions
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.customer_suppressions FROM PUBLIC;
REVOKE ALL ON musitu.customer_suppressions FROM musitu_runtime,musitu_ingress;
GRANT SELECT,INSERT ON musitu.customer_suppressions TO musitu_runtime;
GRANT SELECT,INSERT ON musitu.customer_suppressions TO musitu_ingress;
-- Deliberately neither role has DELETE/UPDATE/TRUNCATE. A separate legal and
-- identity-reviewed repermission workflow would require a new migration.
COMMIT;
