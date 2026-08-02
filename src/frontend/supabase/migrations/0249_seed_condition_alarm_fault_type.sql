-- ════════════════════════════════════════════════════════════════════════════
-- 0249 — A fault type for machine-raised notifications
--
-- createRequest() refuses a request on a Criticality A asset without a
-- functional_failure_id (ISO 14224, DatabaseService ~L2838). Condition alarms
-- are about to raise requests instead of work orders — SAP's Notification →
-- Order split, and gap X-4 in the parity assessment — and an alarm does not
-- know a failure mode. Without a default, an alarm on the very assets that
-- matter most would raise nothing at all.
--
-- Worth recording: there are currently ZERO FAULT_TYPE rows. The fault-type
-- dropdown is empty everywhere it appears, so requests on Criticality A assets
-- already fail today, before any of this. This seeds one code; the human-facing
-- catalogue is still empty and needs a maintenance engineer to populate it
-- against the equipment classes in use. Inventing ISO 14224 failure modes here
-- would be worse than leaving the gap visible.
--
-- This code is the SAFETY NET, not the destination. The quality path is a
-- default fault type per reading definition, chosen when the point is set up —
-- reading_definitions is per-asset, so that code can be specific to the point
-- rather than generic. But an optional field still leaves blanks, and a blank
-- on a Criticality A asset is a silently missing notification. SAP does the
-- same thing: mandatory coding where it matters, defaulted for
-- machine-generated notifications.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.dictionaries (id, type, code, description, is_locked, active)
VALUES (
    gen_random_uuid(),
    'FAULT_TYPE',
    'COND_ALARM',
    'Condition alarm (auto-detected) — refine at triage',
    true,     -- locked: automation depends on this row existing
    true
)
ON CONFLICT DO NOTHING;
