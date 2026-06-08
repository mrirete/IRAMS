-- 0025_cleanup_duplicates.sql
-- Cleanup duplicate contacts and users from database

-- STEP 1: IDENTIFY DUPLICATES (Run these queries first to see what will be deleted)

-- Find duplicate contacts by name (keeping the one with earliest created_at)
-- SELECT name, id, code, created_at
-- FROM contacts
-- WHERE name IN (SELECT name FROM contacts GROUP BY name HAVING count(*) > 1)
-- ORDER BY name, created_at;

-- Find duplicate users by username
-- SELECT username, id, email, created_at
-- FROM users
-- WHERE username IN (SELECT username FROM users GROUP BY username HAVING count(*) > 1)
-- ORDER BY username, created_at;

-- STEP 2: CLEANUP DUPLICATE CONTACTS
-- Delete duplicate contacts, keeping the OLDEST one (first created)

-- First, remove organization_unit_members for duplicates to avoid FK constraint errors
DELETE FROM organization_unit_members
WHERE contact_id IN (
    SELECT c.id 
    FROM contacts c
    WHERE EXISTS (
        SELECT 1 FROM contacts c2 
        WHERE c2.name = c.name 
        AND c2.created_at < c.created_at
    )
);

-- Now delete the duplicate contacts (keeping oldest)
DELETE FROM contacts
WHERE id IN (
    SELECT c.id 
    FROM contacts c
    WHERE EXISTS (
        SELECT 1 FROM contacts c2 
        WHERE c2.name = c.name 
        AND c2.created_at < c.created_at
    )
);

-- STEP 3: CLEANUP DUPLICATE USERS
-- First unlink any contact associations from duplicate users
UPDATE users SET contact_id = NULL
WHERE id IN (
    SELECT u.id 
    FROM users u
    WHERE EXISTS (
        SELECT 1 FROM users u2 
        WHERE u2.username = u.username 
        AND u2.created_at < u.created_at
    )
);

-- Delete duplicate users, keeping the OLDEST one
DELETE FROM users
WHERE id IN (
    SELECT u.id 
    FROM users u
    WHERE EXISTS (
        SELECT 1 FROM users u2 
        WHERE u2.username = u.username 
        AND u2.created_at < u.created_at
    )
);

-- STEP 4: ADD UNIQUE CONSTRAINT (if not exists) to prevent future duplicates
-- Note: Only run this after cleanup. Will fail if duplicates still exist.

-- CREATE UNIQUE INDEX IF NOT EXISTS contacts_name_unique ON contacts(name);
-- Note: This is commented out because having same-name contacts may be intentional (e.g., "John Smith" could be multiple people)

-- Verify results
SELECT 'Contacts' as table_name, name, count(*) as cnt 
FROM contacts 
GROUP BY name 
HAVING count(*) > 1
UNION ALL
SELECT 'Users' as table_name, username, count(*) as cnt 
FROM users 
GROUP BY username 
HAVING count(*) > 1;
