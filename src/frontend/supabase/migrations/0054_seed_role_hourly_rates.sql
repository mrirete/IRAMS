-- Migration: Seed baseline hourly rates for CONTACT_TYPE dictionary entries
-- These are editable via Admin → Dictionaries. Individual user overrides are set in Admin → User Access → Financials.

UPDATE reference_codes SET hourly_rate = 85  WHERE type = 'CONTACT_TYPE' AND code = 'TECHNICIAN';
UPDATE reference_codes SET hourly_rate = 95  WHERE type = 'CONTACT_TYPE' AND code = 'RELIABILITY_ENG';
UPDATE reference_codes SET hourly_rate = 80  WHERE type = 'CONTACT_TYPE' AND code = 'PLANNER';
UPDATE reference_codes SET hourly_rate = 90  WHERE type = 'CONTACT_TYPE' AND code = 'SUPERVISOR';
UPDATE reference_codes SET hourly_rate = 120 WHERE type = 'CONTACT_TYPE' AND code = 'VENDOR';
UPDATE reference_codes SET hourly_rate = 75  WHERE type = 'CONTACT_TYPE' AND code = 'INTERNAL';
UPDATE reference_codes SET hourly_rate = 75  WHERE type = 'CONTACT_TYPE' AND code = 'REQUESTER';
