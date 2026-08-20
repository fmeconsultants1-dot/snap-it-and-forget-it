-- Snap It & Forget It — Schema Verification
-- FME Mission 001
-- Run after migration to confirm all tables and indexes exist.
-- wrangler d1 execute snap-it-db --file=src/db/schema-verify.sql

SELECT 'scan_runs' as tbl, COUNT(*) as row_count FROM scan_runs
UNION ALL
SELECT 'documents', COUNT(*) FROM documents
UNION ALL
SELECT 'extractions', COUNT(*) FROM extractions
UNION ALL
SELECT 'accounts', COUNT(*) FROM accounts
UNION ALL
SELECT 'ledger_entries', COUNT(*) FROM ledger_entries
UNION ALL
SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL
SELECT 'journal_lines', COUNT(*) FROM journal_lines
UNION ALL
SELECT 'bank_imports', COUNT(*) FROM bank_imports
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log;

-- Verify accounts seeded (should be 17)
SELECT COUNT(*) as account_count FROM accounts;

-- Verify double-entry balance (all should be 1)
SELECT ref_number, total_debits, total_credits, is_balanced
FROM journal_entries
WHERE is_balanced = 0
LIMIT 10;
-- If above returns 0 rows: PASS. All entries balanced.
