-- ═══════════════════════════════════════════════════════════════
-- 0218 — DE tasks inherit the RCA's evidence strength
--
-- evidence_confidence (0-100) is computed from the root cause's cited
-- evidence grades (0217 ladder) when a DE task is created from an RCA.
-- NULL = unknown (legacy tasks, or tasks not born from an RCA).
-- Lets the DE board rank by how well-proven the root cause is, not
-- just by cost.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE ers_defect_elimination_tasks
    ADD COLUMN IF NOT EXISTS evidence_confidence INTEGER
    CHECK (evidence_confidence BETWEEN 0 AND 100);
