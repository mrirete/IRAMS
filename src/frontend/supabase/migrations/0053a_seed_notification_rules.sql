-- ============================================================
-- 0053: Seed Default Notification Rules (18 EAM Best Practice Rules)
-- ============================================================

INSERT INTO notification_rules (name, description, module, event_trigger, is_active, severity, filters, recipients, channels, escalation_timeout_minutes)
VALUES
-- 1. Work Request Submitted
('WR Submitted for Review',
 'Notifies planners when a new work request is submitted for review',
 'requests', 'CREATED', true, 'INFO',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Planner"},{"type":"ROLE","targetId":"Supervisor"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 240),

-- 2. Work Request Approved
('WR Approved',
 'Notifies the requester when their work request is approved and a WO is created',
 'requests', 'APPROVED', true, 'SUCCESS',
 '[]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"requester"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 0),

-- 3. Work Request Rejected (Gatekeeper Protocol)
('WR Rejected',
 'Notifies the requester when their work request is rejected with reason',
 'requests', 'REJECTED', true, 'WARNING',
 '[]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"requester"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 0),

-- 4. Work Order Assigned
('WO Assigned to Technician',
 'Notifies the assigned technician when a work order is scheduled to them',
 'workOrders', 'ASSIGNED', true, 'INFO',
 '[]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"assignee"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 1440),

-- 5. Work Order Overdue (SLA Breach)
('WO Overdue - SLA Breach',
 'Escalates when a work order exceeds its planned completion date',
 'workOrders', 'SLA_BREACH', true, 'CRITICAL',
 '[]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"assignee"},{"type":"ROLE","targetId":"Supervisor"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 120),

-- 6. Work Order Pending TECO Review
('WO Pending Technical Completion Review',
 'Notifies planner when a work order is submitted for technical completion',
 'workOrders', 'TECH_COMPLETE', true, 'INFO',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Planner"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 480),

-- 7. Work Order Missing Failure Coding
('WO Missing Failure Coding',
 'Blocks TECO: technician must select Failure Mode, Cause, and Remedy',
 'workOrders', 'TECO_BLOCKED', true, 'WARNING',
 '[]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"assignee"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 0),

-- 8. PM Due in 7 Days
('Preventive Maintenance Due Soon',
 'Alerts planner that a scheduled PM is due within 7 days',
 'pm', 'SCHEDULE_DUE', true, 'INFO',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Planner"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 0),

-- 9. PM Overdue
('Preventive Maintenance Overdue',
 'Critical alert when a PM task has exceeded its scheduled date',
 'pm', 'SCHEDULE_OVERDUE', true, 'CRITICAL',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Supervisor"},{"type":"ROLE","targetId":"Manager"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 240),

-- 10. PO Approval Required
('Purchase Order Approval Required',
 'Notifies budget holder when a PO requires financial approval',
 'purchasing', 'APPROVAL_NEEDED', true, 'WARNING',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Budget Holder"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 480),

-- 11. PO Above Spending Limit
('PO Exceeds Spending Limit',
 'Critical alert when a PO exceeds the authorized spending threshold',
 'purchasing', 'COST_THRESHOLD', true, 'CRITICAL',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Finance"},{"type":"ROLE","targetId":"Manager"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 120),

-- 12. Stock Below Reorder Point
('Inventory Below Reorder Point',
 'Alerts storekeeper when part stock falls below minimum reorder level',
 'inventory', 'LOW_STOCK', true, 'WARNING',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Storekeeper"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 1440),

-- 13. Stock at Zero
('Inventory Stock at Zero',
 'Critical alert when a part reaches zero stock - risk of work stoppage',
 'inventory', 'ZERO_STOCK', true, 'CRITICAL',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Storekeeper"},{"type":"ROLE","targetId":"Planner"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 60),

-- 14. PTW Approval Required
('Permit to Work Approval Required',
 'Critical safety alert: PTW requires Area Authority and HSE approval',
 'safety', 'APPROVAL_NEEDED', true, 'CRITICAL',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Area Authority"},{"type":"ROLE","targetId":"HSE"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 60),

-- 15. PTW Status Change (Expired/Suspended)
('PTW Expired or Suspended',
 'Critical safety alert when a permit expires or is suspended',
 'safety', 'STATUS_CHANGE', true, 'CRITICAL',
 '[{"field":"status","operator":"EQUALS","value":"EXPIRED"}]'::jsonb,
 '[{"type":"DYNAMIC","targetId":"permitHolder"},{"type":"ROLE","targetId":"HSE"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 0),

-- 16. Criticality A Asset Failure
('Criticality A Asset Failure Reported',
 'Immediate escalation when a safety-critical asset reports a failure',
 'assets', 'FAILURE_REPORTED', true, 'CRITICAL',
 '[{"field":"criticality","operator":"EQUALS","value":"A"}]'::jsonb,
 '[{"type":"ROLE","targetId":"Reliability Engineer"},{"type":"ROLE","targetId":"Operations Manager"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 30),

-- 17. AI Recommendation Ready (HITL)
('AI Recommendation Available',
 'AI has generated an insight or recommendation for human review',
 'analytics', 'AI_INSIGHT', true, 'INFO',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Reliability Engineer"}]'::jsonb,
 '["IN_APP"]'::jsonb,
 0),

-- 18. Bad Actor Defect Elimination
('Bad Actor - Defect Elimination Task',
 'Monthly Pareto analysis identified a top-5 bad actor asset for review',
 'analytics', 'BAD_ACTOR', true, 'WARNING',
 '[]'::jsonb,
 '[{"type":"ROLE","targetId":"Reliability Engineer"}]'::jsonb,
 '["IN_APP","EMAIL"]'::jsonb,
 2880)

ON CONFLICT DO NOTHING;
