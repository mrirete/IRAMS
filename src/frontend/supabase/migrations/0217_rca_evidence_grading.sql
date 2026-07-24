-- ═══════════════════════════════════════════════════════════════
-- 0217 — RCA evidence grading + node↔evidence links
--
-- Makes Step 2 (Collect Evidence) structurally influence Step 3+:
--   1. quality_grade on evidence — the data-quality ladder, compressed
--      to 4 bands: fact > inference > opinion > hearsay. NULL = ungraded
--      (legacy items predate grading).
--   2. ers_rca_node_evidence — links a cause node to the evidence that
--      supports OR refutes it. Until now no structure connected the two.
--   3. gate_type on ers_rca_nodes — the fault-tree editor stored its
--      AND/OR gate in evidence_notes, poisoning the one field meant for
--      evidence. Backfilled, then evidence_notes cleared of gate values.
--   4. evidence_type CHECK gains 'interview' — the Step 2 UI has offered
--      an Interview button since 0080, but every insert violated the
--      CHECK and failed silently.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Quality grade ────────────────────────────────────────────
ALTER TABLE ers_rca_evidence
    ADD COLUMN IF NOT EXISTS quality_grade TEXT
    CHECK (quality_grade IN ('fact','inference','opinion','hearsay'));

-- ── 2. evidence_type: allow 'interview' ─────────────────────────
ALTER TABLE ers_rca_evidence
    DROP CONSTRAINT IF EXISTS ers_rca_evidence_evidence_type_check;
ALTER TABLE ers_rca_evidence
    ADD CONSTRAINT ers_rca_evidence_evidence_type_check
    CHECK (evidence_type IN ('photo','document','work_order','fmea',
                             'sensor_data','note','timeline_event','interview'));

-- ── 3. Node ↔ evidence links ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ers_rca_node_evidence (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id     UUID NOT NULL REFERENCES ers_rca_nodes(id)    ON DELETE CASCADE,
    evidence_id UUID NOT NULL REFERENCES ers_rca_evidence(id) ON DELETE CASCADE,
    relation    TEXT NOT NULL DEFAULT 'supports'
                CHECK (relation IN ('supports','refutes')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (node_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_rca_node_evidence_node ON ers_rca_node_evidence(node_id);
CREATE INDEX IF NOT EXISTS idx_rca_node_evidence_ev   ON ers_rca_node_evidence(evidence_id);

-- RLS: open authenticated CRUD, matching the other ers_rca_* child tables (0155).
ALTER TABLE ers_rca_node_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_ers_rca_node_evidence ON ers_rca_node_evidence;
DROP POLICY IF EXISTS auth_insert_ers_rca_node_evidence ON ers_rca_node_evidence;
DROP POLICY IF EXISTS auth_update_ers_rca_node_evidence ON ers_rca_node_evidence;
DROP POLICY IF EXISTS auth_delete_ers_rca_node_evidence ON ers_rca_node_evidence;
CREATE POLICY auth_select_ers_rca_node_evidence ON ers_rca_node_evidence
    FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_ers_rca_node_evidence ON ers_rca_node_evidence
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_ers_rca_node_evidence ON ers_rca_node_evidence
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_ers_rca_node_evidence ON ers_rca_node_evidence
    FOR DELETE TO authenticated USING (true);

-- ── 4. Rescue evidence_notes from fault-tree gate storage ───────
ALTER TABLE ers_rca_nodes
    ADD COLUMN IF NOT EXISTS gate_type TEXT
    CHECK (gate_type IN ('AND','OR'));
UPDATE ers_rca_nodes SET gate_type = evidence_notes
    WHERE evidence_notes IN ('AND','OR');
UPDATE ers_rca_nodes SET evidence_notes = NULL
    WHERE evidence_notes IN ('AND','OR');

COMMIT;
