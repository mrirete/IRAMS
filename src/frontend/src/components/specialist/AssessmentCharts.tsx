/**
 * AssessmentCharts — the assessment report's illustrations.
 *
 * Every figure here is drawn from numbers the engine already computed
 * (eam/services/assessmentEngine). Nothing is derived from the narrator's
 * prose, and nothing is estimated for the sake of having a picture: a figure
 * with no data renders as an honest absence, not a zero.
 *
 * Dataviz method, applied on purpose:
 *  - Magnitude of one measure → ONE hue (primary-500 #3E6BEF, validated ≥3:1
 *    against the light surface). Identity is carried by text labels, never by
 *    cycling hues.
 *  - Composition by STATE (Golden-Spot zones, PM verdicts) uses the reserved
 *    status palette. That trio passes CVD separation (worst adjacent ΔE 8.9
 *    protan) but WARNs on contrast against the surface, so every segment ships
 *    with a visible label and count — the required relief, and it means no
 *    value is available only by hovering.
 *  - Ordered scales get a light→dark single hue; there is no rainbow anywhere.
 *  - Bars are thin with rounded data-ends anchored to a baseline; the track is
 *    recessive; text wears text tokens rather than the series colour.
 */
import React from 'react';

// ── tokens ────────────────────────────────────────────────────────────────
const HUE = '#3E6BEF';        // primary-500 — the one data hue
const TRACK = '#f1f5f9';      // slate-100 — recessive track

/** State fills. Reserved: never reused as "series 4". */
export const TONE = {
    good: { fill: '#10b981', text: 'text-emerald-700', chip: 'bg-emerald-50 border-emerald-200' },
    warn: { fill: '#f59e0b', text: 'text-amber-700', chip: 'bg-amber-50 border-amber-200' },
    bad: { fill: '#ef4444', text: 'text-rose-700', chip: 'bg-rose-50 border-rose-200' },
    idle: { fill: '#cbd5e1', text: 'text-slate-500', chip: 'bg-slate-50 border-slate-200' },
} as const;
export type Tone = keyof typeof TONE;

/** Score → tone, one rule for the whole report so colour means one thing. */
export const scoreTone = (pct: number, target = 80, floor = 50): Tone =>
    pct >= target ? 'good' : pct >= floor ? 'warn' : 'bad';

export const NoData: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-[11.5px] italic text-slate-400">{children}</p>
);

// ── hero number ───────────────────────────────────────────────────────────

/**
 * A single percentage, read at a glance. The ring is the illustration; the
 * caption states what "good" is, so the reader is not left guessing whether
 * 84% is a triumph or a problem.
 */
export const ScoreRing: React.FC<{
    pct: number | null;
    label: string;
    caption?: string;
    tone?: Tone;
    size?: number;
}> = ({ pct, label, caption, tone, size = 76 }) => {
    const has = pct != null && Number.isFinite(pct);
    const v = has ? Math.max(0, Math.min(100, pct)) : 0;
    const t = TONE[tone ?? (has ? scoreTone(v) : 'idle')];
    return (
        <div className="flex items-center gap-3">
            <div className="relative shrink-0" style={{ width: size, height: size }}
                title={has ? `${label}: ${v}%` : `${label}: not enough data`}>
                <div className="h-full w-full rounded-full"
                    style={{ background: `conic-gradient(${t.fill} ${v * 3.6}deg, ${TRACK} 0deg)` }} />
                <div className="absolute inset-[6px] flex flex-col items-center justify-center rounded-full bg-white">
                    <span className="text-[15px] font-bold tabular-nums leading-none text-slate-800">
                        {has ? `${Math.round(v)}%` : '—'}
                    </span>
                </div>
            </div>
            <div className="min-w-0">
                <div className="text-[11.5px] font-semibold text-slate-700">{label}</div>
                {caption && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-400">{caption}</div>}
            </div>
        </div>
    );
};

// ── percentage components ─────────────────────────────────────────────────

/**
 * Several percentages that make up one score — register health, data coverage.
 * Ordered as given, because the order is the argument.
 */
export const MetricBars: React.FC<{
    rows: { label: string; pct: number | null; hint?: string; target?: number }[];
}> = ({ rows }) => (
    <div className="space-y-2">
        {rows.map((r) => {
            const has = r.pct != null && Number.isFinite(r.pct);
            const v = has ? Math.max(0, Math.min(100, r.pct as number)) : 0;
            const t = TONE[has ? scoreTone(v, r.target ?? 80) : 'idle'];
            return (
                <div key={r.label} title={r.hint}>
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[11.5px] text-slate-600">{r.label}</span>
                        <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-slate-700">
                            {has ? `${Math.round(v)}%` : '—'}
                        </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: TRACK }}>
                        <div className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${v}%`, background: t.fill }} />
                    </div>
                </div>
            );
        })}
    </div>
);

// ── magnitude ─────────────────────────────────────────────────────────────

/**
 * Ranked magnitude of one measure — spares exposure, skills gaps, PM events.
 * One hue, bars proportional to the largest row, value labelled directly so
 * nothing is hover-only.
 */
export const MagnitudeBars: React.FC<{
    rows: { label: string; value: number; sub?: string }[];
    format?: (n: number) => string;
    /** Mono-space the label — asset tags read better that way. */
    mono?: boolean;
}> = ({ rows, format, mono }) => {
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    return (
        <div className="space-y-1.5">
            {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2.5" title={r.sub}>
                    <span className={`w-[86px] shrink-0 truncate text-[11px] font-semibold text-slate-600 ${mono ? 'font-mono' : ''}`}>
                        {r.label}
                    </span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: TRACK }}>
                        <span className="block h-full rounded-full"
                            style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%`, background: HUE }} />
                    </span>
                    <span className="w-[74px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-700">
                        {format ? format(r.value) : r.value.toLocaleString()}
                    </span>
                </div>
            ))}
        </div>
    );
};

