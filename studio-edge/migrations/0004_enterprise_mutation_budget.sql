-- Dedicated MUSITU Intelligence tenant D1 database only; apply after 0003.
-- Globally enforced across Worker isolates by a single SQLite transaction.
-- 20 successful mutations per tenant per rolling 60 seconds. This protects
-- durable mutation costs, NOT GET traffic, unauthenticated probes or all AI costs.
CREATE TRIGGER enterprise_tenant_mutation_budget
BEFORE INSERT ON tenant_audit
WHEN (
  SELECT COUNT(*) FROM tenant_audit
  WHERE tenant_id = NEW.tenant_id AND at >= NEW.at - 59 AND at <= NEW.at
) >= 20
BEGIN
  SELECT RAISE(ABORT, 'tenant_mutation_budget_exceeded');
END;
