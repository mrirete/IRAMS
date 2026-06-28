-- ============================================================================
-- READ-ONLY AUDIT — Asset Register numbering health (UAT F-004 / F-009 / F-010)
--
-- SAFE TO RUN: contains only SELECTs. No data is changed.
-- Purpose: quantify how much existing master data is mis-numbered BEFORE any
-- corrective migration (the freeze-and-reconcile posture in the closeout plan).
--
-- Object-class rule (mirrors hierarchyModel.ts):
--   FLOC      = SITE, AREA, UNIT, SYSTEM, SUBSYSTEM   (should NOT carry EQ-)
--   EQUIPMENT = EQUIPMENT, COMPONENT                  (SHOULD carry EQ-)
-- ============================================================================

-- ── SECTION 1 · Register numbering health (run this first) ──────────────────
WITH classified AS (
  SELECT
    id, tag, name, hierarchy_level, equipment_number,
    CASE WHEN hierarchy_level IN ('EQUIPMENT', 'COMPONENT') THEN 'EQUIPMENT' ELSE 'FLOC' END AS object_class
  FROM assets
)
SELECT metric, count FROM (
  SELECT 1 AS ord, 'Total assets'                                          AS metric, count(*)::bigint AS count FROM classified
  UNION ALL SELECT 2, 'FLOC-class records',                               count(*) FROM classified WHERE object_class = 'FLOC'
  UNION ALL SELECT 3, 'Equipment-class records',                          count(*) FROM classified WHERE object_class = 'EQUIPMENT'
  UNION ALL SELECT 4, 'F-004 > FLOC rows WRONGLY carrying an EQ number',   count(*) FROM classified WHERE object_class = 'FLOC' AND equipment_number IS NOT NULL
  UNION ALL SELECT 5, 'F-009 > Equipment rows MISSING a number',          count(*) FROM classified WHERE object_class = 'EQUIPMENT' AND equipment_number IS NULL
  UNION ALL SELECT 6, 'equipment_number not matching EQ-NNNNNN pattern',  count(*) FROM classified WHERE equipment_number IS NOT NULL AND equipment_number !~ '^EQ-[0-9]+$'
  UNION ALL SELECT 7, 'Duplicate tags',                                   (SELECT count(*) FROM (SELECT tag FROM assets GROUP BY tag HAVING count(*) > 1) d)
) report
ORDER BY ord;

-- ── SECTION 2 · F-004 offenders — FLOC records carrying an EQ number ─────────
-- (these would be cleared / re-keyed under MoC in Phase 1)
-- SELECT id, tag, name, hierarchy_level, equipment_number
-- FROM assets
-- WHERE hierarchy_level NOT IN ('EQUIPMENT', 'COMPONENT')
--   AND equipment_number IS NOT NULL
-- ORDER BY hierarchy_level, tag;

-- ── SECTION 3 · F-009 gaps — Equipment records missing a number ──────────────
-- SELECT id, tag, name, hierarchy_level
-- FROM assets
-- WHERE hierarchy_level IN ('EQUIPMENT', 'COMPONENT')
--   AND equipment_number IS NULL
-- ORDER BY tag;

-- ── SECTION 4 · Breakdown by level (full picture) ────────────────────────────
-- SELECT hierarchy_level,
--        count(*) AS total,
--        count(equipment_number) AS with_eq_number,
--        count(*) - count(equipment_number) AS without_eq_number
-- FROM assets
-- GROUP BY hierarchy_level
-- ORDER BY hierarchy_level;
