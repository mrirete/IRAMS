/**
 * assessmentExport — the assessment report as a workbook.
 *
 * Printing gives you the narrative; this gives you the numbers behind it. A
 * reviewer who wants to audit "K-601 is 51% of your spend" needs the rows, in
 * a sheet, with the window stated — not a screenshot.
 *
 * `buildAssessmentSheets` is pure and tested: given an Assessment it returns
 * one descriptor per sheet. Only `exportAssessmentWorkbook` touches the DOM,
 * and it degrades to CSV if the xlsx chunk cannot load.
 *
 * Conventions kept deliberately:
 *  - "—" for a value that does not exist, never 0, matching the report;
 *  - every sheet names its window, so a stray tab is still interpretable;
 *  - percentages export as numbers, not "84%" strings, so they can be charted
 *    by whoever receives the file.
 */
import type { Assessment } from '../eam/services/assessmentEngine';

export interface SheetColumn { key: string; label: string; }
export interface SheetSpec {
    /** Excel caps sheet names at 31 chars; keep them short and unique. */
    name: string;
    columns: SheetColumn[];
    rows: Record<string, string | number>[];
    /** Rendered above the header as a one-line provenance note. */
    note?: string;
}

const dash = <T,>(v: T | null | undefined, fmt?: (x: T) => string | number): string | number =>
    v == null ? '—' : fmt ? fmt(v) : (v as unknown as string | number);

const pct1 = (n: number) => Math.round(n * 10) / 10;
const REGIME_LABEL: Record<string, string> = {
    run_to_failure: 'Run to failure',
    fixed_interval: 'Fixed interval',
    condition_based: 'Condition based',
    defect_elimination: 'Defect elimination',
    rcm_study: 'RCM study',
};

