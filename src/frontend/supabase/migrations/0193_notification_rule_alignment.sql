-- 0193: Align seeded notification-rule event triggers with the events the app emits.
--
-- The 0053 seeds listened for event names the code never fires (LOW_STOCK vs the
-- emitted STOCK_LOW, CREATED vs SR_CREATED, …), so those rules were dead on
-- arrival: checkRules() matched zero candidates and dispatched nothing.
-- Canonical names are the ones NotificationService callers emit.

-- ── Inventory: code emits STOCK_LOW / STOCK_OUT ─────────────────────────────
UPDATE notification_rules SET event_trigger = 'STOCK_LOW'
 WHERE module = 'inventory' AND event_trigger = 'LOW_STOCK';

UPDATE notification_rules SET event_trigger = 'STOCK_OUT'
 WHERE module = 'inventory' AND event_trigger = 'ZERO_STOCK';

-- ── Requests: code emits SR_CREATED on submission and SR_STATUS_CHANGE on
--    transitions; approve/reject intent moves into status filters. ───────────
UPDATE notification_rules SET event_trigger = 'SR_CREATED'
 WHERE module = 'requests' AND event_trigger = 'CREATED';

UPDATE notification_rules
   SET event_trigger = 'SR_STATUS_CHANGE',
       filters = '[{"field":"status","operator":"EQUALS","value":"APPROVED"}]'::jsonb
 WHERE module = 'requests' AND event_trigger = 'APPROVED';

UPDATE notification_rules
   SET event_trigger = 'SR_STATUS_CHANGE',
       filters = '[{"field":"status","operator":"EQUALS","value":"REJECTED"}]'::jsonb
 WHERE module = 'requests' AND event_trigger = 'REJECTED';

-- Approve-and-convert skips APPROVED and lands on CONVERTED — tell the
-- requester about that outcome too.
INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'WR Converted to Work Order',
       'Notifies the requester when their work request is approved and converted to a work order',
       'requests', 'SR_STATUS_CHANGE', true, 'SUCCESS',
       '[{"field":"status","operator":"EQUALS","value":"CONVERTED"}]'::jsonb,
       '[{"type":"DYNAMIC","targetId":"requester"}]'::jsonb,
       '["IN_APP"]'::jsonb,
       0
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules
   WHERE module = 'requests' AND name = 'WR Converted to Work Order'
);

-- ── Work orders: "pending TECO review" fires on the status change to TECO ───
UPDATE notification_rules
   SET event_trigger = 'WO_STATUS_CHANGE',
       filters = '[{"field":"status","operator":"EQUALS","value":"TECO"}]'::jsonb
 WHERE module = 'workOrders' AND event_trigger = 'TECH_COMPLETE';

-- ── Readings: code emits READING_ALARM on band breaches but no rule existed,
--    so only the reading-taker's self-notification ever fired. ───────────────
INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
SELECT 'Reading Limit Breach',
       'Alerts supervisors when a meter/condition reading breaches its alarm band',
       'readings', 'READING_ALARM', true, 'WARNING',
       '[]'::jsonb,
       '[{"type":"ROLE","targetId":"Supervisor"}]'::jsonb,
       '["IN_APP"]'::jsonb,
       240
WHERE NOT EXISTS (
  SELECT 1 FROM notification_rules
   WHERE module = 'readings' AND event_trigger = 'READING_ALARM'
);
