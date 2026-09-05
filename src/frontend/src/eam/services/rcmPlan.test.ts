import { describe, it, expect } from 'vitest';
import {
  parseIntervalText, canonicalInterval, nextDueFrom, consequenceToPriority,
  normalizeRecommendation, recommendationToDecisionUpdates, buildPMFromDecision,
  strategyProducesPM, pmCodeFor,
} from './rcmPlan';
import { canCreatePMForDecision, canGeneratePM } from './rcmReadiness';
import type { RCMDecision } from './RCMService';

const ASSET = '56a0bd92-9d57-58bc-8764-23c11d1f23e6';
const STUDY = { id: 'bf0fe8ad-0000-4000-8000-000000000000', title: 'GT-301 Driver', asset_id: ASSET };

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
  task_interval: '24 Months', task_type_code: null, task_owner_craft: 'Instrument Tech',
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
});

describe('vocabulary', () => {
  it('maps consequence to the live P1..P3 priority codes', () => {
    expect(consequenceToPriority('SAFETY_ENV')).toBe('P1');
    expect(consequenceToPriority('OPERATIONAL,REPAIR_COST')).toBe('P2');
    expect(consequenceToPriority('NON_OPERATIONAL')).toBe('P3');
    expect(consequenceToPriority(null)).toBe('P3');
  });
  it('only proactive strategies produce a PM', () => {
    expect(strategyProducesPM('PM_TIME')).toBe(true);
    expect(strategyProducesPM('COMBINATION')).toBe(true);
    expect(strategyProducesPM('RTF')).toBe(false);
    expect(strategyProducesPM('REDESIGN')).toBe(false);
    expect(strategyProducesPM(null)).toBe(false);
  });
});

describe('Specialist recommendation', () => {
  it('normalises the structured shape', () => {
    const rec = normalizeRecommendation({
      strategy: 'pm_time', task_description: '  Replace   plug ', interval_value: 24, interval_unit: 'months',
      task_owner_craft: 'Instrument Tech', justification: 'Because.', reasoning: '1. **Evident?** No.', confidence: 0.9,
    })!;
    expect(rec.strategy).toBe('PM_TIME');
    expect(rec.task_description).toBe('Replace plug');
    expect(rec.interval_value).toBe(24);
    expect(rec.interval_unit).toBe('Months');
    expect(rec.confidence).toBe(0.9);
    expect(recommendationToDecisionUpdates(rec)).toEqual({
      recommended_strategy_code: 'PM_TIME',
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
    // "12-24 months" is a range, not a cadence — left for the person to set
    expect(rec.interval_value).toBeNull();
    const upd = recommendationToDecisionUpdates(rec);
    expect(upd.task_description).toBeUndefined();
    expect(upd.task_interval).toBeUndefined();
    expect(upd.justification).toContain('SAE JA1012');
  });
  it('drops an unparseable interval instead of guessing', () => {
    const rec = normalizeRecommendation({ strategy: 'PM_CONDITION', reasoning: 'x', confidence: 0.5, suggested_interval: 'Continuous monitoring' })!;
    expect(rec.interval_value).toBeNull();
    expect(recommendationToDecisionUpdates(rec).task_interval).toBeUndefined();
  });
  it('returns null for garbage', () => {
    expect(normalizeRecommendation(null)).toBeNull();
    expect(normalizeRecommendation({ error: 'quota' })).toBeNull();
  });
});

describe('decision → PM', () => {
  it('builds a calendar PM with a first due date, P-priority and provenance', () => {
    const r = buildPMFromDecision(STUDY, decision(), 'Ignitor plug failure', new Date('2026-09-04T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meterCadence).toBe(false);
    expect(r.input).toMatchObject({
      code: pmCodeFor(STUDY.id, 'd99de698-0000-4000-8000-000000000000'),
      title: 'Replace ignitor plug and verify spark gap',
      assetId: ASSET, scheduleType: 'TIME', frequencyInterval: 24, frequencyUnit: 'Months',
      jobType: 'PM', priorityCode: 'P2',
    });
    expect(String(r.input.nextDueDate).slice(0, 10)).toBe('2028-09-04');
    expect(r.input.origin).toMatchObject({ source: 'rcm', study_id: STUDY.id, strategy_code: 'PM_TIME', consequence_code: 'OPERATIONAL' });
    expect(r.input.description).toContain('Ignitor plug failure');
  });
  it('hour cadences become READING schedules with no calendar due date', () => {
    const r = buildPMFromDecision(STUDY, decision({ task_interval: '1,700 h' }), 'Bearing wear');
    expect(r.ok && r.meterCadence).toBe(true);
    if (r.ok) { expect(r.input.scheduleType).toBe('READING'); expect(r.input.nextDueDate).toBeUndefined(); }
  });
  it('condition-based decisions are READING schedules even on calendar units', () => {
    const r = buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'PM_CONDITION' }), 'x');
    expect(r.ok && r.input.scheduleType).toBe('READING');
  });
  it('explains every refusal', () => {
    expect(buildPMFromDecision({ ...STUDY, asset_id: 'GT-301' }, decision(), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('register') });
    expect(buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'RTF' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('Run-to-Failure') });
    expect(buildPMFromDecision(STUDY, decision({ recommended_strategy_code: 'REDESIGN' }), 'x')).toMatchObject({ ok: false, reason: expect.stringContaining('Redesign') });
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
