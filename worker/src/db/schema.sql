-- Snap It & Forget It -- D1 Schema
-- FME Mission 001
-- Run: wrangler d1 execute snap-it-db --file=src/db/schema.sql
-- Then: wrangler d1 execute snap-it-db --file=src/db/migrations/002_refunds_splits.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  document_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  user_id TEXT,
  total_amount REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scan_runs(id),
  sequence INTEGER NOT NULL DEFAULT 1,
  r2_key TEXT,
  r2_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  doc_type TEXT NOT NULL DEFAULT 'RECEIPT',
  vendor TEXT,
  date TEXT,
  total REAL,
  subtotal REAL,
  tax REAL,
  tax_gst REAL,
  tax_hst REAL,
  tax_pst REAL,
  payment_method TEXT,
  category TEXT,
  description TEXT,
  issuer TEXT,
  line_items TEXT,
  raw_fields TEXT,
  confidence_vendor REAL,
  confidence_date REAL,
  confidence_total REAL,
  confidence_category REAL,
  gemini_model TEXT DEFAULT 'gemini-1.5-flash',
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO accounts (code, name, type) VALUES
  ('1010', 'Cash', 'ASSET'),
  ('1020', 'Bank - Chequing', 'ASSET'),
  ('1030', 'Bank - Savings', 'ASSET'),
  ('1040', 'Credit Card Payable', 'LIABILITY'),
  ('1100', 'Accounts Receivable', 'ASSET'),
  ('1310', 'GST/HST Recoverable', 'ASSET'),
  ('1320', 'PST Expense Clearing', 'ASSET'),
  ('2010', 'Accounts Payable', 'LIABILITY'),
  ('2020', 'GST/HST Payable', 'LIABILITY'),
  ('2030', 'PST Payable', 'LIABILITY'),
  ('3010', 'Owner Equity', 'EQUITY'),
  ('4010', 'Revenue', 'REVENUE'),
  ('5010', 'Operating Expenses', 'EXPENSE'),
  ('5020', 'Meals & Entertainment', 'EXPENSE'),
  ('5030', 'Travel', 'EXPENSE'),
  ('5040', 'Vehicle', 'EXPENSE'),
  ('5050', 'Office Supplies', 'EXPENSE'),
  ('5060', 'Professional Fees', 'EXPENSE'),
  ('5070', 'Utilities', 'EXPENSE');

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES scan_runs(id),
  document_id TEXT REFERENCES documents(id),
  extraction_id TEXT REFERENCES extractions(id),
  entry_type TEXT NOT NULL DEFAULT 'RECEIPT',
  entity TEXT,
  date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  debit_amount REAL DEFAULT 0,
  credit_amount REAL DEFAULT 0,
  balance_type TEXT,
  status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  review_note TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ref_number TEXT UNIQUE,
  -- Refund/reversal fields (populated by migration 002 if not present)
  reversal_of TEXT,
  related_to TEXT,
  credit_note_id TEXT,
  refund_type TEXT,
  refund_amount REAL,
  settlement_account TEXT
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  entry_date TEXT NOT NULL,
  description TEXT,
  doc_type TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  is_balanced INTEGER NOT NULL DEFAULT 0,
  total_debits REAL NOT NULL DEFAULT 0,
  total_credits REAL NOT NULL DEFAULT 0,
  running_total REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT,
  ref_number TEXT,
  -- Reversal fields
  reversal_of TEXT,
  reversal_type TEXT
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL REFERENCES accounts(code),
  account_name TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  memo TEXT,
  line_order INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS bank_imports (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT,
  transaction_date TEXT,
  description TEXT,
  amount REAL,
  account_code TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0,
  matched_ledger_entry_id TEXT REFERENCES ledger_entries(id),
  raw_row TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  performed_by TEXT,
  performed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_run ON documents(run_id);
CREATE INDEX IF NOT EXISTS idx_extractions_doc ON extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_ledger_run ON ledger_entries(run_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(date);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger_entries(status);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_ledger_reversal ON ledger_entries(reversal_of);
CREATE INDEX IF NOT EXISTS idx_journal_ledger ON journal_entries(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_split_ledger ON split_lines(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_split_journal ON split_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(performed_at);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
