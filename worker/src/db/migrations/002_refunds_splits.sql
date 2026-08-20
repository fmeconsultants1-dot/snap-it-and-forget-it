-- Migration 002: Refunds, Reversals, and Transaction Splits
-- Snap It & Forget It -- FME Mission 001
-- Run AFTER schema.sql
-- wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql
-- NOTE: schema.sql already includes refund columns and split_lines.
-- This migration is safe to run after schema.sql (uses IF NOT EXISTS / OR IGNORE).

-- ============================================================
-- 1. Add reversal relationship columns to ledger_entries (if not present)
-- ============================================================
-- SQLite does not allow conditional ADD COLUMN, so each runs and is
-- silently ignored if the column already exists in production D1.
-- The db-harness handles duplicate column errors gracefully.

ALTER TABLE ledger_entries ADD COLUMN reversal_of TEXT;
ALTER TABLE ledger_entries ADD COLUMN related_to TEXT;
ALTER TABLE ledger_entries ADD COLUMN credit_note_id TEXT;
ALTER TABLE ledger_entries ADD COLUMN refund_type TEXT;
ALTER TABLE ledger_entries ADD COLUMN refund_amount REAL;
ALTER TABLE ledger_entries ADD COLUMN settlement_account TEXT;

-- ============================================================
-- 2. Add reversal columns to journal_entries (if not present)
-- ============================================================

ALTER TABLE journal_entries ADD COLUMN reversal_of TEXT;
ALTER TABLE journal_entries ADD COLUMN reversal_type TEXT;

-- ============================================================
-- 3. Create split_lines table (IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS split_lines (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  line_order INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  expense_account_code TEXT NOT NULL REFERENCES accounts(code),
  expense_account_name TEXT NOT NULL,
  allocated_amount REAL NOT NULL,
  gst_portion REAL NOT NULL DEFAULT 0,
  hst_portion REAL NOT NULL DEFAULT 0,
  pst_portion REAL NOT NULL DEFAULT 0,
  total_with_tax REAL NOT NULL,
  is_business_use INTEGER NOT NULL DEFAULT 1,
  itc_eligible REAL NOT NULL DEFAULT 0,
  category TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_split_ledger ON split_lines(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_split_journal ON split_lines(journal_entry_id);

-- ============================================================
-- 4. Ensure 1310 and 1320 accounts exist
-- ============================================================

INSERT OR IGNORE INTO accounts (code, name, type) VALUES
  ('1310', 'GST/HST Recoverable', 'ASSET'),
  ('1320', 'PST Expense Clearing', 'ASSET');

-- ============================================================
-- 5. Create reversal indexes on ledger_entries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ledger_reversal ON ledger_entries(reversal_of);

-- ============================================================
-- 6. Schema migration tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
