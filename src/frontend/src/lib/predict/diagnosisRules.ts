/**
 * Deterministic diagnosis rules engine — the layer between State Detection
 * and Advisory Generation (ISO 13374 spine in PredictionService).
 *
 * Input: what the detectors saw (band breaches, trends, spectral findings,
 * named bearing matches) plus what the plant already knows about the asset
 * (FMEA/RCM documented modes, its own failure history). Output: ranked
 * failure-mode hypotheses keyed to the ISO 14224 taxonomy in reference_codes
 * (0137), each carrying the evidence that produced it — no black boxes.
 *
 * Pure math/logic, no I/O. Confidences are honest rule weights (bounded
 * 0.05–0.95), not probabilities; `basis` says whether a hypothesis came from
 * a specific signature (deterministic-rule) or a coarse association
 * (screening-heuristic). LLM agents narrate this output — they don't invent it.
 */
import type { SensorKind } from './healthModels';
import type { PredictEquipmentClass } from './equipmentClass';
import type { BearingToneMatch } from './bearingFaults';

// ─── Evidence in ─────────────────────────────────────────────

export interface SensorEvidence {
    tag: string;
    kind: SensorKind;
    /** what the detector saw on this point */
    direction: 'high' | 'low' | 'rising' | 'falling';
    value?: number | null;
    limit?: number | null;
    unit?: string;
}

export interface SpectralEvidence {
    /** 1× dominant line seen (imbalance signature) */
    oneTimesDominant?: boolean;
    /** 2× elevated vs 1× (misalignment/looseness signature) */
    twoTimesElevated?: boolean;
    /** kurtosis/crest beyond Gaussian norms */
    impulsive?: boolean;
    /** named-race matches from bearingFaults.matchEnvelopeTones */
    bearingMatches?: BearingToneMatch[];
}

export interface AssetPriors {
    /** free-text failure modes documented in ers_fmea_items for this asset */
    fmeaModes?: string[];
    /** RCM-documented modes: reference_codes FAILURE_MODE codes + strength */
    rcmModes?: { code: string; rpn?: number | null; woCount?: number | null }[];
    /** confirmed history: wo_failure_data.failure_mode_code → occurrence count */
    historyCodes?: Record<string, number>;
}

export interface DiagnosisContext {
    equipmentClass: PredictEquipmentClass;
    sensors: SensorEvidence[];
    spectral?: SpectralEvidence | null;
    priors?: AssetPriors | null;
}

// ─── Hypotheses out ──────────────────────────────────────────

export interface DiagnosisEvidenceItem {
    kind: 'sensor' | 'spectral' | 'fmea' | 'rcm' | 'history';
    summary: string;
}

export interface DiagnosisHypothesis {
    failure_mode_code: string;
    failure_mode_label: string;
    /** bounded 0.05–0.95 — rule weight, not a probability */
    confidence: number;
    basis: 'deterministic-rule' | 'screening-heuristic';
    evidence: DiagnosisEvidenceItem[];
    recommended_action: string;
}

export interface DiagnosisResult {
    engine: 'diagnosis-rules-v1';
    hypotheses: DiagnosisHypothesis[];
}

// ─── Taxonomy slice used by the rules (0137 reference_codes) ─

const MODE_LABELS: Record<string, string> = {
    BAL: 'Imbalance / Out of Balance',
    MIS: 'Misalignment / Shaft Deflection',
    BRG: 'Bearing Failure',
    LUB: 'Lubrication Failure / Oil Contamination',
    SEL: 'Seal Failure / Seal Leakage',
    CVT: 'Cavitation',
    OHE: 'Overheating',
    VIB: 'Abnormal Vibration',
    PLU: 'Plugged / Choked / Fouled',
    LOO: 'Low Output / Reduced Performance',
    COR: 'Corrosion (Internal / External)',
    ERN: 'Erosion',
    FOL: 'Fouling / Scaling',
    OVL: 'Overload / Overcurrent Trip',
    WDG: 'Winding Failure (Open / Short)',
    COL: 'Cooling Failure (Transformer / Motor)',
    INS: 'Insulation Failure / Breakdown',
    PHS: 'Phase Imbalance / Loss of Phase',
    OVV: 'Overvoltage / Undervoltage',
    DFT: 'Signal Drift / Calibration Shift',
    SEN: 'Sensor Failure / Probe Degraded',
    SIG: 'Signal Loss / Communication Failure',
    LVL: 'Level Control Failure',
};

