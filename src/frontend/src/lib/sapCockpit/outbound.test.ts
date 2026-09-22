/**
 * IREAMS -> cockpit source data, and the loop closed.
 *
 * The decisive test is the round trip at the end: what this builder writes,
 * the inbound reader must read back as the same points, readings, schedules
 * and steps. If the two halves ever disagree on the cockpit's shape, that
 * test is where it shows.
 */
import { describe, it, expect } from 'vitest';
import { buildCockpitExport, defaultExportParams, exportZipEntries, studiesIn, type CockpitExportParams } from './outbound';
import { readCockpitSet, toReadingRows } from './inbound';
import { toStrategyRows } from './strategy';
import { buildZip, readZip } from './zip';
import { structureSpec } from './structures';
import type { SapLoadSource } from '../sapLoad/build';

const PARAMS: CockpitExportParams = { ...defaultExportParams(), planningPlant: '102A', plant: '102A', orderType: 'PM01' };

function fixture(): SapLoadSource {
    return {
        assets: [
            { id: 'floc', tag: 'SYS-300-BLR', name: 'Boiler system', parent_id: null, hierarchy_level: 'SYSTEM', criticality: 'B', equipment_number: null, company_id: 'co' },
            { id: 'pump', tag: 'P-101A', name: 'Feed pump', parent_id: 'floc', hierarchy_level: 'EQUIPMENT', criticality: 'A', equipment_number: '10004711', company_id: 'co' },
            { id: 'fan', tag: 'FAN-301', name: 'Primary air fan', parent_id: 'floc', hierarchy_level: 'EQUIPMENT', criticality: 'B', equipment_number: '10004712', company_id: 'co' },
        ] as SapLoadSource['assets'],
        assetFinancials: [], inventoryItems: [{ id: 'inv1', part_number: 'SEAL-2201', material_number: 'MAT-000123', description: 'Mechanical seal', type: 'SPARE', uom: 'EA', is_active: true, unit_cost: 120 }] as SapLoadSource['inventoryItems'],
        stock: [], stores: [], bomLines: [],
        readingDefinitions: [
            // Created in IREAMS: new to SAP.
            { id: 'd-vib', asset_id: 'pump', reading_type_code: 'VIBRATION', name: 'DE bearing horizontal', unit: 'mm/s', category: 'CONDITION', max_warning: 7.1, is_active: true },
            { id: 'd-hrs', asset_id: 'pump', reading_type_code: 'HOURS', name: 'Running hours', unit: 'h', category: 'METER', is_active: true },
            // Came from SAP: SAP has it as 90000001.
            { id: 'd-sap', asset_id: 'fan', reading_type_code: 'VIBRATION', name: 'NDE vertical', unit: 'mm/s', category: 'CONDITION', is_active: true, source_system: 'sap_pm', source_ref: '90000001' },
            { id: 'd-off', asset_id: 'pump', reading_type_code: 'TEMPERATURE', name: 'Old point', is_active: false },
        ],
        readingLogs: [
            { id: 'l1', definition_id: 'd-vib', asset_id: 'pump', reading_date: '2026-02-14', reading_time: '07:05', reading_value: 4.2, entered_by: 'j.tech', comments: 'Route 12', valuation_code: 'VIBR' },
            { id: 'l2', definition_id: 'd-hrs', asset_id: 'pump', reading_date: '2026-01-31', reading_value: 48210, delta: 720 },
            // On the SAP point, taken in IREAMS: new reading on a point SAP knows.
            { id: 'l3', definition_id: 'd-sap', asset_id: 'fan', reading_date: '2026-03-01', reading_value: 9.8 },
            // Came from SAP: not loaded back.
            { id: 'l4', definition_id: 'd-sap', asset_id: 'fan', reading_date: '2026-02-14', reading_value: 9.1, source_system: 'sap_pm', source_ref: '4711003' },
        ],
        vendors: [], costCenters: [], companies: [], workCenters: [{ id: 'wc1', code: 'MNMEC-PP' }],
        workOrders: [], woFailureData: [], users: [],
        schedules: [
            // New in IREAMS, from an RCM study: two steps and a planned part.
            {
                id: 'pm-new', code: 'PM-P101A-R01', title: 'Feed pump monthly service', status: 'ACTIVE', active: true,
                asset_id: 'pump', assigned_assets: [{ assetId: 'pump' }, { assetId: 'fan' }],
                schedule_type: 'TIME', frequency_interval: 1, frequency_unit: 'Months', next_due_date: '2026-03-01',
                job_type: 'PM', priority_code: 'HIGH', work_center_id: 'wc1',
                templates: {
                    tasks: [{ id: 't1', sequence: 1, description: 'Check bearing temperature', estHours: 0.5 }, { id: 't2', sequence: 2, description: 'Replace mechanical seal', estHours: 4 }],
                    inventory: [{ id: 'i1', inventoryId: 'inv1', description: 'Mechanical seal', uom: 'EA', estQty: 2, estUnitCost: 120, jobTaskId: 't2' }],
                },
            },
            // Came from SAP, cadence changed by a study: SAP already has it.
            {
                id: 'pm-sap', code: '1000/0010', title: 'Fan service', status: 'ACTIVE', active: true, asset_id: 'fan',
                schedule_type: 'TIME', frequency_interval: 4, frequency_unit: 'Months', next_due_date: '2026-04-01', job_type: 'PM',
                origin: { source: 'sap_pm', plan: '1000', item: '0010', task_list: '30009001/01' },
                templates: { tasks: [{ id: 't9', sequence: 1, description: 'Grease bearings', estHours: 1 }] },
            },
        ],
    };
}

