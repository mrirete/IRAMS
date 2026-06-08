-- 0073_add_vendor_notification.sql
-- ============================================================
-- Adds vendor_recipient_id to notifications table
-- to track external vendor notification targets.
-- ============================================================

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS vendor_recipient_id TEXT;

COMMENT ON COLUMN notifications.vendor_recipient_id IS 'Vendor ID when notification targets an external vendor';
