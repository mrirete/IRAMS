-- 0024_cleanup_mock_data.sql
-- Purpose: Remove all mock contacts and users from the database.
-- Handles both seeded data (by code) and constant data (by ID/Email).

BEGIN;

BEGIN;

-- 1. Identify Target Contacts & Users to Delete
CREATE TEMP TABLE target_identities AS
SELECT c.id as contact_id, u.id as user_id
FROM public.contacts c
LEFT JOIN public.users u ON u.contact_id = c.id
WHERE 
    c.code IN ('JD01', 'TECH01', 'TECH02', 'TECH03', 'TECH04', 'SUP01', 'SUP02', 'PLAN01')
    OR c.email IN (
        'john.doe@example.com', 'john.doe@cainergy.com',
        'alex@example.com', 'alex@cainergy.com',
        'bea@example.com', 'bea@cainergy.com',
        'charlie@example.com', 'charlie@cainergy.com',
        'dana@example.com', 'dana@cainergy.com',
        'evan@example.com', 'evan@cainergy.com',
        'fiona@example.com', 'fiona@cainergy.com',
        'greg@example.com', 'greg@cainergy.com',
        'support@flowserve.com'
    );

-- Add any Users matched by username only (if contact link was missing)
INSERT INTO target_identities (user_id)
SELECT id FROM public.users 
WHERE username IN ('jdoe', 'atech', 'btech', 'ctech', 'dtech', 'esup', 'fsup', 'gplan', 'flowtest-1768991646295')
AND id NOT IN (SELECT user_id FROM target_identities WHERE user_id IS NOT NULL);


-- 2. Clean up Dependencies (Work Orders, Requests, etc)
-- Work Orders created by these users
DELETE FROM public.work_orders WHERE created_by IN (SELECT user_id FROM target_identities);

-- Service Requests requested by these users
DELETE FROM public.service_requests WHERE requester_id IN (SELECT user_id FROM target_identities);

-- Inventory Transactions performed by these users (Set to NULL or Delete? Delete likely better for mock cleanup)
DELETE FROM public.inventory_transactions WHERE performed_by IN (SELECT user_id FROM target_identities);

-- Journal Entries created by these users
DELETE FROM public.journal_entries WHERE created_by IN (SELECT user_id FROM target_identities);

-- Audit Logs (Set to NULL to preserve history if needed, or delete. Let's Set NULL to be safe on generic logs)
UPDATE public.audit_logs SET changed_by = NULL WHERE changed_by IN (SELECT user_id FROM target_identities);


-- 3. Delete the Users
DELETE FROM public.users WHERE id IN (SELECT user_id FROM target_identities WHERE user_id IS NOT NULL);

-- 4. Delete the Contacts
DELETE FROM public.contacts WHERE id IN (SELECT contact_id FROM target_identities WHERE contact_id IS NOT NULL);

-- 5. Delete Vendors from Mock Data (Flowserve)
DELETE FROM public.vendors WHERE code = 'V-FLS';

-- 6. Cleanup any orphaned users that might have been missed by the CTE but linked to deleted contacts
DELETE FROM public.users 
WHERE contact_id IS NULL 
   OR contact_id NOT IN (SELECT id FROM public.contacts);

COMMIT;
