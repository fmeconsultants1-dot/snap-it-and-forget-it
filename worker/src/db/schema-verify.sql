-- Snap It & Forget It -- Schema Verification
-- FME Mission 001
-- Run after both migrations to confirm all tables and indexes exist.
-- wrangler d1 execute snap-it-db --file=src/db/schema-verify.sql

SELECT 'scan_runs'       as tbl, COUNT(*) as row_count FROM scan_runs;
SELECT 'documents',      COUNT(*) FROM documents;
SELECT 'extractions',    COUNT(*) FROM extractions;
SELECT 'accounts',       COUNT(*) FROM accounts;
SELECT 'ledger_entries', COUNT(*) FROM ledger_entries;
SELECT 'journal_entries',COUNT(*) FROM journal_entries;
SELECT 'journal_lines',  COUNT(*) FROM journal_lines;
SELECT 'split_lines',    COUNT(*) FROM split_lines;
SELECT 'bank_imports',   COUNT(*) FROM bank_imports;
SELECT 'audit_log',      COUNT(*) FROM audit_log;
SELECT 'schema_migrations', COUNT(*) FROM schema_migrations;

-- Accounts seeded (should be 19: includes 1310 and 1320)
SELECT COUNT(*) as account_count FROM accounts;

-- Verify refund columns exist on ledger_entries
SELECT reversal_of, refund_type, refund_amount FROM ledger_entries LIMIT 1;

-- Verify split_lines has is_business_use column
SELECT is_business_use, itc_eligible FROM split_lines LIMIT 1;

-- Balance check: any unbalanced journal entries? (should return 0 rows)
SELECT ref_number, total_debits, total_credits, is_balanced
FROM journal_entries
WHERE is_balanced = 0 AND total_debits > 0
LIMIT 10;
-- If above returns 0 rows: PASS

-- Verify migrations applied
SELECT version, applied_at FROM schema_migrations ORDER BY version;
-- Should show: 1 and 2
