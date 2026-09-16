import { describe, it, expect } from 'vitest';
import {
  parseIntervalText, canonicalInterval, nextDueFrom, consequenceToPriority,
  normalizeRecommendation, recommendationToDecisionUpdates, buildPMFromDecision, looksLikeReasoning,
  strategyProducesPM, pmCodeFor, taskTypesFor, packageLabelFor, intervalDaysFor, briefJustification, canonicalStrategyCode, STRATEGY_CODES,
} from './rcmPlan';
import { canCreatePMForDecision, canGeneratePM } from './rcmReadiness';
import type { RCMDecision } from './RCMService';

const ASSET = '56a0bd92-9d57-58bc-8764-23c11d1f23e6';
const STUDY = { id: 'bf0fe8ad-0000-4000-8000-000000000000', title: 'GT-301 Driver', asset_id: ASSET, revision: 2 };

const decision = (over: Partial<RCMDecision> = {}): RCMDecision => ({
  id: 'd99de698-0000-4000-8000-000000000000',
  failure_mode_id: 'fm-1',
  is_hidden_failure: false,
  consequence_code: 'OPERATIONAL', consequence_description: null,
  on_condition_task: null, on_condition_interval: null, on_condition_applicable: null, on_condition_technology: null,
  scheduled_restoration_task: null, restoration_interval: null, restoration_applicable: null,
  scheduled_discard_task: null, discard_interval: null, discard_applicable: null,
  failure_finding_task: null, failure_finding_interval: null, failure_finding_applicable: null,
  recommended_strategy_code: 'PM_TIME',
  task_description: 'Replace ignitor plug and verify spark gap',
  task_interval: '24 Months', task_type_code: 'SCHEDULED_DISCARD', task_owner_craft: 'Instrument Tech',
  justification: 'Wear-out pattern.', ai_recommendation: null, recurring_work_id: null,
  spares_requirements: [], created_at: '', updated_at: '',
  ...over,
});

describe('interval parsing', () => {
  it('parses the shapes the app writes', () => {
    expect(parseIntervalText('6 Months')).toMatchObject({ n: 6, unit: 'Months' });
    expect(parseIntervalText('1,700 h')).toMatchObject({ n: 1700, unit: 'Hours' });
    expect(parseIntervalText('90 days')).toMatchObject({ n: 90, unit: 'Days' });
    expect(parseIntervalText('6 wks')).toMatchObject({ n: 6, unit: 'Weeks' });
    expect(parseIntervalText('2 years')).toMatchObject({ n: 2, unit: 'Years' });
  });
  it('refuses to invent a cadence from prose or ranges', () => {
    expect(parseIntervalText('Continuous monitoring; quarterly thermography').n).toBeNull();
    expect(parseIntervalText('Every 12-24 months or per manufacturer').n).toBeNull();
    expect(parseIntervalText('3 to 5 years').n).toBeNull();
    expect(parseIntervalText('Every 3 months').n).toBe(3);
    expect(parseIntervalText('when needed').n).toBeNull();
    expect(parseIntervalText('').n).toBeNull();
  });
  it('canonicalises to "<n> <Unit>"', () => {
    expect(canonicalInterval(6, 'Months')).toBe('6 Months');
    expect(canonicalInterval(0, 'Months')).toBeNull();
    expect(canonicalInterval(null, 'Days')).toBeNull();
  });
  it('first due date only for calendar cadences', () => {
    const from = new Date('2026-09-04T00:00:00Z');
    expect(nextDueFrom(3, 'Months', from)?.slice(0, 10)).toBe('2026-12-04');
    expect(nextDueFrom(2, 'Weeks', from)?.slice(0, 10)).toBe('2026-09-18');
    expect(nextDueFrom(500, 'Hours', from)).toBeNull();
  });
  it('strategy package label and days', () => {
    expect(packageLabelFor(6, 'Months')).toBe('6M');
    expect(packageLabelFor(2, 'Weeks')).toBe('2W');
    expect(intervalDaysFor(6, 'Months')).toBe(180);
    expect(intervalDaysFor(500, 'Hours')).toBeNull();
  });
});