export function buildAssessmentSheets(a: Assessment): SheetSpec[] {
    // Two different windows, kept apart on purpose. The cost and work-order
    // figures are TRAILING 12 MONTHS; `windowMonths` is the span of history the
    // records cover, which is what the Weibull fits use. Stamping the history
    // span on a 12-month figure would misdate it.
    const METRIC_WINDOW = 'trailing 12 months';
    const history = a.dataFrom && a.dataTo
        ? `full history ${a.dataFrom.slice(0, 10)} → ${a.dataTo.slice(0, 10)} (${a.windowMonths} months)`
        : 'no work-order history';
    const scope = a.scope ? `Scoped to ${a.scope.rootTag} — ${a.scope.rootName} and everything under it` : 'Whole fleet';
    const sheets: SheetSpec[] = [];

    // ── Summary — the figures the report leads with ────────────────────────
    sheets.push({
        name: 'Summary',
        note: `${scope} · figures are ${METRIC_WINDOW} · ${history}`,
        columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'basis', label: 'Basis' }],
        rows: [
            { metric: 'Assets in scope', value: a.assetCount, basis: 'Register rows' },
            { metric: 'Work orders', value: a.woCount12mo, basis: METRIC_WINDOW },
            { metric: 'Maintenance spend', value: a.totalSpend12mo, basis: `Labour + material frozen at closure · ${METRIC_WINDOW}` },
            {
                metric: 'Cost concentration', value: dash(a.paretoShare, (p) => p.pct),
                basis: a.paretoShare ? `% of spend from the top ${a.paretoShare.topN} assets` : 'No costed work orders',
            },
            { metric: 'Register health', value: pct1(a.register.healthPct), basis: 'ISO 14224 composite (see Register sheet)' },
            { metric: 'Strategy coverage', value: pct1(a.strategy.coveragePct), basis: `${a.strategy.criticalCovered}/${a.strategy.criticalTotal} critical assets with a live regime` },
            {
                metric: 'Fleet success rate', value: dash(a.success.fleetSuccessRate, pct1),
                basis: a.success.assetsMeasured > 0
                    ? `PSC mean SR across ${a.success.assetsMeasured} measured assets · target ${a.success.targets.srTarget}%`
                    : 'No banded measurement points yet',
            },
            { metric: 'Warranty recoverable', value: a.warranty.total, basis: 'Closed work inside an active warranty window' },
            { metric: 'PM programmes flagged', value: a.pmWaste.length, basis: 'Redundant, over-, under- or ineffective' },
            { metric: 'Cost coverage', value: pct1(a.coverage.cost_pct), basis: '% of work orders carrying a cost' },
            { metric: 'Failure-code coverage', value: pct1(a.coverage.failure_code_pct), basis: '% of corrective work with a coded failure mode' },
            { metric: 'Downtime coverage', value: pct1(a.coverage.downtime_pct), basis: '% of corrective work with a duration' },
        ],
    });

    // ── Bad actors ─────────────────────────────────────────────────────────
    if (a.badActors.length) {
        sheets.push({
            name: 'Bad actors',
            note: `Ranked by cost · ${METRIC_WINDOW}`,
            columns: [
                { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Asset' },
                { key: 'criticality', label: 'Criticality' }, { key: 'cost', label: 'Cost' },
                { key: 'cumPct', label: 'Cumulative % of spend' }, { key: 'wos', label: 'Work orders' },
                { key: 'cms', label: 'Corrective' }, { key: 'downtime', label: 'Downtime (hrs)' },
            ],
            rows: a.badActors.map((b) => ({
                tag: b.tag, name: b.name, criticality: dash(b.criticality),
                cost: Math.round(b.cost12mo), cumPct: pct1(b.cumulativePct),
                wos: b.woCount12mo, cms: b.cmCount12mo, downtime: Math.round(b.downtime12mo),
            })),
        });
    }

    // ── Weibull ────────────────────────────────────────────────────────────
    if (a.weibull.length) {
        sheets.push({
            name: 'Failure behaviour',
            note: 'Censored median-rank regression over full history; suspensions are assets still running',
            columns: [
                { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Asset' },
                { key: 'beta', label: 'Beta (shape)' }, { key: 'eta', label: 'Eta (days)' },
                { key: 'b10', label: 'B10 life (days)' }, { key: 'r2', label: 'Fit R²' },
                { key: 'failures', label: 'Failures' }, { key: 'suspensions', label: 'Suspensions' },
                { key: 'reading', label: 'Interpretation' },
            ],
            rows: a.weibull.map((w) => ({
                tag: w.tag, name: w.name,
                beta: Math.round(w.beta * 100) / 100, eta: Math.round(w.eta),
                b10: Math.round(w.b10Days), r2: Math.round(w.r2 * 1000) / 1000,
                failures: w.nFailures, suspensions: w.nSuspensions, reading: w.interpretation,
            })),
        });
    }

    // ── Strategy ───────────────────────────────────────────────────────────
    if (a.strategy.verdicts.length) {
        sheets.push({
            name: 'Strategy',
            note: `Recommended regime per asset · coverage ${pct1(a.strategy.coveragePct)}% of ${a.strategy.criticalTotal} critical assets`,
            columns: [
                { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Asset' },
                { key: 'criticality', label: 'Criticality' }, { key: 'regime', label: 'Recommended regime' },
                { key: 'interval', label: 'Interval (days)' }, { key: 'basis', label: 'Basis' },
                { key: 'aligned', label: 'Already aligned' }, { key: 'cmCost', label: 'Corrective cost' },
            ],
            rows: a.strategy.verdicts.map((v) => ({
                tag: v.tag, name: v.name, criticality: dash(v.criticality),
                regime: REGIME_LABEL[v.recommended] ?? v.recommended,
                interval: dash(v.recommendedIntervalDays, Math.round),
                basis: v.basis, aligned: v.aligned ? 'Yes' : 'No', cmCost: Math.round(v.cmCost12mo),
            })),
        });
    }

    // ── PM programme health ────────────────────────────────────────────────
    if (a.pmWaste.length) {
        sheets.push({
            name: 'PM programme',
            note: 'Programmes whose frequency does not match the asset’s failure history',
            columns: [
                { key: 'code', label: 'PM code' }, { key: 'title', label: 'Programme' },
                { key: 'tag', label: 'Asset' }, { key: 'category', label: 'Verdict' },
                { key: 'events', label: 'Events / year' }, { key: 'failures', label: 'Failures (trailing 12 mo)' },
            ],
            rows: a.pmWaste.map((p) => ({
                code: p.code, title: p.title, tag: p.tag, category: p.category,
                events: dash(p.annualEvents, Math.round), failures: p.failures12mo,
            })),
        });
    }

    // ── Golden-Spot residency ──────────────────────────────────────────────
    if (a.success.worst.length) {
        sheets.push({
            name: 'Golden Spot',
            note: `PSC success layer · ${a.success.assetsMeasured} of ${a.success.assetsWithBands} banded assets measured`,
            columns: [
                { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Asset' },
                { key: 'zone', label: 'Zone now' }, { key: 'sr', label: 'Success rate %' },
                { key: 'inSpot', label: 'Time in spot %' },
                { key: 'mtop', label: 'MTOP (hrs)' }, { key: 'mttrg', label: 'MTTRg (hrs)' },
            ],
            rows: a.success.worst.map((s) => ({
                tag: s.tag, name: s.name, zone: s.zoneNow,
                sr: dash(s.successRate, pct1), inSpot: dash(s.percentTimeInSpot, pct1),
                mtop: dash(s.mtopHours, (n) => Math.round(n)), mttrg: dash(s.mttrgHours, (n) => Math.round(n)),
            })),
        });
    }

    // ── Spares ─────────────────────────────────────────────────────────────
    if (a.spares.exposures.length) {
        sheets.push({
            name: 'Spares exposure',
            note: `Parts consumed by critical assets, ${METRIC_WINDOW} · ${a.spares.criticalPartsTracked} tracked`,
            columns: [
                { key: 'label', label: 'Part' }, { key: 'severity', label: 'Exposure' },
                { key: 'consumed', label: 'Consumed' }, { key: 'uses', label: 'Times used' },
                { key: 'onHand', label: 'On hand' }, { key: 'min', label: 'Min level' },
                { key: 'assets', label: 'Critical assets' },
            ],
            rows: a.spares.exposures.map((s) => ({
                label: s.label, severity: s.severity, consumed: s.consumedQty12mo, uses: s.uses,
                onHand: dash(s.onHand), min: dash(s.minLevel), assets: s.assets.join(', ') || '—',
            })),
        });
    }

    // ── Workforce ──────────────────────────────────────────────────────────
    if (a.skills.areas.length) {
        sheets.push({
            name: 'Workforce',
            note: `${a.skills.totalQualifications} active qualifications · ${a.skills.expiringSoon} expiring within 90 days`,
            columns: [
                { key: 'area', label: 'Capability' }, { key: 'demand', label: 'Assets needing it' },
                { key: 'people', label: 'Qualified people' }, { key: 'gap', label: 'Gap' },
                { key: 'examples', label: 'Example qualifications' },
            ],
            rows: a.skills.areas.map((s) => ({
                area: s.label, demand: s.demand, people: s.qualifiedPeople,
                gap: s.gap ? 'Yes' : 'No', examples: s.exampleQuals.join(', ') || '—',
            })),
        });
    }

    // ── Register quality ───────────────────────────────────────────────────
    sheets.push({
        name: 'Register quality',
        note: `Composite health ${pct1(a.register.healthPct)}% over ${a.register.assetCount} assets`,
        columns: [{ key: 'measure', label: 'Measure' }, { key: 'value', label: 'Value' }, { key: 'meaning', label: 'What it means' }],
        rows: [
            { measure: 'Structured hierarchy %', value: pct1(a.register.structuredPct), meaning: 'Assets sitting under a parent rather than a flat dump' },
            { measure: 'Criticality spread %', value: pct1(a.register.criticalitySpreadPct), meaning: 'Assets outside the single most common class' },
            {
                measure: 'Dominant criticality', value: dash(a.register.dominantCriticality, (d) => `${d.value} (${pct1(d.pct)}%)`),
                meaning: 'A very high share means criticality was never really assessed',
            },
            { measure: 'Nameplate %', value: pct1(a.register.nameplatePct), meaning: 'Assets carrying both manufacturer and model' },
            { measure: 'Tag collisions', value: a.register.tagCollisionCount, meaning: 'Assets whose normalised tag matches another asset' },
            { measure: 'Work-order linkage %', value: pct1(a.register.woLinkedPct), meaning: 'Work orders that resolve to a known asset' },
        ],
    });

    return sheets;
}

/** Filename stem, safe on every OS and stamped so two exports never collide. */
export function assessmentFilename(a: Assessment, nowIso: string): string {
    const scope = a.scope ? a.scope.rootTag.replace(/[^\w.-]+/g, '_') : 'Fleet';
    return `IRAMS_Assessment_${scope}_${nowIso.slice(0, 10)}`;
}

/** One CSV per sheet is a poor substitute, so the fallback concatenates them. */
export function sheetsToCsv(sheets: SheetSpec[]): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return sheets.map((s) => [
        `# ${s.name}`,
        ...(s.note ? [`# ${s.note}`] : []),
        s.columns.map((c) => esc(c.label)).join(','),
        ...s.rows.map((r) => s.columns.map((c) => esc(r[c.key])).join(',')),
    ].join('\n')).join('\n\n');
}

const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * Write the workbook. Multi-sheet xlsx when the chunk loads, one annotated CSV
 * when it does not — an export that fails silently is worse than a slow one.
 */
export async function exportAssessmentWorkbook(a: Assessment, nowIso = new Date().toISOString()): Promise<void> {
    const sheets = buildAssessmentSheets(a);
    const stem = assessmentFilename(a, nowIso);
    try {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        for (const s of sheets) {
            const aoa: (string | number)[][] = [];
            if (s.note) aoa.push([s.note], []);
            aoa.push(s.columns.map((c) => c.label));
            for (const r of s.rows) aoa.push(s.columns.map((c) => r[c.key] ?? ''));
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = s.columns.map((c) => ({
                wch: Math.min(48, Math.max(
                    c.label.length,
                    ...s.rows.slice(0, 80).map((r) => String(r[c.key] ?? '').length),
                ) + 2),
            }));
            XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
        }
        XLSX.writeFile(wb, `${stem}.xlsx`);
    } catch (err) {
        console.error('Assessment xlsx export failed, writing CSV instead:', err);
        download(new Blob([sheetsToCsv(sheets)], { type: 'text/csv;charset=utf-8;' }), `${stem}.csv`);
    }
}
