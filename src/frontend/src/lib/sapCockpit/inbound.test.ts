/**
 * Cockpit condition history -> IREAMS reading rows.
 *
 * Built on the real templates: every sheet here starts from the header in
 * structures.ts, so if SAP's field list moves, these break.
 */
import { describe, it, expect } from 'vitest';
import {
    readCockpitSet, toReadingRows, objectOfFile, fromSapDate, fromSapTime,
    fromSapNumber, isAmbiguousNumber, assetTagOf, pointKeyOf, unitOf,
    readingTypeOf, type CockpitFile,
} from './inbound';
import { renderCsv } from './dialect';
import { structureSpec, fileNameOf, type CockpitObjectKey } from './structures';

/** A file as it sits in a downloaded folder, with rows under the real header. */
const file = (object: CockpitObjectKey, structure: string, rows: string[][], folder = true): CockpitFile => {
    const spec = structureSpec(object, structure)!;
    const objectName = { measuringPoint: 'PM - Measuring point', measurementDocument: 'PM - Measurement document', maintenancePlan: 'PM - Maintenance plan', maintenanceItem: 'PM - Maintenance item', generalTaskList: 'PM - General maintenance task list' }[object];
    return {
        name: `${folder ? `Source data for ${objectName}/` : ''}${fileNameOf(spec)}`,
        // Rows go through the codec's own writer, so a cell holding a decimal
        // comma is quoted exactly as SAP would quote it.
        text: [spec.header, ...rows.map(r => renderCsv([r]))].join('\r\n'),
    };
};

/**
 * S_HEADER row. Field order: MEAS_POINT, MEASUREMENT_POINT_TYPE, PSORT,
 * PTTXT, OBJECT_TYPE, MEAS_POINT_OBJ_NO, then LONGTEXT... with IS_COUNTER
 * 9th, CODGR 13th, ATNAM 15th, MRMIC 21st, OBJECT_KEY_EXTERN 23rd.
 */
const point = (o: { key: string; pttxt?: string; objNo?: string; extern?: string; atnam?: string; psort?: string; counter?: string; codgr?: string; range?: [string, string]; objType?: string }): string[] => {
    const c: string[] = new Array(45).fill('');
    c[0] = o.key;
    c[1] = '001';
    c[2] = o.psort ?? '';
    c[3] = o.pttxt ?? '';
    c[4] = o.objType ?? 'IEQ';
    c[5] = o.objNo ?? '';
    c[8] = o.counter ?? '';
    c[12] = o.codgr ?? '';
    c[14] = o.atnam ?? '';
    if (o.range) { c[20] = o.range[0]; c[21] = o.range[1]; }
    c[22] = o.extern ?? '';
    return c;
};

/** S_MEASUREMENT_DOCU row: doc, point, date, time, short text, read by, origin, after-action, reading, difference, valuation. */
const doc = (o: { id: string; point: string; date?: string; time?: string; text?: string; by?: string; after?: string; reading?: string; diff?: string; valuation?: string; longText?: string }): string[] => {
    const c: string[] = new Array(28).fill('');
    c[0] = o.id;
    c[1] = o.point;
    c[2] = o.date ?? '14.02.2026';
    c[3] = o.time ?? '';
    c[4] = o.text ?? '';
    c[5] = o.by ?? '';
    c[7] = o.after ?? '';
    c[8] = o.reading ?? '';
    c[9] = o.diff ?? '';
    c[10] = o.valuation ?? '';
    c[12] = o.longText ?? '';
    return c;
};