describe('vocabulary', () => {
  it('maps consequence to the live P1..P3 priority codes', () => {
    expect(consequenceToPriority('SAFETY_ENV')).toBe('P1');
    expect(consequenceToPriority('OPERATIONAL,REPAIR_COST')).toBe('P2');
    expect(consequenceToPriority('NON_OPERATIONAL')).toBe('P3');
    expect(consequenceToPriority(null)).toBe('P3');
  });
  it('only proactive strategies produce a PM; Combined is retired', () => {
    expect(strategyProducesPM('PM_TIME')).toBe(true);
    expect(strategyProducesPM('PM_PREDICTIVE')).toBe(true); // legacy rows still schedule
    expect(canonicalStrategyCode('PM_PREDICTIVE')).toBe('PM_CONDITION');
    expect(canonicalStrategyCode('PM_TIME')).toBe('PM_TIME');
    expect(STRATEGY_CODES[0]).toBe('PM_CONDITION'); // JA1012 evaluates on-condition first
    expect(STRATEGY_CODES).not.toContain('PM_PREDICTIVE');
    expect(taskTypesFor('PM_PREDICTIVE')).toEqual(['ON_CONDITION', 'FAILURE_FINDING']);
    expect(normalizeRecommendation({ strategy: 'PM_PREDICTIVE', reasoning: 'x', confidence: 0.5 })!.strategy).toBe('PM_CONDITION');
    expect(strategyProducesPM('COMBINATION')).toBe(false);
    expect(strategyProducesPM('RTF')).toBe(false);
    expect(strategyProducesPM('REDESIGN')).toBe(false);
    expect(strategyProducesPM(null)).toBe(false);
  });
  it('offers the JA1012 task types that fit the strategy, failure-finding first for hidden failures', () => {
    expect(taskTypesFor('PM_TIME')).toEqual(['SCHEDULED_RESTORATION', 'SCHEDULED_DISCARD']);
    expect(taskTypesFor('PM_CONDITION', true)[0]).toBe('FAILURE_FINDING');
    expect(taskTypesFor('PM_CONDITION', false)[0]).toBe('ON_CONDITION');
    expect(taskTypesFor('RTF')).toEqual([]);
  });
  it('briefs a justification to its first sentences', () => {
    const long = 'First sentence is short. ' + 'Second sentence goes on and on about the P-F interval and the cost of failure and the consequence class. '.repeat(4);
    const b = briefJustification(long);
    expect(b.length).toBeLessThanOrEqual(281);
    expect(b.endsWith('.') || b.endsWith('…')).toBe(true);
    expect(briefJustification('**bold** text')).toBe('bold text');
  });
});

describe('Specialist recommendation', () => {
  it('normalises the structured shape', () => {
    const rec = normalizeRecommendation({
      strategy: 'pm_time', task_type: 'scheduled_discard', task_description: '  Replace   plug ', interval_value: 24, interval_unit: 'months',
      task_owner_craft: 'Instrument Tech', justification: 'Because.', reasoning: '1. **Evident?** No.', confidence: 0.9,
    })!;
    expect(rec.strategy).toBe('PM_TIME');
    expect(rec.task_type).toBe('SCHEDULED_DISCARD');
    expect(rec.task_description).toBe('Replace plug');
    expect(rec.interval_value).toBe(24);
    expect(rec.interval_unit).toBe('Months');
    expect(rec.confidence).toBe(0.9);
    expect(recommendationToDecisionUpdates(rec)).toEqual({
      recommended_strategy_code: 'PM_TIME',
      task_type_code: 'SCHEDULED_DISCARD',
      task_description: 'Replace plug',
      task_interval: '24 Months',
      task_owner_craft: 'Instrument Tech',
      justification: 'Because.',
    });
  });
  it('tolerates the legacy prose-only shape and never copies reasoning into the task', () => {
    const rec = normalizeRecommendation({
      strategy: 'PM_TIME', reasoning: 'Based on the SAE JA1012 decision logic…', confidence: 95,
      suggested_interval: 'Every 12-24 months or per manufacturer recommendation',
    })!;
    expect(rec.task_description).toBeNull();
    expect(rec.confidence).toBe(0.95);
    expect(rec.interval_value).toBeNull();
    const upd = recommendationToDecisionUpdates(rec);
    expect(upd.task_description).toBeUndefined();
    expect(upd.task_interval).toBeUndefined();
    expect(upd.justification).toContain('SAE JA1012');
  });
  it('files an essay written into the task line as justification and leaves the task blank', () => {
    const essay = "Applying SAE JA1012 decision logic:\n\n1. **Consequence Analysis:** The failure mode 'Fuel Control Valve stuck closed' leads to a 'System Effect' of the gas turbine failing to start, and a plant effect of lost generation.";
    const rec = normalizeRecommendation({ strategy: 'PM_TIME', task_description: essay, interval_value: 3, interval_unit: 'months', confidence: 0.95 })!;
    expect(rec.task_description).toBeNull();
    expect(rec.justification).toBe(essay);
    const upd = recommendationToDecisionUpdates(rec);
    expect(upd.task_description).toBeUndefined();
    expect(upd.justification).toBe(essay);
    // An explicit justification wins; the essay is simply dropped from the task.
    const rec2 = normalizeRecommendation({ strategy: 'PM_TIME', task_description: essay, justification: 'Because.', confidence: 0.9 })!;
    expect(rec2.task_description).toBeNull();
    expect(rec2.justification).toBe('Because.');
    // A real one-line task is untouched.
    expect(looksLikeReasoning('Replace ignitor plug and verify spark gap 2.0 mm')).toBe(false);
    expect(looksLikeReasoning('Inspect valve. Clean seat. Test stroke.')).toBe(false);
  });
  it('drops a retired Combined strategy and an unparseable interval instead of guessing', () => {
    const rec = normalizeRecommendation({ strategy: 'COMBINATION', reasoning: 'x', confidence: 0.5, suggested_interval: 'Continuous monitoring' })!;
    expect(rec.strategy).toBe('');
    expect(rec.interval_value).toBeNull();
    const upd = recommendationToDecisionUpdates(rec);
    expect(upd.recommended_strategy_code).toBeUndefined();
    expect(upd.task_interval).toBeUndefined();
  });
  it('ignores a task type that does not fit the strategy', () => {
    const rec = normalizeRecommendation({ strategy: 'PM_TIME', task_type: 'ON_CONDITION', reasoning: 'x', confidence: 0.5 })!;
    expect(recommendationToDecisionUpdates(rec).task_type_code).toBeUndefined();
  });
  it('returns null for garbage', () => {
    expect(normalizeRecommendation(null)).toBeNull();
    expect(normalizeRecommendation({ error: 'quota' })).toBeNull();
  });
});