const ACTIONS: Record<string, string> = {
    BAL: 'Verify with a balance check; inspect for fouling/erosion on the rotor before field balancing.',
    MIS: 'Check coupling alignment (laser) and foundation bolts; verify soft foot.',
    BRG: 'Trend the envelope tone; plan bearing inspection/replacement at the next window — do not run to seizure.',
    LUB: 'Check lubricant level/condition; sample oil for analysis; verify cooling of the bearing housing.',
    SEL: 'Inspect seal/seal-pot levels and flush plan; watch for process leakage at the gland.',
    CVT: 'Check suction conditions (NPSH margin, strainer, valve lineup); listen for gravel noise.',
    OHE: 'Verify cooling/ventilation and load; thermography survey to localize the hot spot.',
    VIB: 'Capture a vibration waveform on this point to resolve the signature (1×/2×/envelope).',
    PLU: 'Inspect/clean strainers, filters or tubes; verify upstream conditions.',
    LOO: 'Compare against design duty point; check for internal wear or recirculation.',
    COR: 'Schedule UT thickness verification at adjacent CMLs; review corrosion-rate trend and remaining life.',
    ERN: 'Inspect high-velocity paths (elbows, nozzles); consider flow-pattern review.',
    FOL: 'Plan cleaning at the next opportunity; monitor ΔP/thermal performance trend.',
    OVL: 'Check driven load and process conditions; verify protection settings before resetting.',
    WDG: 'Megger/surge test the windings; inspect terminal box connections.',
    COL: 'Verify cooling circuit (fans, fins, oil/water flow); clean heat-exchange surfaces.',
    INS: 'Insulation-resistance test; check for moisture/contamination ingress.',
    PHS: 'Measure per-phase currents/voltages; inspect connections and upstream supply.',
    OVV: 'Check supply voltage and tap settings; review recent switching events.',
    DFT: 'Recalibrate against a reference; check sensing-line condition.',
    SEN: 'Verify the probe/transmitter; cross-check against a local gauge.',
    SIG: 'Check signal wiring/comms path and transmitter power.',
    LVL: 'Verify level instrumentation and control-valve action; cross-check with a second measurement.',
};

// ─── Engine ──────────────────────────────────────────────────

/** keyword map for matching free-text FMEA modes to taxonomy codes */
const FMEA_KEYWORDS: Record<string, RegExp> = {
    BRG: /bearing/i,
    BAL: /balanc/i,
    MIS: /misalign/i,
    LUB: /lubric|oil/i,
    SEL: /seal/i,
    CVT: /cavitat/i,
    COR: /corro/i,
    ERN: /erosi/i,
    FOL: /foul|scal/i,
    PLU: /plug|chok|block/i,
    WDG: /winding/i,
    OVL: /overload|overcurrent/i,
    OHE: /overheat/i,
    DFT: /drift|calibrat/i,
    COL: /cooling/i,
};

interface Candidate {
    code: string;
    confidence: number;
    basis: DiagnosisHypothesis['basis'];
    evidence: DiagnosisEvidenceItem[];
}

const sensorSummary = (s: SensorEvidence) => {
    const v = s.value != null ? `${s.value}${s.unit ? ` ${s.unit}` : ''}` : 'reading';
    const l = s.limit != null ? ` (limit ${s.limit})` : '';
    return `${s.tag}: ${v} ${s.direction}${l}`;
};

