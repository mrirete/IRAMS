import { describe, it, expect } from 'vitest';
import { classifyWoStatus, isOpenWo, isDoneWo, summarizeWoStates, normalizeStatus } from './woState';

describe('classifyWoStatus', () => {
    it('classifies the native enum', () => {
        expect(classifyWoStatus('OPEN')).toBe('open');
        expect(classifyWoStatus('WIP')).toBe('open');
        expect(classifyWoStatus('CLOSED')).toBe('done');
        expect(classifyWoStatus('TECO')).toBe('done');
        expect(classifyWoStatus('CANCELLED')).toBe('void');
    });

    it('classifies foreign CMMS vocabularies the imports actually bring', () => {
        // SAP PM
        expect(classifyWoStatus('CRTD')).toBe('open');
        expect(classifyWoStatus('REL')).toBe('open');
        expect(classifyWoStatus('CLSD')).toBe('done');
        // Maximo
        expect(classifyWoStatus('WAPPR')).toBe('open');
        expect(classifyWoStatus('INPRG')).toBe('open');
        expect(classifyWoStatus('COMP')).toBe('done');
        expect(classifyWoStatus('CAN')).toBe('void');
        // Plain-English exports
        expect(classifyWoStatus('In Progress')).toBe('open');
        expect(classifyWoStatus('on hold')).toBe('open');
        expect(classifyWoStatus('Completed')).toBe('done');
    });

    it('normalizes case, whitespace and separators', () => {
        expect(normalizeStatus('  in-progress ')).toBe('IN_PROGRESS');
        expect(classifyWoStatus('in-progress')).toBe('open');
        expect(classifyWoStatus(' Comp ')).toBe('done');
    });

    it('treats null/empty and unrecognised codes as unknown', () => {
        expect(classifyWoStatus(null)).toBe('unknown');
        expect(classifyWoStatus('')).toBe('unknown');
        expect(classifyWoStatus('ZZ_WEIRD')).toBe('unknown');
    });
});

describe('isOpenWo — the backlog rule', () => {
    it('counts genuinely open work', () => {
        expect(isOpenWo('OPEN')).toBe(true);
        expect(isOpenWo('WAPPR')).toBe(true);
    });

    it('excludes finished and voided work', () => {
        expect(isOpenWo('TECO')).toBe(false);
        expect(isOpenWo('COMP')).toBe(false);
        expect(isOpenWo('CANCELLED')).toBe(false);
        expect(isDoneWo('CANCELLED')).toBe(false); // void is not completion either
    });

    it('counts an unrecognised status as open — never silently shrinks backlog', () => {
        expect(isOpenWo('SOME_FOREIGN_CODE')).toBe(true);
    });
});

describe('summarizeWoStates', () => {
    it('buckets rows and surfaces the distinct unmapped statuses', () => {
        const s = summarizeWoStates([
            { status: 'OPEN' }, { status: 'WIP' }, { status: 'TECO' },
            { status: 'CANCELLED' }, { status: 'ZZ1' }, { status: 'zz1' }, { status: 'ZZ2' },
        ]);
        expect(s).toMatchObject({ open: 2, done: 1, void: 1, unknown: 3 });
        expect(s.unknownStatuses).toEqual(['ZZ1', 'ZZ2']); // deduped + normalized
    });

    it('reproduces the seeded fleet: 7 OPEN + 3 WIP = 10 open, 40 finished', () => {
        const rows = [
            ...Array(7).fill({ status: 'OPEN' }),
            ...Array(3).fill({ status: 'WIP' }),
            ...Array(39).fill({ status: 'TECO' }),
            { status: 'CLOSED' },
        ];
        const s = summarizeWoStates(rows);
        expect(s.open).toBe(10);
        expect(s.done).toBe(40);
        expect(s.unknown).toBe(0);
    });
});
