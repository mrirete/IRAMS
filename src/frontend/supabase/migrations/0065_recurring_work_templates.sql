-- 0065: Add template storage to recurring_work and traceability to work_orders
-- Templates are stored as JSONB and copied to real WO tables on generation.

-- 1. Add templates JSONB column to recurring_work
ALTER TABLE recurring_work
ADD COLUMN IF NOT EXISTS templates JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN recurring_work.templates IS 'JSONB template store: { tasks: JobTask[], jsa: JobJSA, labor: JobLabor[], inventory: JobInventory[] }';

-- 2. Add recurring_work_id FK on work_orders for traceability
ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS recurring_work_id TEXT REFERENCES recurring_work(id);

CREATE INDEX IF NOT EXISTS idx_work_orders_recurring_work_id ON work_orders(recurring_work_id);

COMMENT ON COLUMN work_orders.recurring_work_id IS 'Source PM/recurring job that generated this WO';

-- 3. Reload PostgREST schema cache so the API sees new columns
NOTIFY pgrst, 'reload config';