const fileOf = (x: ReturnType<typeof buildCockpitExport>, structure: string) => x.files.find(f => f.structure === structure);
const rowsOf = (text: string) => text.split('\r\n').slice(1);

describe('files in the cockpit’s own shape', () => {
    it('writes every file under the cockpit’s folder with the registry header, verbatim', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        for (const f of x.files) {
            const spec = structureSpec(f.object, f.structure)!;
            expect(f.text.split('\r\n')[0]).toBe(spec.header);
            expect(f.folder).toMatch(/^Source data for PM - /);
            expect(f.fileName).toBe(`${spec.structure}#${spec.mode}.csv`);
        }
    });

    it('exports a new point on equipment, keyed on the IREAMS id, with type and object', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        const rows = rowsOf(fileOf(x, 'S_HEADER')!.text);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatch(/^d-vib,,,DE bearing horizontal,IEQ,10004711,/);
        expect(rows[0]).toContain(',VIBRATION,');
        expect(rows[1]).toMatch(/^d-hrs,,,Running hours,IEQ,10004711,/);
        expect(rows[1]).toContain(',X,');                       // IS_COUNTER
    });

    it('exports readings against the point key SAP will know — its SAP number when it has one', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        const rows = rowsOf(fileOf(x, 'S_MEASUREMENT_DOCU')!.text);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toBe('l1,d-vib,14.02.2026,07:05:00,Route 12,j.tech,,,4.2,,VIBR,,,,,,,,,,,,,,,,,');
        expect(rows[1]).toMatch(/^l2,d-hrs,31.01.2026,,,,,,48210,720,/);
        // Taken in IREAMS on a point SAP already has: loaded, against SAP's point number.
        expect(rows[2]).toMatch(/^l3,90000001,01.03.2026,/);
    });

    it('turns a new schedule into a task list, a plan and an item that reference each other', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        const hdr = rowsOf(fileOf(x, 'S_TASKLIST_HDR')!.text);
        const ops = rowsOf(fileOf(x, 'S_OPERATIONS')!.text);
        const comps = rowsOf(fileOf(x, 'S_COMPONENTS')!.text);
        const plan = rowsOf(fileOf(x, 'S_MPLA')!.text);
        const item = rowsOf(fileOf(x, 'S_MPOS')!.text);
        const objl = rowsOf(fileOf(x, 'S_OBJ_LIST')!.text);

        expect(hdr).toEqual(['IR000001,01,,,Feed pump monthly service,102A,MNMEC-PP,,4,4,,,,,']);
        expect(ops[0]).toMatch(/^IR000001,01,0010,MNMEC-PP,102A,PM01,Check bearing temperature,,,,,0.5,H,,1,/);
        expect(ops[1]).toMatch(/^IR000001,01,0020,MNMEC-PP,102A,PM01,Replace mechanical seal,,,,,4,H,,1,/);
        expect(comps).toEqual(['IR000001,01,0020,MAT-000123,2,EA,,,']);   // the part sits on the step it was planned for
        expect(plan).toEqual(['PM-P101A-R01,,PM,,Feed pump monthly service,,,,,,,,,,,,,01.02.2026,,,,,1,,MON,,,']);
        expect(item[0]).toMatch(/^PM-P101A-R01,0010,Feed pump monthly service,,10004711,,102A,PM01,,MNMEC-PP,102A,,002,,2,/);
        expect(item[0]).toMatch(/,A,IR000001,01,,,$/);
        expect(objl).toEqual(['PM-P101A-R01,0010,1,,,,10004712,,']);   // the second assigned asset
    });

    it('a functional-location schedule lands in TPLNR, not EQUNR', () => {
        const src = fixture();
        src.schedules = [{ ...src.schedules![0], asset_id: 'floc', assigned_assets: [{ assetId: 'floc' }], templates: {} }];
        const x = buildCockpitExport(src, PARAMS);
        const item = rowsOf(fileOf(x, 'S_MPOS')!.text)[0];
        expect(item).toMatch(/^PM-P101A-R01,0010,Feed pump monthly service,SYS-300-BLR,,,102A,/);
        expect(fileOf(x, 'S_TASKLIST_HDR')).toBeUndefined();         // no steps, no task list
    });
});

