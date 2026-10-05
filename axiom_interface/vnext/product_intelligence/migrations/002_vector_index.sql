-- MUSITU AXIOM Product Intelligence OS - VectorIndexBackend
-- PostgreSQL 18.6 + pgvector 0.8.6 mechanism. AXIOM owns semantics, identity, evidence and authority.
-- A logical project/work/index is permanently bound to one dimension + similarity metric.
-- pgvector vector HNSW/IVFFlat dimensions are capped at 2000, so AXIOM fails closed above 2000.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS axiom_pi;

CREATE TABLE IF NOT EXISTS axiom_pi.vector_index_configs (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  index_id TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('cosine','l2','inner_product')),
  dimension INTEGER NOT NULL CHECK (dimension BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, work_id, index_id),
  UNIQUE (project_id, work_id, index_id, metric, dimension)
);

CREATE TABLE IF NOT EXISTS axiom_pi.vector_entries (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  index_id TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('cosine','l2','inner_product')),
  record_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  vector_hash TEXT NOT NULL CHECK (vector_hash ~ '^[0-9a-f]{64}$'),
  embedding vector NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension BETWEEN 1 AND 2000),
  content TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tombstoned BOOLEAN NOT NULL DEFAULT FALSE,
  tombstoned_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, work_id, index_id, record_id),
  FOREIGN KEY (project_id, work_id, index_id, metric, dimension)
    REFERENCES axiom_pi.vector_index_configs(project_id, work_id, index_id, metric, dimension)
    ON DELETE RESTRICT,
  CHECK (vector_dims(embedding) = dimension),
  CHECK ((tombstoned = FALSE AND tombstoned_at IS NULL) OR tombstoned = TRUE)
);

CREATE TABLE IF NOT EXISTS axiom_pi.vector_write_requests (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  index_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, work_id, index_id, request_id),
  FOREIGN KEY (project_id, work_id, index_id)
    REFERENCES axiom_pi.vector_index_configs(project_id, work_id, index_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS vector_entries_scope_idx
  ON axiom_pi.vector_entries(project_id, work_id, index_id, metric, dimension, tombstoned);
CREATE INDEX IF NOT EXISTS vector_entries_content_hash_idx
  ON axiom_pi.vector_entries(project_id, work_id, index_id, content_hash);

-- ANN indexes are intentionally not created globally because pgvector indexes require one fixed
-- vector dimension/operator class. A later qualified provisioning step may create per-logical-index
-- partial HNSW indexes after AXIOM has bound exact project/work/index identity, dimension and metric.
