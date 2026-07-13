-- 0194 — Route new work requests to the responsible work centre's crew.
--
-- The Raise Work modal already defaults a request's work_center_id from the
-- asset's responsible work centre (SAP planner-group pattern). This adds the
-- crew as a recipient of the SR_CREATED rule, so the team that owns the asset
-- is alerted directly — role-based recipients (PLANNER/SUPERVISOR via the
-- requester's org-unit walk) stay as the fallback for requests with no work
-- centre or an unmanned roster.
--
-- Recipient resolution for DYNAMIC 'workCenterCrew' / 'workCenterSupervisor'
-- lives in NotificationService (0191 work_center_members roster; the
-- supervisor variant prefers members flagged LEAD).
-- Atomic: wrap in a txn.
BEGIN;

UPDATE notification_rules
   SET recipients = recipients || '[{"type":"DYNAMIC","targetId":"workCenterCrew"}]'::jsonb
 WHERE module = 'requests'
   AND event_trigger = 'SR_CREATED'
   AND NOT recipients @> '[{"type":"DYNAMIC","targetId":"workCenterCrew"}]'::jsonb;

COMMIT;