export function diagnoseEvidence(ctx: DiagnosisContext): DiagnosisResult {
    const candidates: Candidate[] = [];
    const add = (code: string, confidence: number, basis: Candidate['basis'], evidence: DiagnosisEvidenceItem[]) =>
        candidates.push({ code, confidence, basis, evidence });

    const by = (kind: SensorKind, dirs: SensorEvidence['direction'][] = ['high', 'rising']) =>
        ctx.sensors.filter(s => s.kind === kind && dirs.includes(s.direction));

    const vibHigh = by('vibration');
    const tempHigh = by('temperature');
    const pressLow = by('pressure', ['low', 'falling']);
    const flowLow = by('flow', ['low', 'falling']);
    const currHigh = by('current');
    const thickLow = by('thickness', ['low', 'falling']);
    const sp = ctx.spectral ?? {};
    const ev = (s: SensorEvidence): DiagnosisEvidenceItem => ({ kind: 'sensor', summary: sensorSummary(s) });

    // ── rotating machinery ──
    if (ctx.equipmentClass === 'rotating') {
        const named = (sp.bearingMatches ?? []).filter(m => m.basis !== 'approximate');
        const approx = (sp.bearingMatches ?? []).filter(m => m.basis === 'approximate');
        if (named.length > 0) {
            const m = named[0];
            add('BRG', 0.85, 'deterministic-rule', [
                { kind: 'spectral', summary: `Envelope tone ${m.peakHz} Hz matches ${m.raceLabel}${m.designation ? ` of ${m.designation}` : ''} (expected ${m.expectedHz} Hz)` },
                ...vibHigh.map(ev),
            ]);
        } else if (approx.length > 0) {
            add('BRG', 0.55, 'screening-heuristic', [
                { kind: 'spectral', summary: `Envelope tone ${approx[0].peakHz} Hz near approximate ${approx[0].raceLabel} order — ball-count estimate only` },
                ...vibHigh.map(ev),
            ]);
        } else if (sp.impulsive) {
            add('BRG', 0.5, 'screening-heuristic', [
                { kind: 'spectral', summary: 'Impulsive time signal (kurtosis/crest beyond Gaussian norms) without a named envelope match' },
            ]);
        }
        if (sp.oneTimesDominant) {
            add('BAL', 0.75, 'deterministic-rule', [
                { kind: 'spectral', summary: 'Strongest spectral line at 1× running speed — classic imbalance pattern' },
                ...vibHigh.map(ev),
            ]);
        }
        if (sp.twoTimesElevated) {
            add('MIS', 0.7, 'deterministic-rule', [
                { kind: 'spectral', summary: '2× line elevated vs 1× — misalignment / looseness pattern' },
                ...vibHigh.map(ev),
            ]);
        }
        if (vibHigh.length > 0 && !sp.oneTimesDominant && !sp.twoTimesElevated && (sp.bearingMatches ?? []).length === 0 && !sp.impulsive) {
            add('VIB', 0.45, 'screening-heuristic', vibHigh.map(ev));
        }
        if (tempHigh.length > 0 && vibHigh.length > 0) {
            add('LUB', 0.6, 'deterministic-rule', [...tempHigh.map(ev), ...vibHigh.map(ev)]);
        } else if (tempHigh.length > 0) {
            add('LUB', 0.5, 'screening-heuristic', tempHigh.map(ev));
            add('OHE', 0.45, 'screening-heuristic', tempHigh.map(ev));
        }
        if (pressLow.length > 0 && flowLow.length > 0) {
            add('CVT', 0.55, 'screening-heuristic', [...pressLow.map(ev), ...flowLow.map(ev)]);
            add('PLU', 0.5, 'screening-heuristic', [...pressLow.map(ev), ...flowLow.map(ev)]);
        } else if (flowLow.length > 0 || pressLow.length > 0) {
            add('LOO', 0.45, 'screening-heuristic', [...flowLow.map(ev), ...pressLow.map(ev)]);
        }
        if (currHigh.length > 0) add('OVL', 0.5, 'screening-heuristic', currHigh.map(ev));
    }

    // ── static / pressure equipment ──
    if (ctx.equipmentClass === 'static') {
        if (thickLow.length > 0) {
            add('COR', 0.8, 'deterministic-rule', thickLow.map(ev));
            add('ERN', 0.4, 'screening-heuristic', thickLow.map(ev));
        }
        const dpHigh = by('pressure');
        if (dpHigh.length > 0) add('FOL', 0.55, 'screening-heuristic', dpHigh.map(ev));
        if (tempHigh.length > 0) add('FOL', 0.5, 'screening-heuristic', tempHigh.map(ev));
        const levelAbn = by('level', ['high', 'low', 'rising', 'falling']);
        if (levelAbn.length > 0) add('LVL', 0.45, 'screening-heuristic', levelAbn.map(ev));
    }

    // ── electrical ──
    if (ctx.equipmentClass === 'electrical') {
        if (currHigh.length > 0) {
            add('OVL', 0.6, 'deterministic-rule', currHigh.map(ev));
            add('WDG', 0.4, 'screening-heuristic', currHigh.map(ev));
            if (currHigh.some(s => /phase|l1|l2|l3/i.test(s.tag))) add('PHS', 0.6, 'screening-heuristic', currHigh.map(ev));
        }
        if (tempHigh.length > 0) {
            add('COL', 0.55, 'screening-heuristic', tempHigh.map(ev));
            add('INS', 0.4, 'screening-heuristic', tempHigh.map(ev));
        }
        if (ctx.sensors.some(s => /volt/i.test(s.tag))) {
            add('OVV', 0.45, 'screening-heuristic',
                ctx.sensors.filter(s => /volt/i.test(s.tag)).map(ev));
        }
    }

    // ── instruments ──
    if (ctx.equipmentClass === 'instrument') {
        const drift = ctx.sensors.filter(s => s.direction === 'rising' || s.direction === 'falling');
        if (drift.length > 0) {
            add('DFT', 0.6, 'screening-heuristic', drift.map(ev));
            add('SEN', 0.45, 'screening-heuristic', drift.map(ev));
        }
        if (ctx.sensors.length > 0 && drift.length === 0) {
            add('SEN', 0.4, 'screening-heuristic', ctx.sensors.map(ev));
        }
    }

    // ── unknown class: generic signal-level hypotheses only ──
    if (ctx.equipmentClass === 'other') {
        if (vibHigh.length > 0) add('VIB', 0.4, 'screening-heuristic', vibHigh.map(ev));
        if (tempHigh.length > 0) add('OHE', 0.4, 'screening-heuristic', tempHigh.map(ev));
    }

    // ── asset priors: what this asset is documented/known to do ──
    const priors = ctx.priors ?? {};
    const boosted = candidates.map(c => {
        let confidence = c.confidence;
        const evidence = [...c.evidence];

        const rcm = (priors.rcmModes ?? []).find(m => m.code === c.code);
        if (rcm) {
            confidence *= 1.2;
            evidence.push({
                kind: 'rcm',
                summary: `Documented RCM failure mode for this asset${rcm.rpn ? ` (RPN ${rcm.rpn})` : ''}${rcm.woCount ? `, ${rcm.woCount} historical WOs` : ''}`,
            });
        }
        const fmeaHit = (priors.fmeaModes ?? []).find(t => FMEA_KEYWORDS[c.code]?.test(t));
        if (fmeaHit) {
            confidence *= 1.15;
            evidence.push({ kind: 'fmea', summary: `FMEA documents "${fmeaHit}" on this asset` });
        }
        const histCount = priors.historyCodes?.[c.code] ?? 0;
        if (histCount > 0) {
            confidence += 0.05 * Math.min(histCount, 3);
            evidence.push({ kind: 'history', summary: `Confirmed ${histCount}× on this asset (work-order failure coding)` });
        }
        return { ...c, confidence: Math.min(0.95, Math.max(0.05, Math.round(confidence * 100) / 100)), evidence };
    });

    // merge duplicates (same code from multiple rules): keep the strongest, union evidence
    const merged = new Map<string, Candidate>();
    for (const c of boosted) {
        const prev = merged.get(c.code);
        if (!prev) { merged.set(c.code, c); continue; }
        const strongest = c.confidence > prev.confidence ? c : prev;
        const weaker = c.confidence > prev.confidence ? prev : c;
        const seen = new Set(strongest.evidence.map(e => e.summary));
        merged.set(c.code, {
            ...strongest,
            evidence: [...strongest.evidence, ...weaker.evidence.filter(e => !seen.has(e.summary))],
        });
    }

    const hypotheses = [...merged.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map(c => ({
            failure_mode_code: c.code,
            failure_mode_label: MODE_LABELS[c.code] ?? c.code,
            confidence: c.confidence,
            basis: c.basis,
            evidence: c.evidence,
            recommended_action: ACTIONS[c.code] ?? 'Investigate and confirm before intervening.',
        }));

    return { engine: 'diagnosis-rules-v1', hypotheses };
}
