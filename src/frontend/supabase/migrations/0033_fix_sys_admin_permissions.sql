DO $$
DECLARE
    sys_admin_perms jsonb;
BEGIN
    sys_admin_perms := '{
        "admin": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "assets": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "contacts": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "dashboard": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "inventory": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "pm": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "purchasing": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true, "spendingLimit": 1000000},
        "readings": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "requests": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "scheduling": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "taskLibrary": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "vendors": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "workOrders": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "analytics": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true},
        "finops": {"view": true, "create": true, "edit": true, "delete": true, "approve": true, "authorize": true, "viewCosts": true, "assign": true}
    }';

    -- Update permissions for SYS_ADMIN
    UPDATE dictionaries
    SET properties = jsonb_set(
        COALESCE(properties, '{}'::jsonb),
        '{permissions}',
        sys_admin_perms
    )
    WHERE type = 'CONTACT_TYPE' AND code = 'SYS_ADMIN';
    
    -- If no row was updated, insert it to ensure SYS_ADMIN exists
    IF NOT FOUND THEN
        INSERT INTO dictionaries (type, code, description, active, properties)
        VALUES ('CONTACT_TYPE', 'SYS_ADMIN', 'System Administrator', true, 
            jsonb_build_object('permissions', sys_admin_perms)
        );
    END IF;
END $$;
