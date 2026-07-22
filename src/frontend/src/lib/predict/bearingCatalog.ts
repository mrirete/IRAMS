/**
 * Seed catalog of common rolling-element bearings for the spectral panel's
 * bearing picker.
 *
 * Honesty rule: only the 6205 entry carries full published geometry (it is
 * the classic textbook example). The generic entries derive screening orders
 * from ball count alone and are labelled approximate. For anything that will
 * condemn a component, enter the fault orders from the manufacturer
 * datasheet ('datasheet' source) — every SKF/NSK/FAG catalog publishes them.
 */
import type { BearingSpec } from './bearingFaults';

export interface CatalogEntry {
    designation: string;
    label: string;
    spec: Omit<BearingSpec, 'position'>;
}

export const BEARING_CATALOG: CatalogEntry[] = [
    {
        designation: '6205',
        label: '6205 deep-groove (9 balls) — typical geometry',
        spec: {
            designation: '6205',
            geometry: { ballCount: 9, ballDiameterMm: 7.94, pitchDiameterMm: 39.04, contactAngleDeg: 0 },
            source: 'catalog-typical',
        },
    },
    {
        designation: 'DG-8',
        label: 'Deep-groove, 8 rolling elements (approximate)',
        spec: { designation: 'DG-8', ballCount: 8, source: 'approximate' },
    },
    {
        designation: 'DG-9',
        label: 'Deep-groove, 9 rolling elements (approximate)',
        spec: { designation: 'DG-9', ballCount: 9, source: 'approximate' },
    },
    {
        designation: 'DG-10',
        label: 'Deep-groove, 10 rolling elements (approximate)',
        spec: { designation: 'DG-10', ballCount: 10, source: 'approximate' },
    },
    {
        designation: 'ROLLER-12',
        label: 'Cylindrical roller, 12 rollers (approximate)',
        spec: { designation: 'ROLLER-12', ballCount: 12, source: 'approximate' },
    },
    {
        designation: 'ROLLER-14',
        label: 'Cylindrical roller, 14 rollers (approximate)',
        spec: { designation: 'ROLLER-14', ballCount: 14, source: 'approximate' },
    },
];
