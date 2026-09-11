import { describe, it, expect } from 'vitest';
import { kOfNProbability, groupR, groupA, systemR, systemMTBF, systemMetrics, type EngineBlock, type EngineGroup } from './rbdEngine';

const blk = (id: string, mtbf: number, mttr = 10, groupId?: string): EngineBlock => ({ id, mtbf, mttr, groupId });

describe('rbdEngine — k-of-n is exact and heterogeneous (audit M-12)', () => {
  it('2oo3 with A=0.95 each', () => {
    expect(kOfNProbability([0.95, 0.95, 0.95], 2)).toBeCloseTo(0.99275, 6);
  });
  it('heterogeneous members are not averaged', () => {
    // P(at least 1 of {0.9, 0.5}) = 1 - 0.1*0.5 = 0.95; the averaged binomial would give 1-(0.3)^2 = 0.91
    expect(kOfNProbability([0.9, 0.5], 1)).toBeCloseTo(0.95, 9);
  });
  it('k=n is series, k=1 is parallel', () => {
    const blocks = [blk('a', 1000, 10), blk('b', 2000, 20), blk('c', 500, 5)];
    const g: EngineGroup = { id: 'g', type: 'k-of-n', blocks: ['a', 'b', 'c'], k: 3 };
    const series: EngineGroup = { ...g, type: 'series' };
    const parallel: EngineGroup = { ...g, type: 'parallel' };
    expect(groupR(g, blocks, 300)).toBeCloseTo(groupR(series, blocks, 300), 12);
    expect(groupR({ ...g, k: 1 }, blocks, 300)).toBeCloseTo(groupR(parallel, blocks, 300), 12);
    expect(groupA(g, blocks).a).toBeCloseTo(groupA(series, blocks).a, 12);
    expect(groupA({ ...g, k: 1 }, blocks).a).toBeCloseTo(groupA(parallel, blocks).a, 12);
  });
});

describe('rbdEngine — availability composition', () => {
  it('k-of-n group no longer falls through to the series product', () => {
    const blocks = [blk('a', 950, 50), blk('b', 950, 50), blk('c', 950, 50)];
    const g: EngineGroup = { id: 'g', type: 'k-of-n', blocks: ['a', 'b', 'c'], k: 2 };
    const m = systemMetrics(blocks, [g]);
    expect(m.ao).toBeCloseTo(0.99275, 5);
    expect(m.approximate).toBe(false);
  });
  it('standby availability is flagged as the parallel bound', () => {
    const blocks = [blk('a', 950, 50), blk('b', 950, 50)];
    const m = systemMetrics(blocks, [{ id: 'g', type: 'standby', blocks: ['a', 'b'] }]);
    expect(m.approximate).toBe(true);
    expect(m.ao).toBeCloseTo(1 - 0.05 * 0.05, 9);
  });
});

describe('rbdEngine — system MTBF is ∫R(t)dt, not the block average', () => {
  it('two blocks in series: 1/(1/1000 + 1/1000) = 500 h (the old average said 1000)', () => {
    const blocks = [blk('a', 1000), blk('b', 1000)];
    expect(systemMTBF(blocks, [])).toBeCloseTo(500, 0);
  });
  it('two identical blocks in parallel: 1.5 × MTBF', () => {
    const blocks = [blk('a', 1000, 10, 'g'), blk('b', 1000, 10, 'g')];
    expect(systemMTBF(blocks, [{ id: 'g', type: 'parallel', blocks: ['a', 'b'] }])).toBeCloseTo(1500, 0);
  });
  it('a 100 h block next to a 20 000 h block is not sampled every 400 h', () => {
    const blocks = [blk('a', 100), blk('b', 20000)];
    expect(systemMTBF(blocks, [])).toBeCloseTo(1 / (1 / 100 + 1 / 20000), 0);
  });
  it('cold standby of two equal units: 2 × MTBF', () => {
    const blocks = [blk('a', 1000, 10, 'g'), blk('b', 1000, 10, 'g')];
    expect(systemMTBF(blocks, [{ id: 'g', type: 'standby', blocks: ['a', 'b'] }])).toBeCloseTo(2000, 0);
  });
  it('implied MTTR keeps A = MTBF/(MTBF+MTTR)', () => {
    const blocks = [blk('a', 1000, 10), blk('b', 2000, 40)];
    const m = systemMetrics(blocks, []);
    expect(m.mtbf / (m.mtbf + m.mttr)).toBeCloseTo(m.ao, 9);
    expect(systemR(blocks, [], 0)).toBe(1);
  });
});
