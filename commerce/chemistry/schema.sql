CREATE TABLE IF NOT EXISTS chemistry_orders (
  reference TEXT PRIMARY KEY,
  client_secret_sha256 TEXT NOT NULL,
  plan TEXT NOT NULL,
  holder TEXT NOT NULL,
  email TEXT,
  seats INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  browser_url TEXT,
  poll_url TEXT,
  paynow_reference TEXT,
  licence_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS chemistry_orders_status_idx ON chemistry_orders(status);

CREATE TABLE IF NOT EXISTS chemistry_seats (
  reference TEXT NOT NULL,
  seat_no INTEGER NOT NULL,
  device_id TEXT,
  licence_token TEXT,
  issued_at TEXT,
  PRIMARY KEY(reference, seat_no),
  UNIQUE(reference, device_id),
  FOREIGN KEY(reference) REFERENCES chemistry_orders(reference) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chemistry_provider_events (
  provider TEXT NOT NULL,
  digest TEXT NOT NULL,
  reference TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  outcome TEXT,
  PRIMARY KEY(provider, digest)
);