describe('delta by identity', () => {
    it('does not load again what came from SAP, and says so', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        expect(x.alreadyInSap).toEqual({ points: 1, readings: 1, schedules: 1 });
        const points = rowsOf(fileOf(x, 'S_HEADER')!.text);
        expect(points.some(r => r.startsWith('90000001'))).toBe(false);
        const docs = rowsOf(fileOf(x, 'S_MEASUREMENT_DOCU')!.text);
        expect(docs.some(r => r.startsWith('4711003'))).toBe(false);
        expect(rowsOf(fileOf(x, 'S_MPLA')!.text)).toHaveLength(1);
    });

    it('a SAP schedule nothing changed is in sync and not handed over', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        expect(x.handover).toBeNull();
        expect(x.inSyncSchedules).toBe(1);
        expect(x.issues.some(i => /1 schedule\(s\) SAP already has are in sync/.test(i.message))).toBe(true);
    });

    const revised = (): SapLoadSource => {
        const src = fixture();
        src.schedules![1] = {
            ...src.schedules![1],
            origin: {
                ...src.schedules![1].origin, source: 'rcm', study_id: 'st-1', study_title: 'Fan RCM',
                interval_revisions: [{ proposal_id: 'p1', recommendation_type: 'extend_interval', from_interval: 3, from_unit: 'Months', to_days: 120, basis: 'Weibull B10', applied_at: '2026-09-20T10:00:00Z', applied_by: 'j.rel' }],
            },
        };
        return src;
    };

    it('hands over a changed SAP schedule with what SAP has, what IREAMS has, and why', () => {
        const x = buildCockpitExport(revised(), PARAMS);
        expect(x.handover).not.toBeNull();
        const [header, row] = x.handover!.text.split('\r\n');
        expect(header).toBe('IREAMS_CODE,TITLE,WARPL,WPPOS,PLNNR_PLNAL,OBJECT,SAP_CYCLE,IREAMS_CYCLE,CHANGES,STUDY,STEPS,NEXT_DUE,LAST_SENT,NOTE');
        expect(row).toMatch(/^1000\/0010,Fan service,1000,0010,30009001\/01,10004712,3 Months,4 Months,"3 Months → 120 days \(extend interval, Weibull B10\) on 2026-09-20",Fan RCM,1,01.04.2026,,/);
        expect(x.changes).toHaveLength(1);
        expect(x.changes[0]).toMatchObject({ state: 'changed', sap: { plan: '1000', item: '0010' } });
        expect(x.sentScheduleIds).toEqual(['pm-new', 'pm-sap']);
    });

    it('once a planner confirms the change in SAP, the schedule drops out of the hand-over', () => {
        const src = revised();
        src.schedules![1].origin = { ...src.schedules![1].origin, sap_sync: { sent_at: '2026-09-21T08:00:00Z', confirmed_at: '2026-09-21T09:00:00Z' } };
        const x = buildCockpitExport(src, PARAMS);
        expect(x.handover).toBeNull();
        expect(x.inSyncSchedules).toBe(1);
        expect(x.sentScheduleIds).toEqual(['pm-new']);
    });

    it('full mode loads everything, keyed on the SAP numbers where they exist', () => {
        const x = buildCockpitExport(fixture(), { ...PARAMS, mode: 'full' });
        expect(x.alreadyInSap).toEqual({ points: 0, readings: 0, schedules: 0 });
        expect(x.handover).toBeNull();
        expect(rowsOf(fileOf(x, 'S_HEADER')!.text)).toHaveLength(3);
        expect(rowsOf(fileOf(x, 'S_MEASUREMENT_DOCU')!.text)).toHaveLength(4);
        // The SAP-origin schedule keeps its task-list key rather than getting a generated one.
        expect(rowsOf(fileOf(x, 'S_TASKLIST_HDR')!.text).some(r => r.startsWith('30009001,01,'))).toBe(true);
        expect(rowsOf(fileOf(x, 'S_MPLA')!.text).some(r => r.startsWith('1000,'))).toBe(true);
    });
});