describe('values as SAP writes them', () => {
    it('reads dates in every shape SAP uses', () => {
        expect(fromSapDate('14.02.2026')).toBe('2026-02-14');
        expect(fromSapDate('2026-02-14')).toBe('2026-02-14');
        expect(fromSapDate('20260214')).toBe('2026-02-14');
        expect(fromSapDate('')).toBe('');
        expect(fromSapDate('February')).toBe('');
    });

    it('pads times and rejects nonsense', () => {
        expect(fromSapTime('7:05')).toBe('07:05:00');
        expect(fromSapTime('07:05:32')).toBe('07:05:32');
        expect(fromSapTime('')).toBe('');
    });

    it('takes a decimal comma but never guesses at a thousands separator', () => {
        expect(fromSapNumber('4,2')).toBe('4.2');
        expect(fromSapNumber('4,25')).toBe('4.25');
        expect(fromSapNumber('4,2567')).toBe('4.2567');   // four places is unambiguous
        expect(fromSapNumber('4.2')).toBe('4.2');
        expect(fromSapNumber('48210')).toBe('48210');
        // Exactly three places is the one ambiguous shape — left alone.
        expect(fromSapNumber('1,234')).toBe('1,234');
        expect(isAmbiguousNumber('1,234')).toBe(true);
        expect(isAmbiguousNumber('4,25')).toBe(false);
    });

    it('unpads an internal number and leaves a real tag alone', () => {
        expect(assetTagOf('000000000010004711')).toBe('10004711');
        expect(assetTagOf('P-101A')).toBe('P-101A');
        expect(assetTagOf('  P-101A ')).toBe('P-101A');
        // An all-zero or single-zero key keeps a digit — never becomes blank.
        expect(assetTagOf('0')).toBe('0');
        expect(assetTagOf('0000')).toBe('0');
        // A tag that merely starts with a zero is not a padded number.
        expect(assetTagOf('0012-PUMP')).toBe('0012-PUMP');
    });

    it('matches point numbers however each file pads them', () => {
        expect(pointKeyOf('000000090000001')).toBe('90000001');
        expect(pointKeyOf('90000001')).toBe('90000001');
    });

    it('translates the SAP unit keys that would read as nonsense', () => {
        expect(unitOf('MMS')).toBe('mm/s');
        expect(unitOf('GC')).toBe('°C');
        expect(unitOf('BAR')).toBe('bar');
        expect(unitOf('psi')).toBe('psi');   // unknown passes through
        expect(unitOf('')).toBe('');
    });

    it('strips the customer prefix off a characteristic', () => {
        expect(readingTypeOf('MP_VIBRATION')).toBe('VIBRATION');
        expect(readingTypeOf('ZMP_TEMPERATURE')).toBe('TEMPERATURE');
        expect(readingTypeOf('YB_HOURS')).toBe('HOURS');
    });
});

describe('finding the object a file belongs to', () => {
    it('uses the folder when the structure is ambiguous', () => {
        expect(objectOfFile('Source data for PM - Maintenance item/S_OBJ_LIST#FreeText.csv').object).toBe('maintenanceItem');
        expect(objectOfFile('Source data for PM - Maintenance plan/S_OBJ_LIST#FreeText.csv').object).toBe('maintenancePlan');
    });

    it('refuses to guess when a bare ambiguous file arrives', () => {
        expect(objectOfFile('S_OBJ_LIST#FreeText.csv')).toEqual({ object: null, ambiguous: true });
    });

    it('takes a bare file when only one object claims the structure', () => {
        expect(objectOfFile('S_HEADER#FreeText_Mandatory.csv').object).toBe('measuringPoint');
        expect(objectOfFile('notes.txt')).toEqual({ object: null, ambiguous: false });
    });
});

