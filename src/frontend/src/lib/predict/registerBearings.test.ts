/**
 * registerBearings — the three real register cases from the demo tenant.
 */
import { describe, it, expect } from 'vitest';
import { registerBearingSuggestions, classifyBearing } from './registerBearings';

const row = (tag: string, name: string, manufacturer: string | null, model: string | null) => ({ id: tag, tag, name, manufacturer, model });

describe('registerBearingSuggestions', () => {
    it('P-101-A: 6205 is in the catalog (one click); 6309 needs its datasheet orders', () => {
        const s = registerBearingSuggestions([
            row('P-101-A-BRG-DE', 'Drive End Bearing (P-101-A)', 'SKF', '6309-2RS'),
            row('P-101-A-BRG-NDE', 'Non-Drive End Bearing (P-101-A)', 'SKF', '6205-2RS'),
            row('P-101-A-IMPEL', 'Impeller (P-101-A)', null, null),
        ]);
        expect(s).toHaveLength(2);
        expect(s[0]).toMatchObject({ position: 'DE', kind: 'datasheet', designation: '6309' });
        expect(s[1]).toMatchObject({ position: 'NDE', kind: 'catalog', designation: '6205' });
    });

    it('K-601: Kingsbury tilting-pad bearings are fluid-film — no defect frequencies', () => {
        const s = registerBearingSuggestions([
            row('K-601-RADBRG', 'Radial Bearing (K-601)', 'Kingsbury', 'LEG Tilting Pad'),
            row('K-601-AXBRG', 'Thrust Bearing (K-601)', 'Kingsbury', 'LEG Thrust'),
        ]);
        expect(s.map(x => x.kind)).toEqual(['fluid-film', 'fluid-film']);
        expect(s.map(x => x.position).sort()).toEqual(['Radial', 'Thrust']);
    });

    it('a rolling thrust bearing is not mistaken for fluid-film; no model → unknown', () => {
        expect(classifyBearing(row('X-BRG', 'Thrust bearing', 'FAG', '51210')).kind).toBe('datasheet');
        expect(classifyBearing(row('K-602-RADBRG', 'Radial Bearing (K-602)', null, null)).kind).toBe('unknown');
    });
});
