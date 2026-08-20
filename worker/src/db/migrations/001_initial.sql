-- Migration 001: Initial Schema
-- Snap It & Forget It — FME Mission 001
-- Run: wrangler d1 execute snap-it-db --file=src/db/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);

-- All tables created in schema.sql
-- This migration file exists for versioned tracking.
-- Re-run schema.sql for full setup:
-- wrangler d1 execute snap-it-db --file=src/db/schema.sql
