-- 0189 — Contextual messaging, slice 1.
--
-- Every work object (work order, request, RCA, asset, work group) carries its
-- own conversation. The message thread IS part of the maintenance record —
-- append-only, searchable, and citeable later as RCA evidence. This is the
-- MaintainX-style field-team chat, but anchored to the object instead of a
-- free-floating channel, so knowledge accrues to the asset.
--
-- Two tables:
--   messages       — append-only. Insert only as yourself (sender_id =
--                    auth.uid()); NO update/delete for anyone (work-record
--                    integrity, same posture as audit trails in 0186).
--   thread_reads   — per-user last-read marker → unread counts/dots.
--
-- Realtime: added to supabase_realtime so ThreadPanel can subscribe per thread.
-- @mentions are handled app-side (insert into notifications, per 0186 RLS).
-- Atomic: wrap in a txn.
BEGIN;

CREATE TABLE IF NOT EXISTS public.messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_type  TEXT NOT NULL CHECK (thread_type IN ('work_order','service_request','rca','asset','work_center')),
  thread_id    UUID NOT NULL,                 -- id of the anchoring object
  sender_id    UUID NOT NULL,                 -- auth.users.id of the author
  sender_name  TEXT,                          -- denormalized display name (author snapshot)
  body         TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  mentions     UUID[] NOT NULL DEFAULT '{}',  -- mentioned users (auth ids)
  attachment_url  TEXT,                        -- optional entity_files link (future)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON public.messages(thread_type, thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);

CREATE TABLE IF NOT EXISTS public.thread_reads (
  user_id      UUID NOT NULL,
  thread_type  TEXT NOT NULL,
  thread_id    UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_type, thread_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_reads ENABLE ROW LEVEL SECURITY;

-- messages: everyone authenticated reads (single-tenant posture, 0171/0186);
-- you may only post AS yourself; append-only (no update/delete policies).
DROP POLICY IF EXISTS p2_select_messages ON public.messages;
CREATE POLICY p2_select_messages ON public.messages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS p2_insert_messages ON public.messages;
CREATE POLICY p2_insert_messages ON public.messages
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

-- thread_reads: strictly your own markers.
DROP POLICY IF EXISTS p2_own_thread_reads ON public.thread_reads;
CREATE POLICY p2_own_thread_reads ON public.thread_reads
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Add messages to the realtime publication (guarded — ADD TABLE errors if the
-- table is already a member, so check first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ── Catalog ────────────────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('messages', NULL, 'Contextual Messages',
   'Append-only team conversation anchored to a work object (work order, service request, RCA, asset, or work group). The thread is part of the maintenance record — permanent, searchable, and usable as RCA evidence. Field teams communicate where the work is, so knowledge accrues to the asset instead of evaporating in external chat.',
   ARRAY['collaboration','messaging'], 'Maintenance',
   ARRAY['messages','thread_reads'], 'ISO 55013:2024')
ON CONFLICT DO NOTHING;

COMMIT;