describe('sending one study’s outcome', () => {
    const withStudies = (): SapLoadSource => {
        const src = fixture();
        src.schedules = [
            { ...src.schedules![0], id: 'pm-rcm-1', code: 'PM-RCM-1', origin: { source: 'rcm', study_id: 'st-1', study_title: 'K-601 compressor RCM', study_revision: 2 } },
            { ...src.schedules![0], id: 'pm-rcm-2', code: 'PM-RCM-2', origin: { source: 'rcm', study_id: 'st-1', study_title: 'K-601 compressor RCM', study_revision: 2 } },
            { ...src.schedules![0], id: 'pm-wb', code: 'PM-WB', origin: { source: 'weibull_analysis', beta: 2.1 } },
            src.schedules![1],   // came from SAP
        ];
        return src;
    };

    it('lists the studies from the schedules’ own provenance', () => {
        expect(studiesIn(withStudies())).toEqual([
            { key: 'study:st-1', label: 'K-601 compressor RCM (rev 2)', schedules: 2, scope: { studyId: 'st-1' } },
            { key: 'source:weibull_analysis', label: 'Weibull analyses (schedules created from fits)', schedules: 1, scope: { source: 'weibull_analysis' } },
        ]);
    });

    it('sends only that study’s schedules, and no condition data', () => {
        const x = buildCockpitExport(withStudies(), { ...PARAMS, scope: { studyId: 'st-1' } });
        expect(rowsOf(fileOf(x, 'S_MPLA')!.text).map(r => r.split(',')[0])).toEqual(['PM-RCM-1', 'PM-RCM-2']);
        expect(fileOf(x, 'S_HEADER')).toBeUndefined();
        expect(fileOf(x, 'S_MEASUREMENT_DOCU')).toBeUndefined();
        expect(x.handover).toBeNull();                 // the SAP-origin schedule is outside the study
    });

    it('a Weibull-derived group is a scope too', () => {
        const x = buildCockpitExport(withStudies(), { ...PARAMS, scope: { source: 'weibull_analysis' } });
        expect(rowsOf(fileOf(x, 'S_MPLA')!.text).map(r => r.split(',')[0])).toEqual(['PM-WB']);
    });
});

