-- Migration: Configurable Organization Hierarchy Levels
-- Stores ORG_LEVEL entries in dictionaries with metadata for sort_order, color, and child_label

-- Seed default organization levels (can be modified via OrgChart settings)
INSERT INTO dictionaries (type, code, description, is_locked, active, metadata) VALUES
-- Level 1: Division (Root level)
('ORG_LEVEL', 'DIVISION', 'Division', false, true, 
 '{"sort_order": 1, "color": "indigo", "child_type": "GROUP", "child_label": "Add Group"}'),

-- Level 2: Group
('ORG_LEVEL', 'GROUP', 'Group', false, true, 
 '{"sort_order": 2, "color": "blue", "child_type": "TEAM", "child_label": "Add Team"}'),

-- Level 3: Team (Leaf level - no children)
('ORG_LEVEL', 'TEAM', 'Team', false, true, 
 '{"sort_order": 3, "color": "green", "child_type": null, "child_label": null}')

ON CONFLICT (type, code) DO UPDATE SET 
    metadata = EXCLUDED.metadata,
    description = EXCLUDED.description;

-- Example: To add a new level above Division (e.g., Region):
-- INSERT INTO dictionaries (type, code, description, is_locked, active, metadata) VALUES
-- ('ORG_LEVEL', 'REGION', 'Region', false, true, 
--  '{"sort_order": 0, "color": "purple", "child_type": "DIVISION", "child_label": "Add Division"}');
-- 
-- Then update DIVISION to have sort_order: 1 (or higher).
