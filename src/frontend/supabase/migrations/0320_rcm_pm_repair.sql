-- 0320: repair PMs written by the pre-0319 RCM generator
--
-- Until 2026-09-04 RCMService.generatePMSchedule hand-rolled the recurring_work
-- insert: priority_code '1'/'2'/'3' (no Work Management surface reads those —
-- the live vocabulary is P1..P4), no next_due_date (so the schedule was never
-- due and the 0304 Autopilot never took it), and the Specialist's reasoning
-- prose as the PM title. Data repair, idempotent, scoped to rows whose origin
-- says they came from RCM and that still carry the old priority vocabulary.

BEGIN;

UPDATE public.recurring_work rw
   SET priority_code = CASE rw.priority_code WHEN '1' THEN 'P1' WHEN '2' THEN 'P2' WHEN '3' THEN 'P3' ELSE rw.priority_code END,
       next_due_date = COALESCE(rw.next_due_date, CASE upper(COALESCE(rw.frequency_unit, ''))
            WHEN 'DAYS'   THEN rw.created_at + make_interval(days   => rw.frequency_interval)
            WHEN 'WEEKS'  THEN rw.created_at + make_interval(weeks  => rw.frequency_interval)
            WHEN 'MONTHS' THEN rw.created_at + make_interval(months => rw.frequency_interval)
            WHEN 'YEARS'  THEN rw.created_at + make_interval(years  => rw.frequency_interval)
            ELSE NULL END),
       -- A title that is the Specialist's essay is not a task. Replace with a
       -- labelled placeholder the planner can recognise and rewrite.
       title = CASE
            WHEN rw.title ~ '\*\*' OR rw.title ~* '^(based on|applying|ai:)' OR length(rw.title) > 120
                 THEN left('RCM task — ' || COALESCE(fm.failure_mode_description, 'failure mode'), 120)
            ELSE rw.title END,
       description = CASE
            WHEN rw.description ~ '\*\*' OR rw.description ~* 'Generated from RCM study\. Strategy:'
                 THEN 'RCM study "' || s.title || '" · Failure mode: ' || COALESCE(fm.failure_mode_description, '')
                      || E'\nStrategy: ' || COALESCE(d.recommended_strategy_code, '') || ' · Consequence: ' || COALESCE(d.consequence_code, 'unclassified')
                      || E'\n\nTask text pending — the earlier generator copied the Specialist''s reasoning here. Set the task on the study''s Strategy tab; this title is a placeholder.'
            ELSE rw.description END,
       updated_at = now()
  FROM public.ers_rcm_decisions d
  JOIN public.ers_rcm_failure_modes fm ON fm.id = d.failure_mode_id
  JOIN public.ers_rcm_functions f ON f.id = fm.function_id
  JOIN public.ers_rcm_studies s ON s.id = f.study_id
 WHERE rw.origin->>'source' = 'rcm'
   AND rw.id = d.recurring_work_id
   AND rw.priority_code IN ('1', '2', '3');

COMMIT;

-- VERIFY (after apply):
--   SELECT id, title, priority_code, next_due_date FROM recurring_work WHERE origin->>'source'='rcm';  -- expect P1..P3, due dates set
