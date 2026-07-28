import { describe, it, expect } from 'vitest';
import { collectSubtree, parentIds } from './assetSubtree';

const A = (id: string, parent: string | null) => ({ id, parent_id: parent });

describe('collectSubtree', () => {
    const TREE = [
        A('site', null),
        A('area1', 'site'), A('area2', 'site'),
        A('pump1', 'area1'), A('pump2', 'area1'), A('comp1', 'area2'),
        A('seal1', 'pump1'),
        A('orphan', null),
    ];

    it('collects a root and all its descendants, nothing else', () => {
        expect([...collectSubtree(TREE, 'area1')].sort()).toEqual(['area1', 'pump1', 'pump2', 'seal1']);
        expect(collectSubtree(TREE, 'site').size).toBe(7);
        expect([...collectSubtree(TREE, 'pump2')]).toEqual(['pump2']);
    });

    it('survives a cycle in imported data', () => {
        const cyclic = [A('a', 'b'), A('b', 'a'), A('c', 'a')];
        const s = collectSubtree(cyclic, 'a');
        expect([...s].sort()).toEqual(['a', 'b', 'c']);
    });

    it('parentIds names exactly the assets with children', () => {
        expect([...parentIds(TREE)].sort()).toEqual(['area1', 'area2', 'pump1', 'site']);
    });
});
