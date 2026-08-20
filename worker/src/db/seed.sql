-- Snap It & Forget It — Seed Data
-- FME Mission 001
-- This is already embedded in schema.sql via INSERT OR IGNORE.
-- Run standalone only if accounts table is empty.

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
