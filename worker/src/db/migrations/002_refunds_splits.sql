-- Migration 002: Refunds, Reversals, and Transaction Splits
-- Snap It & Forget It — FME Mission 001
-- Run AFTER migration 001 / schema.sql
-- wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql

-- ============================================================
-- 1. Add reversal relationship columns to ledger_entries
-- ============================================================
-- reversal_of:      ID of the original ledger_entry this reverses (for refunds)
-- related_to:       ID of a related ledger_entry (for partial refunds, credit notes)
-- credit_note_id:   Supplier credit note reference (AP credit)
-- refund_type:      FULL | PARTIAL | CREDIT_NOTE | CARD_REFUND
-- refund_amount:    Actual refund amount (may differ from original)
-- settlement_account: Which account received the refund (1010|1020|1040|2010)

ALTER TABLE ledger_entries ADD COLUMN reversal_of TEXT REFERENCES ledger_entries(id);
ALTER TABLE ledger_entries ADD COLUMN related_to TEXT REFERENCES ledger_entries(id);
ALTER TABLE ledger_entries ADD COLUMN credit_note_id TEXT;
ALTER TABLE ledger_entries ADD COLUMN refund_type TEXT CHECK(
  refund_type IS NULL OR
  refund_type IN ('FULL','PARTIAL','CREDIT_NOTE','CARD_REFUND')
);
ALTER TABLE ledger_entries ADD COLUMN refund_amount REAL;
ALTER TABLE ledger_entries ADD COLUMN settlement_account TEXT;

-- Add reversal_of to journal_entries
ALTER TABLE journal_entries ADD COLUMN reversal_of TEXT REFERENCES journal_entries(id);
ALTER TABLE journal_entries ADD COLUMN reversal_type TEXT;

-- Add REFUND and CREDIT_NOTE to entry_type check
-- SQLite does not support ALTER TABLE ADD CONSTRAINT after creation.
-- We enforce this in application code. Documenting the extended set here:
-- entry_type IN ('RECEIPT','INVOICE','DOCUMENT','STATEMENT',
--                'BANK_IMPORT','MANUAL','REFUND','CREDIT_NOTE')

-- ============================================================
-- 2. Create split_lines table
-- ============================================================
-- Splits one ledger_entry across multiple expense categories.
-- The PARENT ledger_entry holds the total amount.
-- Each split_line holds an allocation: account, amount, category, GST portion, PST portion.
-- SUM(split_lines.allocated_amount) = ledger_entries.amount (enforced in app).
-- SUM(split_lines.gst_portion) <= original extraction GST.
-- Personal-use split_lines have is_business_use = 0 (no ITC).

CREATE TABLE IF NOT EXISTS split_lines (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  line_order INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  expense_account_code TEXT NOT NULL REFERENCES accounts(code),
  expense_account_name TEXT NOT NULL,
  allocated_amount REAL NOT NULL,    -- Subtotal for this split (excl tax)
  gst_portion REAL NOT NULL DEFAULT 0,
  hst_portion REAL NOT NULL DEFAULT 0,
  pst_portion REAL NOT NULL DEFAULT 0,
  total_with_tax REAL NOT NULL,      -- allocated_amount + proportional tax
  is_business_use INTEGER NOT NULL DEFAULT 1,  -- 0 = personal, no ITC
  itc_eligible REAL NOT NULL DEFAULT 0,        -- Eligible GST/HST ITC for this line
  category TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_split_ledger ON split_lines(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_split_journal ON split_lines(journal_entry_id);

-- ============================================================
-- 3. Add 1310 account if not already present
-- ============================================================
INSERT OR IGNORE INTO accounts (code, name, type) VALUES
  ('1310', 'GST/HST Recoverable', 'ASSET'),
  ('1320', 'PST Expense Clearing', 'ASSET');

-- Schema migration tracking
INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
