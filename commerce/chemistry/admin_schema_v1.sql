-- MUSITU Chemistry Admin Command Center schema v1
-- Additive only: existing chemistry_orders / chemistry_seats remain authoritative.

CREATE TABLE IF NOT EXISTS chemistry_admin_schema (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chemistry_admin_users (
  admin_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','finance','cashier','support','auditor','technical')),
  token_sha256 TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chem_admin_users_token ON chemistry_admin_users(token_sha256);

CREATE TABLE IF NOT EXISTS chemistry_customers (
  customer_id TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','suspended','archived')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_customers_holder ON chemistry_customers(holder);
CREATE INDEX IF NOT EXISTS idx_chem_customers_email ON chemistry_customers(email);
CREATE INDEX IF NOT EXISTS idx_chem_customers_phone ON chemistry_customers(phone);

CREATE TABLE IF NOT EXISTS chemistry_customer_orders (
  customer_id TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(customer_id,reference)
);
CREATE INDEX IF NOT EXISTS idx_chem_customer_orders_reference ON chemistry_customer_orders(reference);

CREATE TABLE IF NOT EXISTS chemistry_cash_sessions (
  session_id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='USD'),
  opening_cents INTEGER NOT NULL DEFAULT 0,
  counted_cents INTEGER,
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_chem_cash_sessions_cashier ON chemistry_cash_sessions(cashier_id,status,opened_at);

CREATE TABLE IF NOT EXISTS chemistry_payments (
  payment_id TEXT PRIMARY KEY,
  reference TEXT NOT NULL,
  customer_id TEXT,
  method TEXT NOT NULL CHECK(method IN ('cash','paynow','complimentary','adjustment')),
  direction TEXT NOT NULL CHECK(direction IN ('credit','debit')) DEFAULT 'credit',
  amount_cents INTEGER NOT NULL,
  tendered_cents INTEGER,
  change_cents INTEGER,
  currency TEXT NOT NULL CHECK(currency='USD'),
  status TEXT NOT NULL,
  provider_reference TEXT,
  cash_session_id TEXT,
  received_by TEXT,
  notes TEXT,
  reversal_of TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chem_payments_reference ON chemistry_payments(reference,created_at);
CREATE INDEX IF NOT EXISTS idx_chem_payments_customer ON chemistry_payments(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_chem_payments_cash_session ON chemistry_payments(cash_session_id,created_at);
CREATE INDEX IF NOT EXISTS idx_chem_payments_status ON chemistry_payments(status,created_at);

CREATE TABLE IF NOT EXISTS chemistry_receipts (
  receipt_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL,
  customer_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK(currency='USD'),
  issued_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_receipts_reference ON chemistry_receipts(reference);

CREATE TABLE IF NOT EXISTS chemistry_support_notes (
  note_id TEXT PRIMARY KEY,
  customer_id TEXT,
  reference TEXT,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_support_notes_customer ON chemistry_support_notes(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_chem_support_notes_reference ON chemistry_support_notes(reference,created_at);

CREATE TABLE IF NOT EXISTS chemistry_device_events (
  event_id TEXT PRIMARY KEY,
  customer_id TEXT,
  reference TEXT NOT NULL,
  seat_no INTEGER NOT NULL,
  old_device_id TEXT,
  new_device_id TEXT,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_device_events_reference ON chemistry_device_events(reference,created_at);

CREATE TABLE IF NOT EXISTS chemistry_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  reference TEXT NOT NULL,
  customer_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('cash_refund','paynow_refund_request','void','support_correction','access_grant')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK(currency='USD'),
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chem_adjustments_reference ON chemistry_adjustments(reference,created_at);

CREATE TABLE IF NOT EXISTS chemistry_access_controls (
  reference TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
  reason TEXT,
  actor_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chemistry_admin_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_admin_audit_target ON chemistry_admin_audit(target_type,target_id,seq);
CREATE INDEX IF NOT EXISTS idx_chem_admin_audit_actor ON chemistry_admin_audit(actor_id,seq);

-- Serializes the tamper-evident chain at the database boundary. If two admin
-- actions race after reading the same previous hash, only the first valid link
-- is accepted; the other action fails closed and can be retried.
CREATE TRIGGER IF NOT EXISTS trg_chem_admin_audit_chain
BEFORE INSERT ON chemistry_admin_audit
BEGIN
  SELECT CASE
    WHEN NEW.prev_hash != COALESCE((SELECT event_hash FROM chemistry_admin_audit ORDER BY seq DESC LIMIT 1),'GENESIS')
    THEN RAISE(ABORT,'audit_chain_conflict')
  END;
END;

INSERT OR IGNORE INTO chemistry_admin_schema(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
