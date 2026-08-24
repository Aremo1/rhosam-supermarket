-- Migration: Add branch_id to users table for multi-branch scoping
-- This enables each branch to login independently and generate their own receipts

-- Add branch_id column to users (nullable initially for existing users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);

-- Create index for efficient branch-filtered queries
CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id);

-- Ensure all existing sales have a valid branch_id (default to 1)
-- The column already exists with DEFAULT 1, so this is just a safety net
UPDATE sales SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE purchase_orders SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE expenses SET branch_id = 1 WHERE branch_id IS NULL;
UPDATE cash_drawer SET branch_id = 1 WHERE branch_id IS NULL;
