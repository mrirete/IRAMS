-- Add metadata column to dictionaries table for storing module associations
ALTER TABLE dictionaries ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Now insert the NOTIFICATION_EVENT entries with module associations
INSERT INTO dictionaries (type, code, description, is_locked, active, metadata) VALUES
-- Work Orders
('NOTIFICATION_EVENT', 'STATUS_CHANGE', 'Status Change', false, true, '{"modules": ["workOrders", "requests"]}'),
('NOTIFICATION_EVENT', 'SLA_BREACH', 'SLA Breach', false, true, '{"modules": ["workOrders", "requests"]}'),
('NOTIFICATION_EVENT', 'JOB_ASSIGNED', 'Job Assigned', false, true, '{"modules": ["workOrders"]}'),
('NOTIFICATION_EVENT', 'ACTION_CREATED', 'Action Created', false, true, '{"modules": ["workOrders"]}'),
('NOTIFICATION_EVENT', 'JOB_COMPLETED', 'Job Completed', false, true, '{"modules": ["workOrders"]}'),
-- Requests
('NOTIFICATION_EVENT', 'REQUEST_CREATED', 'Request Created', false, true, '{"modules": ["requests"]}'),
('NOTIFICATION_EVENT', 'REQUEST_APPROVED', 'Request Approved', false, true, '{"modules": ["requests"]}'),
('NOTIFICATION_EVENT', 'REQUEST_REJECTED', 'Request Rejected', false, true, '{"modules": ["requests"]}'),
-- Inventory
('NOTIFICATION_EVENT', 'STOCK_ZERO', 'Stockout (Zero Qty)', false, true, '{"modules": ["inventory"]}'),
('NOTIFICATION_EVENT', 'STOCK_LOW', 'Stock Low Warning', false, true, '{"modules": ["inventory"]}'),
('NOTIFICATION_EVENT', 'STOCK_RECEIVED', 'Stock Received', false, true, '{"modules": ["inventory"]}'),
-- PM
('NOTIFICATION_EVENT', 'PM_GENERATED', 'PM Generated', false, true, '{"modules": ["pm"]}'),
('NOTIFICATION_EVENT', 'PM_OVERDUE', 'PM Overdue', false, true, '{"modules": ["pm"]}'),
('NOTIFICATION_EVENT', 'PM_DUE_SOON', 'PM Due Soon', false, true, '{"modules": ["pm"]}'),
-- Readings / Condition Monitoring
('NOTIFICATION_EVENT', 'READING_CRITICAL', 'Critical Reading Alert', false, true, '{"modules": ["readings"]}'),
('NOTIFICATION_EVENT', 'READING_WARNING', 'Warning Reading Alert', false, true, '{"modules": ["readings"]}'),
('NOTIFICATION_EVENT', 'READING_DEVIATION', 'Reading Deviation Detected', false, true, '{"modules": ["readings"]}'),
-- Purchasing
('NOTIFICATION_EVENT', 'PO_CREATED', 'Purchase Order Created', false, true, '{"modules": ["purchasing"]}'),
('NOTIFICATION_EVENT', 'PO_APPROVED', 'Purchase Order Approved', false, true, '{"modules": ["purchasing"]}'),
('NOTIFICATION_EVENT', 'PO_RECEIVED', 'Purchase Order Received', false, true, '{"modules": ["purchasing"]}'),
-- Assets (general)
('NOTIFICATION_EVENT', 'ASSET_DOWNTIME', 'Asset Downtime Recorded', false, true, '{"modules": ["workOrders", "readings"]}'),
('NOTIFICATION_EVENT', 'ASSET_CRITICALITY_CHANGE', 'Asset Criticality Changed', false, true, '{"modules": ["workOrders", "pm"]}')
ON CONFLICT (type, code) DO UPDATE SET metadata = EXCLUDED.metadata;
