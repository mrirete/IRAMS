-- 0200: notifications join the realtime publication.
--
-- The bell polled every 30s and mobile had no signal at all; `messages` was
-- the only table published (0189). Publishing `notifications` lets clients
-- subscribe to their own rows — postgres_changes respects RLS (0186:
-- recipient_id = auth.uid()), so events are delivered only to the recipient.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END $$;
