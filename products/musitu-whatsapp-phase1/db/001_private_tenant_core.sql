-- PROPOSED migration; NOT EXECUTED here (no PostgreSQL service is installed).
-- Apply with a dedicated migration owner after review; app runtime must be an
-- unprivileged NON-OWNER role without BYPASSRLS, and must SET LOCAL app.tenant_id
-- in each authenticated transaction. This file is not a deployment approval.
BEGIN;
CREATE SCHEMA IF NOT EXISTS musitu;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE musitu.tenants (
  id uuid PRIMARY KEY,
  legal_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED'))
);

CREATE TABLE musitu.memberships (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','AGENT','VIEWER')),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  PRIMARY KEY (tenant_id,actor_id)
);

CREATE TABLE musitu.whatsapp_channels (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  waba_id text NOT NULL,
  phone_number_id text PRIMARY KEY,
  status text NOT NULL CHECK(status IN ('VERIFIED','REVOKED')),
  UNIQUE (waba_id,phone_number_id),
  UNIQUE (tenant_id,phone_number_id)
);

CREATE TABLE musitu.conversations (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  conversation_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  remote_wa_id text NOT NULL,
  handling_mode text NOT NULL DEFAULT 'BOT' CHECK (handling_mode IN ('BOT','HUMAN')),
  PRIMARY KEY (tenant_id,conversation_id),
  UNIQUE (tenant_id,phone_number_id,remote_wa_id),
  FOREIGN KEY (tenant_id,phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);

CREATE TABLE musitu.inbound_events (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  phone_number_id text NOT NULL,
  provider_message_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,phone_number_id,provider_message_id),
  FOREIGN KEY (tenant_id,phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);

CREATE TABLE musitu.message_status_events (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  phone_number_id text NOT NULL,
  provider_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('SENT','DELIVERED','READ','FAILED')),
  provider_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,phone_number_id,provider_message_id,status,provider_timestamp),
  FOREIGN KEY(tenant_id,phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);

CREATE TABLE musitu.resources (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  resource_id uuid NOT NULL,
  label text NOT NULL,
  PRIMARY KEY(tenant_id,resource_id)
);

CREATE TABLE musitu.bookings (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  booking_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('CONFIRMED','CANCELLED')),
  source_idempotency_key text NOT NULL,
  PRIMARY KEY(tenant_id,booking_id),
  UNIQUE(tenant_id,source_idempotency_key),
  FOREIGN KEY(tenant_id,resource_id) REFERENCES musitu.resources(tenant_id,resource_id),
  CONSTRAINT valid_booking_interval CHECK(end_at>start_at),
  CONSTRAINT no_overlapping_confirmed_bookings EXCLUDE USING gist
    (tenant_id WITH =, resource_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
    WHERE (status='CONFIRMED')
);

CREATE TABLE musitu.outbound_attempts (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  attempt_id uuid NOT NULL,
  effect_key text NOT NULL,
  channel_phone_number_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('RESERVED','ACCEPTED','DELIVERED','FAILED','UNKNOWN')),
  provider_message_id text,
  PRIMARY KEY(tenant_id,attempt_id),
  UNIQUE(tenant_id,effect_key),
  UNIQUE(channel_phone_number_id,provider_message_id),
  FOREIGN KEY (tenant_id,channel_phone_number_id) REFERENCES musitu.whatsapp_channels(tenant_id,phone_number_id)
);

-- Enforce the tenant policy even when accessed through the table-owner role;
-- the runtime application MUST NOT be the migration owner or a superuser.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['tenants','memberships','whatsapp_channels','conversations',
       'inbound_events','message_status_events','resources','bookings','outbound_attempts'] LOOP
    EXECUTE format('ALTER TABLE musitu.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE musitu.%I FORCE ROW LEVEL SECURITY',tab);
    IF tab='tenants' THEN
      EXECUTE format('CREATE POLICY tenant_boundary ON musitu.%I USING (id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',tab);
    ELSE
      EXECUTE format('CREATE POLICY tenant_boundary ON musitu.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',tab);
    END IF;
  END LOOP;
END $$;
COMMIT;

-- SECURITY REVIEW REQUIRED before production:
-- 1) Security-definer tenant mapping function for the initial signed Meta webhook
--    where no tenant context exists; it must validate signed WABA+phone mapping.
-- 2) Application privilege grants and owner separation, migration privileges,
--    select/update grants, actor membership verification and revoked access.
-- 3) Re-test the existing composite tenant+phone foreign-key constraints
--    with adversarial imports and pooled connections.
-- 4) Reconcile out-of-order provider status transitions against monotonic
--    outbound state; preserve valid changed statuses as separate status events.
-- 5) Add consent/template evidence, retention policy, deletion, audit and
--    charging records in later migrations.
