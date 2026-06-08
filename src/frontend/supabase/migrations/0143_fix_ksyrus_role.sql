-- ═══════════════════════════════════════════════════════════════════
-- Migration: Fix K.Syrus User Record & Role Assignment
-- ═══════════════════════════════════════════════════════════════════
-- Problem: K.Syrus has duplicate entries in public.users:
--   1. username='k.syrus' (from auth provisioning) → roles=["TECHNICIAN"], contact_id=NULL
--   2. username='K.Syrus' (legacy/manual) → roles=["INTERNAL"], contact_id=ec970cc0...
-- The auth user (k.syrus@cainergy.com) matches entry #1 by email, which gives TECHNICIAN role.
-- The contact record has roles=["R-ENG","ELEC"] but contact_id isn't linked.
--
-- Fix: Update the auth-matched user record to have the correct role and contact link.
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Delete the orphan duplicate (K.Syrus with noemail.local)
DELETE FROM public.users
WHERE username = 'K.Syrus'
  AND email LIKE '%noemail.local%';

-- Step 2: Update the real auth-linked user to correct role + contact
UPDATE public.users
SET
    roles = '["RELIABILITY_ENG"]'::jsonb,
    contact_id = 'ec970cc0-86e9-4eee-b70f-cd4b96ea43b3',
    status = 'active'
WHERE email = 'k.syrus@cainergy.com';

-- Step 3: Also fix the contact record to use RELIABILITY_ENG consistently
UPDATE public.contacts
SET roles = ARRAY['RELIABILITY_ENG', 'ELEC']
WHERE id = 'ec970cc0-86e9-4eee-b70f-cd4b96ea43b3';
