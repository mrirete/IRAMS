import { describe, it, expect } from 'vitest';
import { mapOrgLevelRow, pluralLevel, unitsWithout, unitsMoved } from './orgLevels';

describe('mapOrgLevelRow', () => {
    it('reads order, colour and child level from the metadata column', () => {
        const lvl = mapOrgLevelRow({
            id: 'x', code: 'SITE', description: 'Site / Plant', sort_order: 1, color_code: '#000000',
            metadata: { sort_order: 1, color: '#3b82f6', child_type: 'DIVISION', child_label: 'Add Division' },
        });
        expect(lvl).toEqual({ id: 'x', code: 'SITE', description: 'Site / Plant', sortOrder: 1, color: '#3b82f6', childType: 'DIVISION', childLabel: 'Add Division' });
    });

    it('falls back to the plain columns when metadata is missing', () => {
        const lvl = mapOrgLevelRow({ code: 'TEAM', description: 'Team', sort_order: 5, color_code: '#6366f1', metadata: null });
        expect(lvl.sortOrder).toBe(5);
        expect(lvl.color).toBe('#6366f1');
        expect(lvl.childType).toBeNull();
    });
});

describe('pluralLevel', () => {
    it.each([
        ['Site / Plant', 'Sites / Plants'],
        ['Section / Unit', 'Sections / Units'],
        ['Team', 'Teams'],
        ['Facility', 'Facilities'],
        ['Business Unit', 'Business Units'],
        ['Branch', 'Branches'],
    ])('%s → %s', (one, many) => expect(pluralLevel(one)).toBe(many));

    it('keeps the singular for one', () => expect(pluralLevel('Division', 1)).toBe('Division'));
});

describe('unitsWithout — taking someone out of one unit', () => {
    it('keeps their primary when a secondary is removed', () => {
        expect(unitsWithout({ primaryUnitId: 'A', unitIds: ['A', 'B', 'C'] }, 'B')).toEqual(['A', 'C']);
    });
    it('promotes the next unit when the primary is removed', () => {
        expect(unitsWithout({ primaryUnitId: 'A', unitIds: ['A', 'B'] }, 'A')).toEqual(['B']);
    });
    it('empties the list when it was their only unit', () => {
        expect(unitsWithout({ primaryUnitId: 'A', unitIds: ['A'] }, 'A')).toEqual([]);
    });
    it('handles a secondary-only member (no primary)', () => {
        expect(unitsWithout({ primaryUnitId: null, unitIds: ['B', 'C'] }, 'C')).toEqual(['B']);
    });
});

describe('unitsMoved — dragging a member to another unit', () => {
    it('moving the primary keeps it primary in the new unit', () => {
        expect(unitsMoved({ primaryUnitId: 'A', unitIds: ['A', 'B'] }, 'A', 'X')).toEqual(['X', 'B']);
    });
    it('moving a secondary leaves the primary alone', () => {
        expect(unitsMoved({ primaryUnitId: 'A', unitIds: ['A', 'B'] }, 'B', 'X')).toEqual(['A', 'X']);
    });
    it('moving into a unit they already have does not duplicate it', () => {
        expect(unitsMoved({ primaryUnitId: 'A', unitIds: ['A', 'B'] }, 'B', 'A')).toEqual(['A']);
    });
});
