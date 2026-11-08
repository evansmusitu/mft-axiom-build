-- Phase 2.10C: explicit, review-required operator handoff.
-- NEVER auto-apply from general schema initialization or Worker startup.
-- Requires separately authorized PostgreSQL maintenance privileges.
-- The designated NOLOGIN owner is not the paid-service runtime.
-- Verify source, roles and ACLs, then obtain approval before any staging use.
BEGIN;
DO $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='axiom_spend_definer') THEN
    RAISE EXCEPTION 'Protected spend function-owner role already exists; independent review required';
  END IF;
END;
$guard$;
CREATE ROLE axiom_spend_definer
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO axiom_spend_definer;
GRANT USAGE,CREATE ON SCHEMA axiom_spend TO axiom_spend_definer;
GRANT SELECT,INSERT,UPDATE ON TABLE
  public.axiom_provider_spend_budgets,
  public.axiom_provider_spend_organizations,
  public.axiom_provider_spend_requests
 TO axiom_spend_definer;
ALTER FUNCTION axiom_spend.reserve(text,text,text,text,text,bigint,text)
 OWNER TO axiom_spend_definer;
ALTER FUNCTION axiom_spend.settle(text,text,text,text,text,bigint,text,text)
 OWNER TO axiom_spend_definer;
REVOKE CREATE ON SCHEMA axiom_spend FROM axiom_spend_definer;
REVOKE ALL ON FUNCTION axiom_spend.reserve(text,text,text,text,text,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION axiom_spend.settle(text,text,text,text,text,bigint,text,text) FROM PUBLIC;
COMMIT;
