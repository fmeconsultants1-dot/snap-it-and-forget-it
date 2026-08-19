-- Snap It & Forget It — D1 Schema
-- FME Mission 001
-- Account codes from evidence: 5010-Operating Expenses, 1010-Cash

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Scan runs (multi-document batches)
CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  document_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETE','FAILED')),
  user_id TEXT,
  total_amount REAL DEFAULT 0
);

-- Raw scanned documents
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scan_runs(id),
  sequence INTEGER NOT NULL DEFAULT 1,
  r2_key TEXT,
  r2_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','DONE','FAILED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  error TEXT
);

-- Extracted document data (Gemini output)
CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  doc_type TEXT NOT NULL DEFAULT 'RECEIPT' CHECK(doc_type IN ('RECEIPT','INVOICE','DOCUMENT','STATEMENT')),
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
  line_items TEXT, -- JSON array
  raw_fields TEXT, -- JSON object (all Gemini output)
  confidence_vendor REAL,
  confidence_date REAL,
  confidence_total REAL,
  confidence_category REAL,
  gemini_model TEXT DEFAULT 'gemini-1.5-flash',
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chart of accounts
CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed chart of accounts
INSERT OR IGNORE INTO accounts (code, name, type) VALUES
  ('1010', 'Cash', 'ASSET'),
  ('1020', 'Bank - Chequing', 'ASSET'),
  ('1030', 'Bank - Savings', 'ASSET'),
  ('1040', 'Credit Card Payable', 'LIABILITY'),
  ('1100', 'Accounts Receivable', 'ASSET'),
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

-- Ledger register (transaction-level)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES scan_runs(id),
  document_id TEXT REFERENCES documents(id),
  extraction_id TEXT REFERENCES extractions(id),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('RECEIPT','INVOICE','DOCUMENT','STATEMENT','BANK_IMPORT','MANUAL')),
  entity TEXT,
  date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  debit_amount REAL DEFAULT 0,
  credit_amount REAL DEFAULT 0,
  balance_type TEXT CHECK(balance_type IN ('DEBIT','CREDIT','BALANCE')),
  status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(status IN ('NEEDS_REVIEW','APPROVED','REJECTED','RECONCILED')),
  review_note TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ref_number TEXT UNIQUE -- 6-char hex like #10A631
);

-- Double-entry journal entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  entry_date TEXT NOT NULL,
  description TEXT,
  doc_type TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','VOIDED')),
  is_balanced INTEGER NOT NULL DEFAULT 0,
  total_debits REAL NOT NULL DEFAULT 0,
  total_credits REAL NOT NULL DEFAULT 0,
  running_total REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT,
  ref_number TEXT
);

-- Journal lines (individual debit/credit lines)
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

-- Bank/card import staging
CREATE TABLE IF NOT EXISTS bank_imports (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT, -- 'csv', 'ofx', 'bank_name'
  transaction_date TEXT,
  description TEXT,
  amount REAL,
  account_code TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0,
  matched_ledger_entry_id TEXT REFERENCES ledger_entries(id),
  raw_row TEXT -- original CSV row JSON
);

-- Audit trail
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_run ON documents(run_id);
CREATE INDEX IF NOT EXISTS idx_extractions_doc ON extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_ledger_run ON ledger_entries(run_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(date);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger_entries(status);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_journal_ledger ON journal_entries(ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(performed_at);
