-- 0196_rca_method_gate.sql
-- RCA: method commitment gate + per-method node ownership.
--
-- Problem this fixes: every RCA editor (fishbone, fault tree, logic tree, 5-Why)
-- read the SAME unscoped ers_rca_nodes rows for an investigation. Nothing recorded
-- which method authored a node, so switching method silently re-interpreted the
-- previous method's work — fishbone's six 6M category rows resurfaced as fault-tree
-- intermediate gate events and as bogus "WHY n" steps in the 5-Why chain. A fault
-- tree structured by 6M categories is not a fault tree.
--
-- Fix: nodes carry the method that created them, and each editor reads only its own.
-- The investigation records a *provisional* method at step 1 (advisory) and a
-- *committed* one at step 3 (locked; changing it is a deliberate, confirmed act).

BEGIN;

-- ═══════════════════════════════════════════════════════════════
--  1. Node ownership — which method authored this node
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ers_rca_nodes
  ADD COLUMN IF NOT EXISTS method TEXT
    CHECK (method IN ('five_why','fishbone','fault_tree','logic_tree','taproot','apollo'));

-- Backfill from the parent investigation: existing nodes were authored by whatever
-- method the investigation is currently on.
UPDATE ers_rca_nodes n
   SET method = i.method
  FROM ers_rca_investigations i
 WHERE n.investigation_id = i.id
   AND n.method IS NULL
   AND i.method IS NOT NULL;

-- Nodes on an investigation that never picked a method predate the choice.
-- 5-Why was the historical default editor, so that is where they belong.
UPDATE ers_rca_nodes SET method = 'five_why' WHERE method IS NULL;

CREATE INDEX IF NOT EXISTS idx_ers_rca_nodes_inv_method
  ON ers_rca_nodes(investigation_id, method);

-- Stamp method on insert from the parent investigation whenever the client omits it.
-- Belt-and-braces: a stale client bundle that doesn't send `method` still produces
-- correctly-scoped rows, so a node can never be created invisible to the very editor
-- that created it (which is precisely how "add a fishbone cause" appeared to do nothing).
CREATE OR REPLACE FUNCTION ers_rca_nodes_stamp_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.method IS NULL THEN
        SELECT i.method INTO NEW.method
          FROM ers_rca_investigations i
         WHERE i.id = NEW.investigation_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ers_rca_nodes_stamp_method ON ers_rca_nodes;
CREATE TRIGGER trg_ers_rca_nodes_stamp_method
    BEFORE INSERT ON ers_rca_nodes
    FOR EACH ROW EXECUTE FUNCTION ers_rca_nodes_stamp_method();

-- ═══════════════════════════════════════════════════════════════
--  2. Method commitment on the investigation
-- ═══════════════════════════════════════════════════════════════
--  proposed_method  — captured at step 1 from the problem definition. ADVISORY ONLY:
--                     it pre-selects the step-3 gate and tells step 2 what evidence to
--                     go collect. You cannot honestly choose a method before you have
--                     looked at the evidence, so this never binds the investigation.
--  method_locked_at — set when the investigator COMMITS at step 3. One method, one
--                     editor. Changing it afterwards requires explicit confirmation.

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS proposed_method TEXT
    CHECK (proposed_method IN ('five_why','fishbone','fault_tree','logic_tree'));

ALTER TABLE ers_rca_investigations
  ADD COLUMN IF NOT EXISTS method_locked_at TIMESTAMPTZ;

-- Investigations that already have a method AND cause nodes are committed in practice.
-- Lock them so they open straight into their editor rather than being sent back to the gate.
UPDATE ers_rca_investigations i
   SET method_locked_at = COALESCE(i.updated_at, i.created_at, NOW())
 WHERE i.method IS NOT NULL
   AND i.method_locked_at IS NULL
   AND EXISTS (SELECT 1 FROM ers_rca_nodes n WHERE n.investigation_id = i.id);

COMMIT;