describe('reading a downloaded set', () => {
    it('recognises each file and reports what is not one', () => {
        const set = readCockpitSet([
            file('measuringPoint', 'S_HEADER', []),
            { name: 'Source data for PM - Measuring point/README.pdf', text: '' },
        ]);
        expect(set.sheets).toHaveLength(1);
        expect(set.sheets[0].object).toBe('measuringPoint');
        expect(set.issues[0].message).toContain('not a migration-cockpit source file');
    });

    it('checks every sheet against the key and mandatory fields SAP declared', () => {
        // A task-list operation with no VORNR: key field, blank, on one row.
        const ops = file('generalTaskList', 'S_OPERATIONS', [['30009001', '01', '', 'MNMEC-PP']]);
        const { issues } = readCockpitSet([ops]);
        expect(issues.some(i => /S_OPERATIONS\.VORNR is a key field and is blank on 1 row/.test(i.message))).toBe(true);
    });

    it('will not take an ambiguous file out of its folder', () => {
        const bare = file('maintenanceItem', 'S_OBJ_LIST', [], false);
        const set = readCockpitSet([bare]);
        expect(set.sheets).toHaveLength(0);
        expect(set.issues[0].message).toContain('more than one migration object');
    });
});

describe('points and documents together', () => {
    const points = file('measuringPoint', 'S_HEADER', [
        point({ key: '10000001', objNo: '000000000010004711', atnam: 'MP_VIBRATION', pttxt: 'DE bearing horizontal', codgr: 'YB-VAL' }),
        point({ key: '10000002', objNo: '000000000010004711', atnam: 'MP_VIBRATION', pttxt: 'NDE bearing vertical' }),
        point({ key: '10000003', extern: 'GT-301', atnam: 'YB_HOURS', pttxt: 'Running hours', counter: 'X' }),
    ]);

    it('turns a point into a definition row — no date, no value', () => {
        const { rows } = toReadingRows(readCockpitSet([points]));
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ assettag: '10004711', readingtype: 'VIBRATION', pointname: 'DE bearing horizontal' });
        expect(rows[0].date).toBeUndefined();
        expect(rows[0].value).toBeUndefined();
        expect(rows[2]).toMatchObject({ assettag: 'GT-301', readingtype: 'HOURS', counter: 'X' });
    });

    it('joins a document to its asset through the point', () => {
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '10000001', reading: '4,2', time: '07:05', text: 'Route 12', by: 'J.SMITH', valuation: 'VIBR' }),
            doc({ id: '2', point: '10000003', reading: '48210', diff: '720', date: '31.01.2026' }),
        ]);
        const { rows, skipped } = toReadingRows(readCockpitSet([points, docs]));
        expect(skipped).toBe(0);

        const reading = rows.find(r => r.value === '4.2')!;
        expect(reading).toEqual({
            assettag: '10004711', readingtype: 'VIBRATION', pointname: 'DE bearing horizontal',
            date: '2026-02-14', value: '4.2', time: '07:05:00', notes: 'Route 12',
            enteredby: 'J.SMITH', valuationcode: 'VIBR',
            sourceref: '1', sourcesystem: 'sap_pm',
        });

        const counter = rows.find(r => r.value === '48210')!;
        expect(counter).toMatchObject({ assettag: 'GT-301', readingtype: 'HOURS', date: '2026-01-31', delta: '720' });
    });

    it('keeps two points of the same type on the same asset apart', () => {
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '10000001', reading: '4.2' }),
            doc({ id: '2', point: '10000002', reading: '9.8' }),
        ]);
        const { rows } = toReadingRows(readCockpitSet([points, docs]));
        const logs = rows.filter(r => r.value);
        expect(logs.map(r => r.pointname)).toEqual(['DE bearing horizontal', 'NDE bearing vertical']);
        // Same asset, same type — only the point name tells them apart.
        expect(new Set(logs.map(r => `${r.assettag}::${r.readingtype}`)).size).toBe(1);
    });

    it('refuses documents with no point file, and says why', () => {
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '10000001', reading: '4.2' }),
        ]);
        const { rows, skipped, issues } = toReadingRows(readCockpitSet([docs]));
        expect(rows).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues[0].level).toBe('error');
        expect(issues[0].message).toContain('never an asset');
    });

    it('skips a document whose point is missing from the set', () => {
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '99999999', reading: '4.2' }),
        ]);
        const { rows, skipped, issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(rows.filter(r => r.value)).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => i.message.includes('not in this set'))).toBe(true);
    });

    it('drops a document with no date or no number, one issue per kind', () => {
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '10000001', reading: '4.2', date: 'soon' }),
            doc({ id: '2', point: '10000001', reading: '', date: '01.02.2026' }),
            doc({ id: '3', point: '10000001', reading: 'n/a', date: '01.02.2026' }),
        ]);
        const { skipped, issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(skipped).toBe(3);
        expect(issues.filter(i => i.message.includes('READING_DATE'))[0].count).toBe(1);
        expect(issues.filter(i => i.message.includes('numeric READING'))[0].count).toBe(2);
    });
});

