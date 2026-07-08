-- 0184 — ers_rca_investigations.created_by (fixes RCA creation, PGRST204).
--
-- Commit 36a3121 (fail-loud era) made createRCAInvestigation send created_by,
-- assuming the column existed — it never did (0074 base table has no audit
-- column, and 0080/0081 added created_by to OTHER tables only). Every RCA
-- create since then has been rejected with:
--   PGRST204: Could not find the 'created_by' column of 'ers_rca_investigations'
--
-- Add the column the code already sends. Nullable UUID, no FK — consistent
-- with lead_investigator (0080), and so deleting a user never breaks RCA
-- history. Atomic: wrap in a txn.
BEGIN;

ALTER TABLE public.ers_rca_investigations
  ADD COLUMN IF NOT EXISTS created_by UUID;

COMMENT ON COLUMN public.ers_rca_investigations.created_by IS
  'auth.users.id of the investigator who created this RCA (audit; no FK by design).';

COMMIT;
