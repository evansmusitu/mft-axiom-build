CREATE TABLE IF NOT EXISTS axiom_execution_tasks (
  task_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  runtime_build_id TEXT,
  operation TEXT,
  artifact_json TEXT,
  receipt_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_axiom_execution_tasks_customer_started
  ON axiom_execution_tasks(customer_id, started_at DESC);
