-- ============================================================================
-- Migration 0234: One decision per failure mode
--
-- ers_rcm_decisions had only an INDEX on failure_mode_id — nothing stopped
-- two INSERTs racing for the same failure mode (the old auto-firing AI
-- recommender vs. a user click, or Q5 classification vs. a strategy pick
-- inside the optimistic-create window). The UI maps decisions BY failure
-- mode, so with duplicates every write could land in one row while the
-- screen read another: strategies that "kept changing", task descriptions
-- that never stuck.
--
-- 1) Merge duplicates: newest row (updated_at) wins per column, but a
--    non-null value from an older row fills any gap the newest left blank —
--    nothing a user typed is thrown away.
-- 2) Delete the older rows.
-- 3) Add the UNIQUE constraint so the client can UPSERT on failure_mode_id.
-- ============================================================================

DO $$
DECLARE
    dup RECORD;
    keeper UUID;
BEGIN
    FOR dup IN
        SELECT failure_mode_id
        FROM ers_rcm_decisions
        GROUP BY failure_mode_id
        HAVING COUNT(*) > 1
    LOOP
        -- Newest row is the keeper
        SELECT id INTO keeper
        FROM ers_rcm_decisions
        WHERE failure_mode_id = dup.failure_mode_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1;

        -- Backfill the keeper's NULL columns from the other rows, newest first
        UPDATE ers_rcm_decisions k
        SET consequence_code          = COALESCE(k.consequence_code, o.consequence_code),
            consequence_description   = COALESCE(k.consequence_description, o.consequence_description),
            is_hidden_failure         = COALESCE(k.is_hidden_failure, o.is_hidden_failure),
            recommended_strategy_code = COALESCE(k.recommended_strategy_code, o.recommended_strategy_code),
            task_description          = COALESCE(k.task_description, o.task_description),
            task_interval             = COALESCE(k.task_interval, o.task_interval),
            task_type_code            = COALESCE(k.task_type_code, o.task_type_code),
            task_owner_craft          = COALESCE(k.task_owner_craft, o.task_owner_craft),
            justification             = COALESCE(k.justification, o.justification),
            ai_recommendation         = COALESCE(k.ai_recommendation, o.ai_recommendation),
            recurring_work_id         = COALESCE(k.recurring_work_id, o.recurring_work_id)
        FROM (
            SELECT DISTINCT ON (failure_mode_id) *
            FROM ers_rcm_decisions
            WHERE failure_mode_id = dup.failure_mode_id
              AND id <> keeper
            ORDER BY failure_mode_id, updated_at DESC NULLS LAST
        ) o
        WHERE k.id = keeper;

        DELETE FROM ers_rcm_decisions
        WHERE failure_mode_id = dup.failure_mode_id
          AND id <> keeper;
    END LOOP;
END $$;

-- The constraint the client's upsert (onConflict: failure_mode_id) depends on.
ALTER TABLE ers_rcm_decisions
    DROP CONSTRAINT IF EXISTS ers_rcm_decisions_failure_mode_id_key;
ALTER TABLE ers_rcm_decisions
    ADD CONSTRAINT ers_rcm_decisions_failure_mode_id_key UNIQUE (failure_mode_id);