describe('decision → PM', () => {
  it('builds a calendar PM with a first due date, P-priority, job plan and provenance', () => {
    const r = buildPMFromDecision(STUDY, decision({ spares_requirements: [{ part_number: 'IGN-01', description: 'Ignitor plug', qty: 2 }] }), 'Ignitor plug failure', {
      now: new Date('2026-09-04T00:00:00Z'),
      spares: [{ part_number: 'IGN-01', description: 'Ignitor plug', qty: 2, inventoryId: 'inv-1' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meterCadence).toBe(false);
    expect(r.packageLabel).toBe('24M');
    expect(r.intervalDays).toBe(720);
    expect(r.input).toMatchObject({
      code: pmCodeFor(STUDY.id, 'd99de698-0000-4000-8000-000000000000'),
      title: 'Replace ignitor plug and verify spark gap',
      assetId: ASSET, scheduleType: 'TIME', frequencyInterval: 24, frequencyUnit: 'Months',
      jobType: 'PM', priorityCode: 'P2',
    });
    expect(String(r.input.nextDueDate).slice(0, 10)).toBe('2028-09-04');
    expect(r.input.origin).toMatchObject({ source: 'rcm', study_id: STUDY.id, study_revision: 2, strategy_code: 'PM_TIME', task_type_code: 'SCHEDULED_DISCARD', consequence_code: 'OPERATIONAL' });
    expect(r.input.description).toContain('Ignitor plug failure');
    // 0367: the job text is short; the study reference and revision are provenance (origin)
    expect(r.input.description).toMatch(/^Prevents: /);
    expect(r.input.description).not.toContain('RCM study');
    expect((r.input.origin as any).study_revision).toBe(2);
    expect(r.input.description).toContain('Scheduled discard');
    const t = r.input.templates as { tasks: unknown[]; labor: { contactType: string }[]; inventory: { inventoryId: string | null; estQty: number }[] };
    expect(t.tasks).toHaveLength(1);
    expect(t.labor[0].contactType).toBe('Instrument Tech');
    expect(t.inventory[0]).toMatchObject({ inventoryId: 'inv-1', estQty: 2 });
  });
  it('keeps the PM description short even when the justification is an essay', () => {
    const essay = 'Applying SAE JA1012 decision logic: 1. **Consequence Analysis:** '.repeat(40);
    const r = buildPMFromDecision(STUDY, decision({ justification: essay }), 'x');
    expect(r.ok && r.input.description!.length).toBeLessThan(520);
    expect(r.ok && r.input.description).not.toContain('**');
  });
  it('a Task Library plan supplies the steps and roles', () => {
    const r = buildPMFromDecision(STUDY, decision(), 'x', {
      jobPlan: { id: 'tl-1', title: 'Ignitor service', estimatedHours: 3, instructions: [{ type: 'TEXT', text: 'Isolate' }], roles: [{ contactType: 'INST', hours: 3 }], inventory: [{ inventoryId: 'inv-9', description: 'Gasket', qty: 1 }] },
    });
    if (!r.ok) throw new Error(r.reason);
    const t = r.input.templates as { tasks: { instructions: unknown[] }[]; labor: { contactType: string }[]; inventory: { inventoryId: string | null }[] };
    expect(t.tasks[0].instructions).toHaveLength(1);
    expect(t.labor[0].contactType).toBe('INST');
    expect(t.inventory[0].inventoryId).toBe('inv-9');
    expect(r.input.estDuration).toBe(3);
    expect(r.input.origin).toMatchObject({ job_plan_id: 'tl-1' });
  });
  it('hour cadences become READING schedules with no calendar due date or package', () => {
    const r = buildPMFromDecision(STUDY, decision({ task_interval: '1,700 h' }), 'Bearing wear');
    expect(r.ok && r.meterCadence).toBe(true);
    if (r.ok) { expect(r.input.scheduleType).toBe('READING'); expect(r.input.nextDueDate).toBeUndefined(); expect(r.packageLabel).toBeNull(); }
  });
  it('condition-based decisions are READING schedules even on calendar units — unless a person takes the reading', () => {
    const r = buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION' }), 'x');
    expect(r.ok && r.input.scheduleType).toBe('READING');
    // K-601 walkthrough: a daily seal-panel check on an asset with no feed was a
    // READING PM with no due date — a work order nobody would ever receive.
    const p = buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION', task_interval: '1 Days' }), 'x', { readByPerson: true });
    expect(p.ok && p.input.scheduleType).toBe('TIME');
    if (p.ok) expect(p.input.nextDueDate).toBeTruthy();
    // a meter cadence stays reading-served whoever reads it
    const m = buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION', task_interval: '500 h' }), 'x', { readByPerson: true });
    expect(m.ok && m.input.scheduleType).toBe('READING');
  });
  it('explains every refusal', () => {
    expect(buildPMFromDecision({ ...STUDY, asset_id: 'GT-301' }, decision(), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('register') });
    expect(buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'RTF' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('Run-to-Failure') });
    expect(buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'REDESIGN' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('Redesign') });
    expect(buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'COMBINATION' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('retired') });
    expect(buildPMFromDecision(STUDY, decision({ task_description: '' }), 'x')).toMatchObject({ ok: false, reason: 'no task description' });
    expect(buildPMFromDecision(STUDY, decision({ task_interval: 'Every 12-24 months or per OEM, whichever first' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('interval') });
    expect(buildPMFromDecision(STUDY, decision({ task_interval: 'Continuous monitoring' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('interval') });
    expect(buildPMFromDecision(STUDY, decision({ recurring_work_id: 'RCM-1-2' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('RCM-1-2') });
  });
  it('long task text is trimmed into the title but kept in the description', () => {
    const long = 'Inspect '.repeat(30).trim();
    const r = buildPMFromDecision(STUDY, decision({ task_description: long }), 'x');
    if (r.ok) { expect(r.input.title.length).toBeLessThanOrEqual(120); expect(r.input.title.endsWith('…')).toBe(true); }
  });
});

describe('gates', () => {
  it('per-decision gate names what is missing', () => {
    expect(canCreatePMForDecision(ASSET, decision()).ok).toBe(true);
    const g = canCreatePMForDecision('GT-301', decision({ task_interval: 'when needed', task_description: '' }));
    expect(g.ok).toBe(false);
    expect(g.missing).toEqual(['Asset linked from the register', 'Task description', 'Interval (value + unit)']);
    expect(canCreatePMForDecision(ASSET, decision({ recommended_strategy_code: 'RTF' })).missing[0]).toContain('Run-to-Failure');
    expect(canCreatePMForDecision(ASSET, decision({ recommended_strategy_code: 'COMBINATION' })).missing[0]).toContain('retired');
    expect(canCreatePMForDecision(ASSET, decision({ recurring_work_id: 'RCM-a-b' })).reason).toContain('RCM-a-b');
    expect(canCreatePMForDecision(ASSET, undefined).missing).toContain('A strategy chosen');
  });
  it('study gate counts only ready decisions', () => {
    const ok = canGeneratePM(ASSET, [decision(), decision({ id: 'x', recommended_strategy_code: 'RTF' }), decision({ id: 'y', task_interval: 'prose' })]);
    expect(ok.ok).toBe(true);
    expect(ok.reason).toContain('1 PM task');
    expect(canGeneratePM(ASSET, [decision({ recurring_work_id: 'RCM-1' })]).ok).toBe(false);
    expect(canGeneratePM(null, [decision()]).missing[0]).toContain('register');
  });
});
