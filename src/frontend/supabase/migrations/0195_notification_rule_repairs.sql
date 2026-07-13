-- 0195 — Notification rule repairs: align every rule with an event the code
-- actually emits, and cover the emitted events that had no rule listening.
--
-- Audit (2026-07-12) found the live rules table had drifted from the emitters:
--   dead rules  : STOCK_ZERO (code emits STOCK_OUT), JOB_ASSIGNED (assignment
--                 notifies directly, event never emitted), PM_GENERATED (never
--                 emitted), READING_CRITICAL (no emitter — one now exists)
--   orphan events: STOCK_LOW/STOCK_OUT, WO_CREATED/WO_STATUS_CHANGE,
--                 SR_STATUS_CHANGE REJECTED/APPROVED, PM_DUE/PM_OVERDUE (new)
--
-- The canonical event list now lives in src/eam/lib/notificationEvents.ts and
-- feeds the rule-editor dropdown, so this drift class can't be re-created
-- from the UI.
-- Atomic: wrap in a txn.
BEGIN;

-- ── Inventory: STOCK_ZERO was never emitted; the code fires STOCK_OUT ───────
UPDATE notification_rules SET event_trigger = 'STOCK_OUT'
 WHERE module = 'inventory' AND event_trigger = 'STOCK_ZERO';

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'Stock Below Reorder Point',
       'Stock has fallen to or below its reorder point — review and raise a purchase requisition',
       'inventory', 'STOCK_LOW', true, 'WARNING',
       '[]'::jsonb,
       '[{"type":"ROLE","targetId":"STOREKEEPER"},{"type":"ROLE","targetId":"PLANNER"}]'::jsonb,
       '["IN_APP"]'::jsonb, 0
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE module = 'inventory' AND event_trigger = 'STOCK_LOW');

-- ── Work orders: dead JOB_ASSIGNED rule off (assignment notifies directly);
--    cover the events that DO fire ──────────────────────────────────────────
UPDATE notification_rules SET is_active = false
 WHERE module = 'workOrders' AND event_trigger = 'JOB_ASSIGNED';

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'Work Order Created',
       'A new work order was raised — review scope and planning',
       'workOrders', 'WO_CREATED', true, 'INFO',
       '[]'::jsonb,
       '[{"type":"ROLE","targetId":"PLANNER"}]'::jsonb,
       '["IN_APP"]'::jsonb, 0
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE module = 'workOrders' AND event_trigger = 'WO_CREATED');

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'WO Technically Complete — review',
       'A work order reached TECO and awaits review/settlement',
       'workOrders', 'WO_STATUS_CHANGE', true, 'INFO',
       '[{"field":"status","operator":"EQUALS","value":"TECO"}]'::jsonb,
       '[{"type":"ROLE","targetId":"PLANNER"},{"type":"ROLE","targetId":"SUPERVISOR"}]'::jsonb,
       '["IN_APP"]'::jsonb, 480
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules
   WHERE module = 'workOrders' AND event_trigger = 'WO_STATUS_CHANGE'
     AND filters @> '[{"field":"status","operator":"EQUALS","value":"TECO"}]'::jsonb);

-- ── Requests: tell the requester about APPROVED and REJECTED outcomes
--    (only the CONVERTED rule survived earlier pruning) ────────────────────
INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'WR Approved',
       'Your work request was approved',
       'requests', 'SR_STATUS_CHANGE', true, 'SUCCESS',
       '[{"field":"status","operator":"EQUALS","value":"APPROVED"}]'::jsonb,
       '[{"type":"DYNAMIC","targetId":"requester"}]'::jsonb,
       '["IN_APP"]'::jsonb, 0
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules
   WHERE module = 'requests' AND event_trigger = 'SR_STATUS_CHANGE'
     AND filters @> '[{"field":"status","operator":"EQUALS","value":"APPROVED"}]'::jsonb);

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'WR Rejected',
       'Your work request was rejected — open it to see the reviewer''s reason',
       'requests', 'SR_STATUS_CHANGE', true, 'WARNING',
       '[{"field":"status","operator":"EQUALS","value":"REJECTED"}]'::jsonb,
       '[{"type":"DYNAMIC","targetId":"requester"}]'::jsonb,
       '["IN_APP"]'::jsonb, 0
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules
   WHERE module = 'requests' AND event_trigger = 'SR_STATUS_CHANGE'
     AND filters @> '[{"field":"status","operator":"EQUALS","value":"REJECTED"}]'::jsonb);

-- ── PMs: due/overdue now flow through the rules engine (PM_DUE / PM_OVERDUE
--    emitted by triggerPMDueNotifications) instead of self-notifying the
--    page viewer. Crit-A overdue escalates to the org-chart supervisor. ─────
INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes, escalation_recipient_role)
SELECT 'PM Overdue',
       'A preventive maintenance task is past its due date — schedule immediate execution',
       'pm', 'PM_OVERDUE', true, 'CRITICAL',
       '[]'::jsonb,
       '[{"type":"ROLE","targetId":"PLANNER"},{"type":"ROLE","targetId":"SUPERVISOR"}]'::jsonb,
       '["IN_APP"]'::jsonb, 240, '__SUPERVISOR'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE module = 'pm' AND event_trigger = 'PM_OVERDUE');

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'PM Due Soon',
       'A preventive maintenance task is approaching its due date — plan resources and parts',
       'pm', 'PM_DUE', true, 'INFO',
       '[]'::jsonb,
       '[{"type":"ROLE","targetId":"PLANNER"}]'::jsonb,
       '["IN_APP"]'::jsonb, 0
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE module = 'pm' AND event_trigger = 'PM_DUE');

-- PM_GENERATED was never emitted — retire the dead rule.
UPDATE notification_rules SET is_active = false
 WHERE module = 'pm' AND event_trigger = 'PM_GENERATED';

COMMIT;
