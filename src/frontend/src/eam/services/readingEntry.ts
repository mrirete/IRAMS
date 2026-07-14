/**
 * readingEntry — the single engine for capturing a condition/meter reading.
 *
 * Every rule that makes a reading correct lives here, so it cannot differ between
 * the surfaces that capture one (the Condition Data rounds sheet and the asset
 * drawer's Readings tab):
 *
 *   • one meter reading per 24h (skip, never overwrite)
 *   • meter delta + rollover/replacement handling
 *   • alarm-band evaluation → CONDITION_ALARM notification + CBM rules
 *   • parent → child meter propagation (SAP hierarchy measurement transfer)
 *   • meter-based PM triggering (did this reading cross a PM's due meter?)
 *   • offline-first write through the queue (client-generated ids → idempotent replay)
 *
 * The previous value for a point is derived from the LOGS, never from
 * ReadingDefinition.lastReadingValue: getReadingDefinitions() doesn't return that
 * field, so trusting it made the meter delta compute against `undefined` (i.e. 0)
 * on any freshly-loaded page. Deriving it here fixes that for every caller.
 *
 * UI concerns (toasts, banners, modals) stay with the caller — this returns what
 * happened and lets each page present it.
 */
import { Asset, ReadingDefinition, ReadingLogEntry } from '../types';
import { DatabaseService } from './DatabaseService';
import { NotificationService } from './NotificationService';
import { offlineQueue } from './offlineQueue';
import { evaluateReading, type AlarmLevel } from '../../lib/readingAlarm';
import { evaluateMeterPMs, type MeterPM, type MeterPMDue, type MeterReadingCtx } from '../../lib/meterPM';

export interface BreachInfo {
    assetId: string;
    assetName: string;
    defName: string;
    unit?: string;
    value: number;
    level: AlarmLevel;
    detail: string;
}

export type PMDue = MeterPMDue & { assetId: string; assetName: string };

export interface ReadingInput {
    definitionId: string;
    value: number;
    date?: string;
    time?: string;
    comments?: string;
    valuationCode?: string | null;
}

export interface SaveReadingsCtx {
    /** All reading definitions in play (at minimum every def for the assets touched). */
    definitions: ReadingDefinition[];
    /** Known logs — used to derive each point's previous value and enforce the 24h rule. */
    logs: ReadingLogEntry[];
    /** Assets, for hierarchy propagation + naming. Pass [] to disable propagation. */
    assets: Asset[];
    /** Recurring-work rows, for meter-PM triggering. Pass [] to disable. */
    pms: any[];
    /** entered_by */
    actor: string;
    /** recipient for alarm notifications */
    actorId: string;
}

export interface SaveReadingsResult {
    logs: ReadingLogEntry[];
    definitions: ReadingDefinition[];
    breaches: BreachInfo[];
    pmDue: PMDue[];
    queuedAny: boolean;
    propagatedCount: number;
    /** Non-fatal, user-facing (duplicate meter reading skipped, rollover detected…). */
    warnings: string[];
    errors: string[];
}

