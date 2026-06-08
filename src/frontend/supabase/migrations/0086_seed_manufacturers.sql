-- ═══════════════════════════════════════════════════════════════
-- 0086: Seed Manufacturer Contacts
-- Purpose: Add major equipment manufacturers as contacts so
--          they appear in the Manufacturer dropdown across
--          Assets, Inventory, and Purchase Orders.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO contacts (name, email, phone, code, title, roles, default_role, is_active, is_vendor, address_line_1, city, state, zip_code, country)
VALUES
    ('Flowserve',    'sales@flowserve.com',     '+1-972-443-6500',  'MFR-FLOW', 'Pumps & Seals Manufacturer',       ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, '5215 N O''Connor Blvd',       'Irving',       'TX',       '75039',  'USA'),
    ('Siemens',      'energy@siemens.com',      '+49-89-636-00',    'MFR-SIEM', 'Motors & Drives Manufacturer',     ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, 'Werner-von-Siemens-Str 1',    'Munich',       'Bavaria',  '80333',  'DEU'),
    ('SKF',          'bearings@skf.com',        '+46-31-337-1000',  'MFR-SKF',  'Bearings & Seals Manufacturer',    ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, 'Hornsgatan 1',                'Gothenburg',   '',         '415 50', 'SWE'),
    ('Caterpillar',  'energy@cat.com',          '+1-309-675-1000',  'MFR-CAT',  'Engines & Power Systems',          ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, '501 S.W. Jefferson Ave',      'Peoria',       'IL',       '61602',  'USA'),
    ('ABB',          'process@abb.com',         '+41-43-317-7111',  'MFR-ABB',  'Instrumentation & Electrical',     ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, 'Affolternstrasse 44',         'Zurich',       '',         '8050',   'CHE'),
    ('Emerson',      'automation@emerson.com',  '+1-314-553-2000',  'MFR-EMER', 'Valves & Process Automation',      ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, '8000 W Florissant Ave',       'St. Louis',    'MO',       '63136',  'USA'),
    ('Dresser-Rand', 'oilgas@dresser-rand.com', '+1-713-354-6100',  'MFR-DR',   'Compressors & Turbines',           ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, '10201 Westheimer Rd',         'Houston',      'TX',       '77042',  'USA'),
    ('Honeywell',    'industrial@honeywell.com','+1-800-328-5111',  'MFR-HON',  'Control Systems & Safety',         ARRAY['MANUFACTURER'], 'MANUFACTURER', true, true, '300 S Tryon St',              'Charlotte',    'NC',       '28202',  'USA')
ON CONFLICT (code) DO NOTHING;

-- Also seed into the vendors table for cross-module compatibility
INSERT INTO vendors (contact_id, type, payment_terms, currency, lead_time_days, is_active)
SELECT id, 'MANUFACTURER', 'NET-30', 'USD', 21, true
FROM contacts
WHERE code IN ('MFR-FLOW', 'MFR-SIEM', 'MFR-SKF', 'MFR-CAT', 'MFR-ABB', 'MFR-EMER', 'MFR-DR', 'MFR-HON')
  AND NOT EXISTS (SELECT 1 FROM vendors WHERE vendors.contact_id = contacts.id);
