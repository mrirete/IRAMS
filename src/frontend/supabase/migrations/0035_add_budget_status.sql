-- Add status column to budgets table for governance
ALTER TABLE budgets 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT';

-- Add check constraint for valid status values
ALTER TABLE budgets 
ADD CONSTRAINT chk_budget_status 
CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
