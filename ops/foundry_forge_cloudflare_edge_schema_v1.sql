CREATE TABLE IF NOT EXISTS edge_rate_buckets (
  principal_sha256 TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_sha256, minute_bucket)
);

CREATE INDEX IF NOT EXISTS idx_edge_rate_minute
  ON edge_rate_buckets(minute_bucket);