describe('what the import will not pretend to know', () => {
    it('never turns the measurement range into an alarm band', () => {
        const points = file('measuringPoint', 'S_HEADER', [
            point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION', range: ['0.5', '8.5'] }),
        ]);
        const { rows, issues } = toReadingRows(readCockpitSet([points]));
        expect(rows[0].minwarning).toBeUndefined();
        expect(rows[0].maxwarning).toBeUndefined();
        expect(issues.some(i => i.message.includes('measurement RANGE'))).toBe(true);
    });

    it('says the template carries no unit', () => {
        const { issues } = toReadingRows(readCockpitSet([
            file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION' })]),
        ]));
        expect(issues.some(i => i.level === 'warn' && i.message.includes('no unit column'))).toBe(true);
    });

    it('names the valuation-code group a finding must be mapped through', () => {
        const { issues } = toReadingRows(readCockpitSet([
            file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION', codgr: 'YB-VAL' })]),
        ]));
        expect(issues.some(i => i.message.includes('YB-VAL'))).toBe(true);
    });

    it('flags a reading taken after a counter reset', () => {
        const points = file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'YB_HOURS', counter: 'X' })]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [doc({ id: '1', point: '1', reading: '0', after: 'X' })]);
        const { issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(issues.some(i => i.message.includes('meter change'))).toBe(true);
    });

    it('drops a point with no object and a point with no characteristic', () => {
        const points = file('measuringPoint', 'S_HEADER', [
            point({ key: '1', atnam: 'MP_VIBRATION' }),                 // no object
            point({ key: '2', objNo: '4711' }),                          // no ATNAM, no PSORT
            point({ key: '3', objNo: '4711', psort: 'BEARING_TEMP' }),   // PSORT carries it
        ]);
        const { rows, skipped, issues } = toReadingRows(readCockpitSet([points]));
        expect(skipped).toBe(2);
        expect(rows).toEqual([{ assettag: '4711', readingtype: 'BEARING_TEMP' }]);
        expect(issues.filter(i => i.level === 'error')).toHaveLength(2);
    });

    it('matches a document to its point even when the two files pad differently', () => {
        const points = file('measuringPoint', 'S_HEADER', [
            point({ key: '000000090000001', objNo: '4711', atnam: 'MP_VIBRATION', pttxt: 'DE horizontal' }),
        ]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '1', point: '90000001', reading: '4.2' }),
        ]);
        const { rows, skipped } = toReadingRows(readCockpitSet([points, docs]));
        expect(skipped).toBe(0);
        expect(rows.find(r => r.value)).toMatchObject({ assettag: '4711', pointname: 'DE horizontal' });
    });

    it('refuses a reading that could be 1.234 or 1234, and says which', () => {
        const points = file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION' })]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [doc({ id: '1', point: '1', reading: '1,234' })]);
        const { rows, skipped, issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(rows.filter(r => r.value)).toHaveLength(0);
        expect(skipped).toBe(1);
        expect(issues.some(i => i.level === 'error' && /factor of a thousand/.test(i.message))).toBe(true);
    });

    it('warns when a point number repeats, and when a document number does', () => {
        const points = file('measuringPoint', 'S_HEADER', [
            point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION', pttxt: 'DE horizontal' }),
            point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION', pttxt: 'NDE vertical' }),
        ]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '7', point: '1', reading: '4.2' }),
            doc({ id: '7', point: '1', reading: '4.4' }),
        ]);
        const { issues, rows } = toReadingRows(readCockpitSet([points, docs]));
        expect(issues.some(i => /appear more than once/.test(i.message) && /point number/.test(i.message))).toBe(true);
        expect(issues.some(i => /document number/.test(i.message))).toBe(true);
        // Later point wins, so both readings carry that name.
        expect(rows.filter(r => r.value).every(r => r.pointname === 'NDE vertical')).toBe(true);
    });

    it('warns about a blank point number, which no document can reach', () => {
        const points = file('measuringPoint', 'S_HEADER', [point({ key: '', objNo: '4711', atnam: 'MP_VIBRATION' })]);
        const { rows, issues } = toReadingRows(readCockpitSet([points]));
        expect(rows).toHaveLength(1);                       // still makes a reading point
        expect(issues.some(i => /blank MEAS_POINT/.test(i.message))).toBe(true);
    });

    it('keys each reading on its SAP document number', () => {
        const points = file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION' })]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [doc({ id: '4711003', point: '1', reading: '4.2' })]);
        const { rows, issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(rows.find(r => r.value)).toMatchObject({ sourceref: '4711003', sourcesystem: 'sap_pm' });
        // A point row is not a reading and needs no source key.
        expect(rows.find(r => !r.value)!.sourceref).toBeUndefined();
        expect(issues.some(i => /importing this download again inserts nothing/.test(i.message))).toBe(true);
    });

    it('warns about the readings a repeat import COULD duplicate', () => {
        const points = file('measuringPoint', 'S_HEADER', [point({ key: '1', objNo: '4711', atnam: 'MP_VIBRATION' })]);
        const docs = file('measurementDocument', 'S_MEASUREMENT_DOCU', [
            doc({ id: '4711003', point: '1', reading: '4.2' }),
            doc({ id: '', point: '1', reading: '4.4' }),          // no document number
        ]);
        const { issues } = toReadingRows(readCockpitSet([points, docs]));
        expect(issues.some(i => i.level === 'warn' && /1 reading\(s\) carry no MEASUREMENT_DOCUMENT/.test(i.message))).toBe(true);
        expect(issues.some(i => /inserts nothing/.test(i.message))).toBe(false);
    });

    it('takes the unit when the all-fields download carries MRNGU', () => {
        const spec = structureSpec('measuringPoint', 'S_HEADER')!;
        // The FreeText download has more columns; mapping is by field NAME, so
        // a sheet shaped differently from the template still reads.
        const withUnit: CockpitFile = {
            name: 'Source data for PM - Measuring point/S_HEADER#FreeText.csv',
            text: [
                'MEAS_POINT(k/*),MEASUREMENT_POINT_TYPE(*),OBJECT_TYPE(*),MEAS_POINT_OBJ_NO(*),ATNAM,MRNGU',
                '1,001,IEQ,4711,MP_VIBRATION,MMS',
            ].join('\r\n'),
        };
        expect(spec.header).not.toContain('MRNGU');   // not in the mandatory subset
        const { rows, issues } = toReadingRows(readCockpitSet([withUnit]));
        expect(rows[0]).toMatchObject({ assettag: '4711', readingtype: 'VIBRATION', unit: 'mm/s' });
        expect(issues.some(i => /No unit on any measuring point/.test(i.message))).toBe(false);
    });

    it('reports strategy structures in the set instead of mapping them', () => {
        const mpack = file('generalTaskList', 'S_MPACK', [['30009001', '01', '0010', 'MONWOH', '001']]);
        const { issues } = toReadingRows(readCockpitSet([mpack]));
        expect(issues.some(i => i.message.includes('S_MPACK') && i.message.includes('maintenance strategy'))).toBe(true);
    });
});
