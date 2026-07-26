-- Migration: Seed baseline hourly rates for CONTACT_TYPE dictionary entries
-- These are editable via Admin → Dictionaries. Individual user overrides are set in Admin → User Access → Financials.
--
-- GUARDED 2026-07-25 — this migration is DEAD and has never done anything.
-- It updates reference_codes.hourly_rate filtered on reference_codes.type, but
-- that table has neither column: its discriminator is `category`, and
-- `hourly_rate` exists only on contacts/vendors. It therefore failed on every
-- database, including the origin. Labour rates come from the contact/vendor
-- records instead (see eam/lib/labourRate.ts).
-- Guarded rather than deleted so the migration sequence stays intact; it
-- skips everywhere.
DO $$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reference_codes' AND column_name = 'hourly_rate'
) THEN
    RAISE NOTICE '0054: reference_codes.hourly_rate does not exist — skipping (rates live on contacts/vendors).';
    RETURN;
END IF;

UPDATE reference_codes SET hourly_rate = 85  WHERE category = 'CONTACT_TYPE' AND code = 'TECHNICIAN';
UPDATE reference_codes SET hourly_rate = 95  WHERE category = 'CONTACT_TYPE' AND code = 'RELIABILITY_ENG';
UPDATE reference_codes SET hourly_rate = 80  WHERE category = 'CONTACT_TYPE' AND code = 'PLANNER';
UPDATE reference_codes SET hourly_rate = 90  WHERE category = 'CONTACT_TYPE' AND code = 'SUPERVISOR';
UPDATE reference_codes SET hourly_rate = 120 WHERE category = 'CONTACT_TYPE' AND code = 'VENDOR';
UPDATE reference_codes SET hourly_rate = 75  WHERE category = 'CONTACT_TYPE' AND code = 'INTERNAL';
UPDATE reference_codes SET hourly_rate = 75  WHERE category = 'CONTACT_TYPE' AND code = 'REQUESTER';
END $$;
