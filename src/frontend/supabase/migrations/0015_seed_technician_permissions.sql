
-- 0015_seed_technician_permissions.sql
-- Seed default permissions for TECHNICIAN role
-- They should see most operational modules, but restricted from Admin/Financials

UPDATE public.dictionaries
SET properties = properties || '{
  "permissions": {
    "dashboard": { "view": true },
    "requests": { "view": true, "edit": true, "create": true },
    "workOrders": { "view": true, "edit": true, "create": true },
    "pm": { "view": true, "edit": true },
    "scheduling": { "view": true },
    "assets": { "view": true }, 
    "inventory": { "view": true, "edit": true },
    "readings": { "view": true, "edit": true },
    "contacts": { "view": true }, 
    "purchasing": { "view": true },
    "admin": { "view": false }
  }
}'::jsonb
WHERE type = 'CONTACT_TYPE' AND code = 'TECHNICIAN';

-- Also seed ENGINEER with slightly more
UPDATE public.dictionaries
SET properties = properties || '{
  "permissions": {
    "dashboard": { "view": true },
    "requests": { "view": true, "edit": true, "create": true },
    "workOrders": { "view": true, "edit": true, "create": true, "approve": true },
    "pm": { "view": true, "edit": true, "create": true },
    "scheduling": { "view": true, "edit": true },
    "assets": { "view": true, "edit": true, "create": true }, 
    "inventory": { "view": true, "edit": true, "create": true },
    "readings": { "view": true, "edit": true },
    "contacts": { "view": true },
    "purchasing": { "view": true, "create": false },
    "analytics": { "view": true },
    "admin": { "view": false }
  }
}'::jsonb
WHERE type = 'CONTACT_TYPE' AND code = 'ENGINEER';
