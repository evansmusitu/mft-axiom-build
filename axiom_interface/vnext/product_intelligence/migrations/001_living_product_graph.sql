-- MUSITU AXIOM Product Intelligence OS
-- Portable PostgreSQL 18.6 baseline; pgvector 0.8.6 extension expected.
-- Product Graph semantics remain AXIOM-owned. Apache AGE is intentionally not required.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS axiom_pi;

CREATE TABLE IF NOT EXISTS axiom_pi.lpg_generations (
  project_id TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation > 0),
  schema TEXT NOT NULL,
  impact_state TEXT NOT NULL CHECK (impact_state IN ('COMPUTED','NOT_PROVEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, generation)
);

CREATE TABLE IF NOT EXISTS axiom_pi.lpg_nodes (
  project_id TEXT NOT NULL,
  generation BIGINT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  metadata JSONB NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (project_id, generation, node_id),
  FOREIGN KEY (project_id, generation)
    REFERENCES axiom_pi.lpg_generations(project_id, generation)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS axiom_pi.lpg_edges (
  project_id TEXT NOT NULL,
  generation BIGINT NOT NULL,
  edge_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  causal_semantics TEXT NOT NULL CHECK (causal_semantics IN ('NONE','CORRELATION','HYPOTHESIS','QUASI_EXPERIMENTAL','RANDOMIZED_CAUSAL','EXTERNAL_ATTESTED_CAUSAL')),
  metadata JSONB NOT NULL,
  PRIMARY KEY (project_id, generation, edge_id),
  FOREIGN KEY (project_id, generation)
    REFERENCES axiom_pi.lpg_generations(project_id, generation)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, generation, from_id)
    REFERENCES axiom_pi.lpg_nodes(project_id, generation, node_id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, generation, to_id)
    REFERENCES axiom_pi.lpg_nodes(project_id, generation, node_id)
    ON DELETE CASCADE,
  CHECK (from_id <> to_id)
);

CREATE TABLE IF NOT EXISTS axiom_pi.lpg_heads (
  project_id TEXT PRIMARY KEY,
  generation BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, generation)
    REFERENCES axiom_pi.lpg_generations(project_id, generation)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS lpg_nodes_type_idx
  ON axiom_pi.lpg_nodes(project_id, generation, node_type);
CREATE INDEX IF NOT EXISTS lpg_edges_from_idx
  ON axiom_pi.lpg_edges(project_id, generation, from_id, relation);
CREATE INDEX IF NOT EXISTS lpg_edges_to_idx
  ON axiom_pi.lpg_edges(project_id, generation, to_id, relation);