const sameName = (a?: string, b?: string) => (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();
const stampOf = (l: { date?: string; time?: string }) => `${l.date || ''} ${l.time || ''}`;

/** Latest ACTIVE log per definition — the true previous value for delta + display. */
export function latestByDefinition(logs: ReadingLogEntry[]): Map<string, ReadingLogEntry> {
    const m = new Map<string, ReadingLogEntry>();
    for (const l of logs) {
        if (l.isActive === false) continue;
        const cur = m.get(l.definitionId);
        if (!cur || stampOf(l) > stampOf(cur)) m.set(l.definitionId, l);
    }
    return m;
}

/** Stamp definitions with their last reading so the UI (and any legacy reader) sees it. */
export function withLastReadings(definitions: ReadingDefinition[], logs: ReadingLogEntry[]): ReadingDefinition[] {
    const latest = latestByDefinition(logs);
    return definitions.map(d => {
        const l = latest.get(d.id);
        return l
            ? { ...d, lastReadingValue: Number(l.value), lastReadingDate: l.date }
            : { ...d, lastReadingValue: undefined, lastReadingDate: undefined };
    });
}

/** Map recurring-work rows to the meter-PM shape, for one asset. */
function meterPMsForAsset(pms: any[], assetId: string): MeterPM[] {
    return pms
        .filter(p => p.active !== false && p.status !== 'INACTIVE')
        .filter(p => p.asset_id === assetId || (Array.isArray(p.assigned_assets) && p.assigned_assets.some((a: any) => a.assetId === assetId)))
        .map(p => ({
            id: p.id,
            title: p.title || p.code || 'PM',
            scheduleType: p.schedule_type,
            frequencyType: p.frequency_type,
            interval: Number(p.frequency_interval ?? p.interval ?? 0),
            unit: p.frequency_unit || p.frequency_type || '',
            baseline: Array.isArray(p.assigned_assets)
                ? (p.assigned_assets.find((a: any) => a.assetId === assetId)?.lastReadingValue ?? null)
                : null,
        }));
}

export async function saveReadings(readings: ReadingInput[], ctx: SaveReadingsCtx): Promise<SaveReadingsResult> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    const outLogs = [...ctx.logs];
    const outDefs = [...ctx.definitions];
    const breaches: BreachInfo[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const meterCtx: { assetId: string; ctx: MeterReadingCtx }[] = [];
    let queuedAny = false;
    let propagatedCount = 0;

    // Previous values come from the logs, and we keep this map current as we insert
    // so a batch (and propagation) sees its own earlier writes.
    const latest = latestByDefinition(outLogs);
    const prevValueOf = (defId: string): number | null => {
        const l = latest.get(defId);
        return l?.value != null ? Number(l.value) : null;
    };
    const assetName = (id: string) => ctx.assets.find(a => a.id === id)?.name || 'asset';

    const commit = async (log: ReadingLogEntry, dbLog: Record<string, unknown>, label: string) => {
        const { queued } = await offlineQueue.run('logReading', dbLog, label);
        if (queued) queuedAny = true;
        outLogs.push(log);
        latest.set(log.definitionId, log);
        const i = outDefs.findIndex(d => d.id === log.definitionId);
        if (i >= 0) outDefs[i] = { ...outDefs[i], lastReadingValue: log.value, lastReadingDate: log.date };
    };

    for (const reading of readings) {
        if (reading.value === undefined || reading.value === null || Number.isNaN(reading.value) || !reading.definitionId) continue;
        const def = outDefs.find(d => d.id === reading.definitionId);
        if (!def) continue;

        const readingDate = reading.date || dateStr;

        // One valid meter reading per 24h.
        if (def.category === 'METER') {
            const dup = outLogs.some(l => l.definitionId === def.id && l.date === readingDate && l.isActive !== false);
            if (dup) {
                warnings.push(`A meter reading for '${def.name}' already exists for ${readingDate}. Deactivate it before entering another.`);
                continue;
            }
        }

        const previousValue = prevValueOf(def.id);

        let delta: number | undefined;
        if (def.category === 'METER') {
            if (previousValue == null) delta = 0;
            else if (reading.value < previousValue) {
                warnings.push(`Meter rollover on '${def.name}': ${reading.value} < previous ${previousValue}. Treating as a meter replacement.`);
                delta = reading.value; // new start
            } else delta = reading.value - previousValue;

            meterCtx.push({
                assetId: def.assetId,
                ctx: {
                    defName: def.name, unit: def.unit, readingTypeCode: def.readingTypeCode,
                    category: 'METER', previousValue, newValue: reading.value,
                },
            });
        }

        const alarm = evaluateReading(reading.value, def);
        const id = crypto.randomUUID(); // client-generated → offline replay is idempotent
        const time = def.category === 'METER' ? '00:00' : (reading.time || timeStr);
        const dbLog: Record<string, unknown> = {
            id,
            definition_id: def.id,
            asset_id: def.assetId,
            reading_type_code: def.readingTypeCode,
            reading_date: readingDate,
            reading_time: time,
            value: reading.value,
            delta,
            entered_by: ctx.actor,
            is_active: true,
            is_alarm: alarm.level !== 'OK',
            comments: reading.comments,
            valuation_code: reading.valuationCode || null,
        };
        const newLog: ReadingLogEntry = {
            id, definitionId: def.id, assetId: def.assetId, readingTypeCode: def.readingTypeCode,
            date: readingDate, time, value: reading.value, delta,
            enteredBy: ctx.actor, isActive: true, isAlarm: alarm.level !== 'OK',
            comments: reading.comments, valuationCode: reading.valuationCode || null,
        };

        try {
            await commit(newLog, dbLog, `Reading: ${def.name}`);

            // Parent → child meter propagation: a meter delta on a parent advances
            // every descendant's matching meter by the same delta.
            if (def.category === 'METER' && (delta || 0) > 0 && ctx.assets.length > 0) {
                const visited = new Set<string>([def.assetId]);
                const queue = ctx.assets.filter(a => a.parentId === def.assetId).map(a => a.id);
                while (queue.length > 0) {
                    const childId = queue.shift()!;
                    if (visited.has(childId)) continue; // cycle guard
                    visited.add(childId);
                    ctx.assets.filter(a => a.parentId === childId).forEach(a => queue.push(a.id));

                    const childDefs = outDefs.filter(d =>
                        d.assetId === childId && d.isActive && d.category === 'METER' &&
                        (d.readingTypeCode === def.readingTypeCode || sameName(d.name, def.name)));

                    for (const cd of childDefs) {
                        // Same 24h rule as direct entry — skip, don't overwrite.
                        if (outLogs.some(l => l.definitionId === cd.id && l.date === readingDate && l.isActive !== false)) continue;
                        const prevVal = prevValueOf(cd.id) ?? 0;
                        const childValue = prevVal + (delta as number);
                        const childAlarm = evaluateReading(childValue, cd);
                        const childId2 = crypto.randomUUID();
                        const comments = `Propagated +${delta}${cd.unit ? ' ' + cd.unit : ''} from parent meter "${def.name}"`;
                        const childLog: ReadingLogEntry = {
                            id: childId2, definitionId: cd.id, assetId: childId, readingTypeCode: cd.readingTypeCode,
                            date: readingDate, time: '00:00', value: childValue, delta,
                            enteredBy: ctx.actor, isActive: true, isAlarm: childAlarm.level !== 'OK', comments,
                        };
                        await commit(childLog, {
                            id: childId2, definition_id: cd.id, asset_id: childId, reading_type_code: cd.readingTypeCode,
                            reading_date: readingDate, reading_time: '00:00', value: childValue, delta,
                            entered_by: ctx.actor, is_active: true, is_alarm: childAlarm.level !== 'OK', comments,
                        }, `Reading: ${cd.name} (${assetName(childId)})`);

                        meterCtx.push({
                            assetId: childId,
                            ctx: { defName: cd.name, unit: cd.unit, readingTypeCode: cd.readingTypeCode, category: 'METER', previousValue: prevVal, newValue: childValue },
                        });
                        if (childAlarm.level !== 'OK') {
                            breaches.push({ assetId: childId, assetName: assetName(childId), defName: cd.name, unit: cd.unit, value: childValue, level: childAlarm.level, detail: childAlarm.detail });
                        }
                        propagatedCount++;
                    }
                }
            }

            // Band breach → notification + CBM rules, and collect for the caller's
            // one-tap corrective-work offer.
            if (alarm.level !== 'OK') {
                const name = assetName(def.assetId);
                DatabaseService.getInstance().createNotification({
                    recipientId: ctx.actorId || 'SYSTEM',
                    title: `${alarm.level === 'CRITICAL' ? '🔴 Critical' : '🟠 Warning'} alarm — ${def.name}`,
                    message: `${name}: ${def.name} = ${reading.value}${def.unit ? ' ' + def.unit : ''} (${alarm.detail}). Consider raising corrective work.`,
                    severity: alarm.level === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
                    notificationType: 'CONDITION_ALARM',
                    module: 'readings',
                    entityId: def.assetId,
                    entityType: 'ASSET',
                    entityNumber: def.name,
                    actionRequired: true,
                }).catch(e => console.warn('[R-4] alarm notification failed:', e));

                const ruleEntity = { ...newLog, assetId: def.assetId, definitionName: def.name, readingValue: reading.value, alarmLevel: alarm.level };
                NotificationService.checkRules('readings', 'READING_ALARM', ruleEntity, { currentUserId: ctx.actorId || 'SYSTEM' });
                // Critical breaches additionally fire READING_CRITICAL — the fast
                // escalation rule listens on this, not on every breach.
                if (alarm.level === 'CRITICAL') {
                    NotificationService.checkRules('readings', 'READING_CRITICAL', ruleEntity, { currentUserId: ctx.actorId || 'SYSTEM' });
                }
                breaches.push({ assetId: def.assetId, assetName: name, defName: def.name, unit: def.unit, value: reading.value, level: alarm.level, detail: alarm.detail });
            }
        } catch (e: any) {
            console.error('Failed to save reading', e);
            errors.push(`Failed to save '${def.name}': ${e?.message || 'unknown error'}`);
        }
    }

    // Meter-based PM triggers — did any reading push an asset past a PM's due meter?
    const pmDue: PMDue[] = [];
    if (meterCtx.length > 0 && ctx.pms.length > 0) {
        const byAsset = new Map<string, MeterReadingCtx[]>();
        for (const { assetId, ctx: c } of meterCtx) {
            const arr = byAsset.get(assetId) || [];
            arr.push(c);
            byAsset.set(assetId, arr);
        }
        for (const [assetId, rds] of byAsset) {
            evaluateMeterPMs(meterPMsForAsset(ctx.pms, assetId), rds)
                .forEach(d => pmDue.push({ ...d, assetId, assetName: assetName(assetId) }));
        }
    }

    return { logs: outLogs, definitions: outDefs, breaches, pmDue, queuedAny, propagatedCount, warnings, errors };
}