describe('readiness, from the header SAP wrote', () => {
    it('reports the mandatory fields it cannot fill and the ones the client must configure', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        // MEASUREMENT_POINT_TYPE is mandatory and client configuration.
        expect(x.issues.some(i => i.level === 'error' && /S_HEADER\.MEASUREMENT_POINT_TYPE is mandatory and is blank/.test(i.message))).toBe(true);
        expect(x.issues.some(i => /measuring-point category/.test(i.message))).toBe(true);
    });

    it('fills the measuring-point category on every point once it is given', () => {
        const x = buildCockpitExport(fixture(), { ...PARAMS, measuringPointCategory: 'M' });
        const rows = rowsOf(fileOf(x, 'S_HEADER')!.text);
        expect(rows.every(r => r.split(',')[1] === 'M')).toBe(true);
        expect(x.issues.some(i => /MEASUREMENT_POINT_TYPE/.test(i.message))).toBe(false);
        expect(x.issues.some(i => i.level === 'error')).toBe(false);
    });

    it('refuses to move alarm bands or units into fields that mean something else', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        const rows = rowsOf(fileOf(x, 'S_HEADER')!.text);
        expect(rows[0]).not.toContain('7.1');                          // max_warning never written to MRMAC
        expect(x.issues.some(i => /measurement RANGE, not an alarm/.test(i.message))).toBe(true);
        expect(x.issues.some(i => /Units set in IREAMS do not travel/.test(i.message))).toBe(true);
    });

    it('flags a missing planning plant as the load-blocking error it is', () => {
        const x = buildCockpitExport(fixture(), { ...PARAMS, planningPlant: '' });
        expect(x.issues.some(i => i.level === 'error' && /IWERK/.test(i.message))).toBe(true);
    });

    it('clips to SAP lengths and reports it', () => {
        const src = fixture();
        src.schedules![0].title = 'A very long schedule title that will certainly exceed forty characters';
        const x = buildCockpitExport(src, PARAMS);
        expect(rowsOf(fileOf(x, 'S_MPLA')!.text)[0]).toContain('A very long schedule title that will cer,');
        expect(x.issues.some(i => /S_MPLA\.WPTXT longer than SAP's 40/.test(i.message))).toBe(true);
    });
});

describe('the loop closes', () => {
    it('what the export writes, the import reads back as the same data', () => {
        const x = buildCockpitExport(fixture(), { ...PARAMS, mode: 'full' });
        const files = exportZipEntries(x).map(e => ({ name: e.name, text: e.text }));
        const set = readCockpitSet(files);
        expect(set.issues.filter(i => i.level === 'error')).toEqual([]);

        const readings = toReadingRows(set);
        expect(readings.skipped).toBe(0);
        const points = readings.rows.filter(r => !r.value);
        const logs = readings.rows.filter(r => r.value);
        expect(points.map(r => r.pointname)).toEqual(['DE bearing horizontal', 'Running hours', 'NDE vertical']);
        expect(points[0]).toMatchObject({ assettag: '10004711', readingtype: 'VIBRATION' });
        expect(logs).toHaveLength(4);
        expect(logs[0]).toMatchObject({ assettag: '10004711', readingtype: 'VIBRATION', pointname: 'DE bearing horizontal', date: '2026-02-14', value: '4.2', time: '07:05:00', notes: 'Route 12', enteredby: 'j.tech', valuationcode: 'VIBR', sourceref: 'l1', sourcesystem: 'sap_pm' });
        expect(logs[1]).toMatchObject({ value: '48210', delta: '720' });

        const strategy = toStrategyRows(set);
        expect(strategy.skipped).toBe(0);
        expect(strategy.recurring).toHaveLength(2);
        expect(strategy.recurring[0]).toMatchObject({ code: 'PM-P101A-R01/0010', assettag: '10004711', frequencyinterval: '1', frequencyunit: 'Months', tasklist: 'IR000001/01', nextduedate: '2026-03-01' });
        expect(strategy.jobplan.filter(j => j.pmcode === 'IR000001/01').map(j => j.description)).toEqual(['Check bearing temperature', 'Replace mechanical seal']);
        expect(strategy.jobplan[0]).toMatchObject({ esthours: '0.5', controlkey: 'PM01', workcentre: 'MNMEC-PP' });
        expect(JSON.parse(strategy.jobplan[1].materials)).toEqual([{ code: 'MAT-000123', qty: '2', uom: 'EA' }]);
    });

    it('survives the ZIP', () => {
        const x = buildCockpitExport(fixture(), PARAMS);
        const entries = exportZipEntries(x);
        const back = readZip(buildZip(entries, new Date('2026-09-22T10:00:00')));
        expect(back.map(e => e.name)).toEqual(entries.map(e => e.name));
        expect(back.map(e => e.text)).toEqual(entries.map(e => e.text));
        expect(back.every(e => /^Source data for PM - /.test(e.name))).toBe(true);   // nothing changed on the SAP schedule: no hand-over
    });
});
