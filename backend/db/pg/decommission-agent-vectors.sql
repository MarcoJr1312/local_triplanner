-- M14 decommission: agent vectors moved to the agent service pgvector DB.
-- Run after the agent bootstrap and Gate 2, with the old agent stopped.
DROP TABLE IF EXISTS agent_embeddings;
DROP TABLE IF EXISTS agent_index_state;
DROP EXTENSION IF EXISTS vector;