// ── composition by state ──────────────────────────────────────────────────

/**
 * One bar split by state, with a labelled legend beneath. Used where the
 * categories ARE conditions (Golden-Spot residency, PM verdicts), which is the
 * only place the status palette is allowed to fill a mark.
 */
export const StatusSplit: React.FC<{
    segments: { label: string; count: number; tone: Tone; hint?: string }[];
    unitLabel?: string;
}> = ({ segments, unitLabel = 'assets' }) => {
    const total = segments.reduce((s, x) => s + x.count, 0);
    if (total === 0) return <NoData>No {unitLabel} measured yet.</NoData>;
    return (
        <div>
            {/* 2px surface gaps between fills — adjacent states must not merge. */}
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" style={{ background: TRACK }}>
                {segments.filter((s) => s.count > 0).map((s) => (
                    <div key={s.label} title={`${s.label}: ${s.count} ${unitLabel}`}
                        style={{ width: `${(s.count / total) * 100}%`, background: TONE[s.tone].fill }}
                        className="h-full first:rounded-l-full last:rounded-r-full" />
                ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {segments.map((s) => (
                    <span key={s.label} className="flex items-center gap-1.5 text-[11px]" title={s.hint}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE[s.tone].fill }} />
                        <span className="font-semibold tabular-nums text-slate-700">{s.count}</span>
                        <span className="text-slate-500">{s.label}</span>
                    </span>
                ))}
            </div>
        </div>
    );
};

// ── Weibull β, positioned ─────────────────────────────────────────────────

/**
 * Where each fitted asset sits on the failure-behaviour scale. A β table asks
 * the reader to remember what 0.8 versus 2.4 means; the bands say it.
 *
 * β < 1 infant mortality (installation/commissioning), β ≈ 1 random (no
 * benefit from time-based PM), β > 1 wear-out (an interval can be set).
 */
export const BetaStrip: React.FC<{
    rows: { tag: string; beta: number; interpretation?: string }[];
}> = ({ rows }) => {
    if (!rows.length) return <NoData>No asset has enough failure history for a fit yet.</NoData>;
    const MAX = 3;                                    // β above 3 pins to the right edge
    const pos = (b: number) => Math.max(2, Math.min(98, (Math.min(b, MAX) / MAX) * 100));
    return (
        <div>
            <div className="relative h-9">
                {/* Bands, light→dark in one hue: an ordered scale, not categories. */}
                <div className="absolute inset-x-0 top-4 flex h-1.5 overflow-hidden rounded-full">
                    <div style={{ width: '33.33%', background: '#E3ECFF' }} />
                    <div style={{ width: '33.33%', background: '#C7D8FE' }} />
                    <div style={{ width: '33.34%', background: '#9FBAFC' }} />
                </div>
                {rows.map((r, i) => (
                    <div key={`${r.tag}-${i}`}
                        className="absolute top-[9px] -translate-x-1/2"
                        style={{ left: `${pos(r.beta)}%` }}
                        title={`${r.tag} — β ${r.beta.toFixed(2)}${r.interpretation ? ` · ${r.interpretation}` : ''}`}>
                        {/* 2px surface ring so overlapping assets stay countable. */}
                        <span className="block h-3 w-3 rounded-full ring-2 ring-white" style={{ background: HUE }} />
                    </div>
                ))}
            </div>
            <div className="flex justify-between text-[9.5px] font-medium uppercase tracking-wide text-slate-400">
                <span>β&lt;1 · infant mortality</span>
                <span>β≈1 · random</span>
                <span>β&gt;1 · wear-out</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {rows.map((r, i) => (
                    <span key={`${r.tag}-chip-${i}`}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600"
                        title={r.interpretation}>
                        <span className="font-mono font-semibold">{r.tag}</span>
                        <span className="ml-1 tabular-nums text-slate-400">β {r.beta.toFixed(2)}</span>
                    </span>
                ))}
            </div>
        </div>
    );
};

// ── the strip of headline figures ─────────────────────────────────────────

export const StatTiles: React.FC<{
    tiles: { label: string; value: string; sub?: string; tone?: Tone }[];
}> = ({ tiles }) => (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map((t) => (
            <div key={t.label} className={`rounded-xl border p-3 ${t.tone ? TONE[t.tone].chip : 'border-slate-200 bg-white'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.label}</div>
                <div className="mt-1 text-[17px] font-semibold tabular-nums leading-none text-slate-900">{t.value}</div>
                {t.sub && <div className="mt-1 text-[10px] leading-snug text-slate-400">{t.sub}</div>}
            </div>
        ))}
    </div>
);

export default {
    ScoreRing, MetricBars, MagnitudeBars, StatusSplit, BetaStrip, StatTiles, NoData,
};
