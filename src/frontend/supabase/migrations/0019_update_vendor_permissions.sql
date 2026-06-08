-- Update permissions for Vendors module in dictionaries table
-- Uses properties->permissions JSONB path

-- 1. SYS_ADMIN: Full Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "assign": true, "viewCosts": true, "spendingLimit": 1000000}'::jsonb)
WHERE code = 'SYS_ADMIN' AND type = 'CONTACT_TYPE';

-- 2. PLANNER: Full Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "assign": true, "viewCosts": true, "spendingLimit": 1000000}'::jsonb)
WHERE code = 'PLANNER' AND type = 'CONTACT_TYPE';

-- 3. RELIABILITY_ENG: Full Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "assign": true, "viewCosts": true, "spendingLimit": 1000000}'::jsonb)
WHERE code = 'RELIABILITY_ENG' AND type = 'CONTACT_TYPE';

-- 4. SUPERVISOR: Supervisor Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": true, "create": true, "edit": true, "delete": false, "approve": true, "authorize": true, "assign": true, "viewCosts": true, "spendingLimit": 5000}'::jsonb)
WHERE code = 'SUPERVISOR' AND type = 'CONTACT_TYPE';

-- 5. TECHNICIAN: Hidden/No Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": false, "create": false, "edit": false, "delete": false, "approve": false, "authorize": false, "assign": false, "viewCosts": false, "spendingLimit": 0}'::jsonb)
WHERE code = 'TECHNICIAN' AND type = 'CONTACT_TYPE';

-- 6. INTERNAL: Hidden/No Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": false, "create": false, "edit": false, "delete": false, "approve": false, "authorize": false, "assign": false, "viewCosts": false, "spendingLimit": 0}'::jsonb)
WHERE code = 'INTERNAL' AND type = 'CONTACT_TYPE';

-- 7. REQUESTER: Hidden/No Access
UPDATE dictionaries
SET properties = jsonb_set(properties, '{permissions, vendors}', '{"view": false, "create": false, "edit": false, "delete": false, "approve": false, "authorize": false, "assign": false, "viewCosts": false, "spendingLimit": 0}'::jsonb)
WHERE code = 'REQUESTER' AND type = 'CONTACT_TYPE';
