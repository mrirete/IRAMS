import { describe, it, expect } from 'vitest';
import { implementationSteps, implementationState, readsBySensor, readsByPerson, decisionTechnology, dueState } from './rcmImplementation';

describe('implementation steps (Maintenance Plan)', () => {
  const base = { recommended_strategy_code: null as string | null, task_type_code: null as string | null };
  it('routes each strategy to its module', () => {
    expect(implementationSteps({ ...base, recommended_strategy_code: 'PM_TIME' }).map(s => s.kind)).toEqual(['PM']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'PM_CONDITION', task_type_code: 'FAILURE_FINDING' }).map(s => s.kind)).toEqual(['PM']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION', on_condition_technology: 'Thermography' }).map(s => s.kind)).toEqual(['POINT', 'PM']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION', ai_recommendation: { suggested_technology: 'Online vibration sensor' } }).map(s => s.kind)).toEqual(['POINT', 'SENSOR']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'RTF' }).map(s => s.kind)).toEqual(['SPARES']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'REDESIGN' }).map(s => s.kind)).toEqual(['WO']);
    expect(implementationSteps({ ...base, recommended_strategy_code: 'COMBINATION' })).toEqual([]);
    expect(implementationSteps(base)).toEqual([]);
    // legacy Predictive reads as Condition-Based
    expect(implementationSteps({ ...base, recommended_strategy_code: 'PM_PREDICTIVE', task_type_code: 'ON_CONDITION' })[0].kind).toBe('POINT');
  });
  it('knows a person on a round from an installed instrument', () => {
    expect(readsBySensor('Thermography')).toBe(false);
    expect(readsBySensor('Oil analysis')).toBe(false);
    expect(readsBySensor('handheld vibration meter')).toBe(false);
    expect(readsBySensor('Online vibration monitoring')).toBe(true);
    expect(readsBySensor('wireless temperature sensor')).toBe(true);
    expect(readsBySensor('DCS trend')).toBe(true);
    expect(readsBySensor(null)).toBe(false);
    expect(decisionTechnology({ recommended_strategy_code: 'PM_CONDITION', on_condition_technology: ' Oil analysis ' })).toBe('Oil analysis');
    expect(decisionTechnology({ recommended_strategy_code: 'PM_CONDITION', ai_recommendation: { suggested_technology: 'Ultrasound' } })).toBe('Ultrasound');
    expect(decisionTechnology({ recommended_strategy_code: 'PM_CONDITION' })).toBeNull();
  });
  it('gives a sensor-read decision a person until the feed exists, and keeps the round half of a mixed technology', () => {
    const cbm = { ...base, recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION' };
    // K-601 walkthrough: "online sensor" on an asset with no feed ended in Predict with no work for anyone.
    expect(implementationSteps({ ...cbm, ai_recommendation: { suggested_technology: 'online sensor (pressure, flow)' } }, { hasFeed: false }).map(s => s.kind)).toEqual(['POINT', 'SENSOR', 'PM']);
    expect(implementationSteps({ ...cbm, ai_recommendation: { suggested_technology: 'online sensor (pressure, flow)' } }, { hasFeed: true }).map(s => `${s.kind}:${s.done}`)).toEqual(['POINT:false', 'SENSOR:true']);
    // unknown feed state keeps the old shape
    expect(implementationSteps({ ...cbm, ai_recommendation: { suggested_technology: 'online sensor' } }).map(s => s.kind)).toEqual(['POINT', 'SENSOR']);
    // vibration online + oil sampling in the lab = sensor AND a round
    expect(implementationSteps({ ...cbm, ai_recommendation: { suggested_technology: 'Vibration analysis, oil analysis (online sensors for vibration/temperature, periodic lab analysis for oil)' } }, { hasFeed: true }).map(s => s.kind)).toEqual(['POINT', 'SENSOR', 'PM']);
    expect(readsByPerson('online sensor')).toBe(false);
    expect(readsByPerson('periodic lab analysis for oil')).toBe(true);
    expect(readsByPerson('Visual inspection of seal vent')).toBe(true);
    expect(readsByPerson(null)).toBe(false);
  });
  it('reads an open implementation against its due date', () => {
    const today = new Date(2026, 8, 7);
    expect(dueState('2026-09-01', 'ready', today)).toBe('overdue');
    expect(dueState('2026-09-07', 'ready', today)).toBe('due-soon');
    expect(dueState('2026-09-14', 'partial', today)).toBe('due-soon');
    expect(dueState('2026-10-07', 'ready', today)).toBe('scheduled');
    expect(dueState(null, 'ready', today)).toBe('unscheduled');
    expect(dueState('2026-09-01', 'done', today)).toBeNull();
    expect(dueState('2026-09-01', 'undecided', today)).toBeNull();
  });
  it('marks done steps and summarises the state', () => {
    const s = implementationSteps({ ...base, recommended_strategy_code: 'PM_CONDITION', task_type_code: 'ON_CONDITION', reading_definition_id: 'rd1' });
    expect(s.map(x => x.done)).toEqual([true, false]);
    expect(implementationState(s, true)).toBe('partial');
    expect(implementationState(implementationSteps({ ...base, recommended_strategy_code: 'PM_TIME', recurring_work_id: 'RCM-1' }), true)).toBe('done');
    expect(implementationState(implementationSteps({ ...base, recommended_strategy_code: 'PM_TIME' }), true)).toBe('ready');
    expect(implementationState([], false)).toBe('undecided');
    expect(implementationState(implementationSteps({ ...base, recommended_strategy_code: 'RTF' }, { sparesNamed: true }), true)).toBe('done');
  });
});
