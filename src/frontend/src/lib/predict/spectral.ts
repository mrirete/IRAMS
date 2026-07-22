/**
 * DM-layer spectral features (ISO 13374 Data Manipulation) — the last piece
 * of the Predict digital-twin plan.
 *
 * Pure math, no I/O: time-domain condition indicators (RMS, kurtosis, crest),
 * one-sided amplitude spectrum (Hann-windowed FFT), and envelope analysis
 * (Hilbert transform via FFT) for rolling-element bearing / gear-mesh
 * modulation. Diagnosis rules are ISO 13373-style *screening* heuristics —
 * every finding says so; none replaces an analyst.
 *
 * Bearing fault frequencies (BPFO/BPFI/BSF/FTF): when the asset carries
 * bearing specs (assets.properties.predict.bearings), envelope tones are
 * matched against computed defect frequencies and findings name the race
 * (see bearingFaults.ts). Without specs, tones are reported as frequencies +
 * shaft orders, as before.
 */
import {
    faultFrequencies, matchEnvelopeTones,
    type BearingSpec, type BearingFaultFrequencies, type BearingToneMatch,
} from './bearingFaults';

// ─── FFT (iterative radix-2, in-place) ───────────────────────

function fftInPlace(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fft length must be a power of 2');

    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let k = 0; k < len / 2; k++) {
                const uRe = re[i + k], uIm = im[i + k];
                const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
                const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
                re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
                re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
                const nRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nRe;
            }
        }
    }
}

function ifftInPlace(re: Float64Array, im: Float64Array): void {
    // ifft(X) = conj(fft(conj(X))) / n
    for (let i = 0; i < im.length; i++) im[i] = -im[i];
    fftInPlace(re, im);
    const n = re.length;
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

const prevPow2 = (n: number) => 1 << Math.floor(Math.log2(Math.max(2, n)));
const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Hard cap so a pasted mega-file can't lock the tab. */
export const MAX_SAMPLES = 65536;

// ─── Time-domain condition indicators ────────────────────────

export interface TimeFeatures {
    n: number;
    rms: number;
    peak: number;
    /** peak / rms — impacting when high (> ~4–5) */
    crest: number;
    /** Pearson kurtosis — 3 for Gaussian; > ~4 = impulsive (bearing/gear hits) */
    kurtosis: number;
}

export function timeFeatures(samples: number[]): TimeFeatures {
    const n = samples.length;
    const mean = samples.reduce((s, v) => s + v, 0) / (n || 1);
    let m2 = 0, m4 = 0, peak = 0, sq = 0;
    for (const v of samples) {
        const d = v - mean;
        m2 += d * d; m4 += d * d * d * d;
        sq += v * v;
        const a = Math.abs(d);
        if (a > peak) peak = a;
    }
    m2 /= n || 1; m4 /= n || 1;
    const rms = Math.sqrt(m2);   // AC-coupled RMS (mean removed)
    return {
        n,
        rms: round3(rms),
        peak: round3(peak),
        crest: rms > 0 ? round3(peak / rms) : 0,
        kurtosis: m2 > 0 ? round3(m4 / (m2 * m2)) : 0,
    };
}

// ─── Spectra ─────────────────────────────────────────────────

export interface Spectrum {
    /** bin frequencies, Hz (one-sided, DC..fs/2) */
    freqs: number[];
    /** window-corrected one-sided amplitudes (same unit as the input signal) */
    amps: number[];
    /** frequency resolution, Hz/bin */
    df: number;
}

/** Hann-windowed, zero-padded, one-sided amplitude spectrum. */
export function amplitudeSpectrum(samples: number[], sampleRateHz: number): Spectrum {
    const x = samples.slice(0, MAX_SAMPLES);
    const n0 = x.length;
    const mean = x.reduce((s, v) => s + v, 0) / (n0 || 1);
    const n = Math.min(MAX_SAMPLES, nextPow2(n0));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let winSum = 0;
    for (let i = 0; i < n0; i++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n0 - 1 || 1)));
        winSum += w;
        re[i] = (x[i] - mean) * w;
    }
    fftInPlace(re, im);
    const half = n / 2;
    const freqs = new Array<number>(half + 1);
    const amps = new Array<number>(half + 1);
    const df = sampleRateHz / n;
    for (let k = 0; k <= half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        // coherent-gain correction; interior bins doubled for one-sided view
        amps[k] = ((k === 0 || k === half ? 1 : 2) * mag) / (winSum || 1);
        freqs[k] = k * df;
    }
    return { freqs, amps, df };
}

/**
 * Envelope (demodulated) spectrum via the analytic signal: the classic
 * rolling-element bearing tool — repetitive impacts amplitude-modulate the
 * carrier; the envelope's spectrum exposes the repetition (fault) frequency.
 */
export function envelopeSpectrum(samples: number[], sampleRateHz: number): Spectrum {
    const nUse = Math.min(prevPow2(samples.length), MAX_SAMPLES);
    const x = samples.slice(0, nUse);
    const mean = x.reduce((s, v) => s + v, 0) / (nUse || 1);
    const re = new Float64Array(nUse);
    const im = new Float64Array(nUse);
    for (let i = 0; i < nUse; i++) re[i] = x[i] - mean;
    fftInPlace(re, im);
    // analytic-signal multiplier: keep DC & Nyquist, double positives, zero negatives
    for (let k = 1; k < nUse / 2; k++) { re[k] *= 2; im[k] *= 2; }
    for (let k = nUse / 2 + 1; k < nUse; k++) { re[k] = 0; im[k] = 0; }
    ifftInPlace(re, im);
    const env = new Array<number>(nUse);
    for (let i = 0; i < nUse; i++) env[i] = Math.hypot(re[i], im[i]);
    return amplitudeSpectrum(env, sampleRateHz);
}

// ─── Peaks ───────────────────────────────────────────────────

export interface SpectralPeak {
    freqHz: number;
    amplitude: number;
    /** freq ÷ shaft speed — only when RPM is known */
    order?: number;
}

/** Local maxima well above the noise floor (4× median), strongest first. */
export function findPeaks(spec: Spectrum, opts: { maxPeaks?: number; rpm?: number | null; minFreqHz?: number } = {}): SpectralPeak[] {
    const { maxPeaks = 6, rpm = null, minFreqHz = 0.5 } = opts;
    const { freqs, amps } = spec;
    const sorted = [...amps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const floor = Math.max(median * 4, 1e-12);
    const peaks: SpectralPeak[] = [];
    for (let k = 2; k < amps.length - 1; k++) {
        if (freqs[k] < minFreqHz) continue;
        if (amps[k] > floor && amps[k] > amps[k - 1] && amps[k] >= amps[k + 1]) {
            peaks.push({
                freqHz: round2(freqs[k]),
                amplitude: round4(amps[k]),
                ...(rpm ? { order: round2(freqs[k] / (rpm / 60)) } : {}),
            });
        }
    }
    return peaks.sort((a, b) => b.amplitude - a.amplitude).slice(0, maxPeaks);
}

// ─── Diagnosis (screening heuristics, honestly labelled) ─────

export interface SpectralFinding {
    label: string;
    detail: string;
    tone: 'ok' | 'watch' | 'investigate';
}

export interface SpectralDiagnosis {
    severity: 'ok' | 'watch' | 'investigate';
    findings: SpectralFinding[];
}

const near = (f: number, target: number, tolFrac = 0.06) =>
    target > 0 && Math.abs(f - target) <= Math.max(target * tolFrac, 0.5);

export function diagnose(args: {
    time: TimeFeatures;
    specPeaks: SpectralPeak[];
    envPeaks: SpectralPeak[];
    rpm?: number | null;
    /** named-race matches from bearingFaults.matchEnvelopeTones, when specs exist */
    bearingMatches?: BearingToneMatch[];
}): SpectralDiagnosis {
    const { time, specPeaks, envPeaks, rpm, bearingMatches = [] } = args;
    const findings: SpectralFinding[] = [];
    const runHz = rpm ? rpm / 60 : null;

    if (runHz) {
        const p1 = specPeaks.find(p => near(p.freqHz, runHz));
        const p2 = specPeaks.find(p => near(p.freqHz, 2 * runHz));
        const top = specPeaks[0];
        if (p1 && top && p1.freqHz === top.freqHz) {
            findings.push({
                label: '1× dominant — imbalance signature',
                detail: `Strongest spectral line sits at running speed (${p1.freqHz} Hz ≈ 1.0×). Classic imbalance pattern; also check for eccentricity/bent shaft.`,
                tone: 'watch',
            });
        }
        if (p1 && p2 && p2.amplitude >= 0.5 * p1.amplitude) {
            findings.push({
                label: 'Elevated 2× vs 1× — misalignment / looseness signature',
                detail: `2× line (${p2.freqHz} Hz) is ${Math.round((p2.amplitude / p1.amplitude) * 100)}% of 1× — coupling misalignment or structural looseness pattern.`,
                tone: 'watch',
            });
        }
    }

    // Impulsiveness + envelope tones away from low shaft orders → bearing candidate
    const impulsive = time.kurtosis > 4 || time.crest > 5;

    // Named-race matches (bearing specs available) take precedence over the
    // generic candidate: one finding per race, strongest evidence first.
    const seenRaces = new Set<string>();
    for (const m of bearingMatches) {
        if (seenRaces.has(m.race)) continue;
        seenRaces.add(m.race);
        const where = [m.designation, m.position].filter(Boolean).join(', ');
        const approx = m.basis === 'approximate';
        const harm = m.harmonic > 1 ? ` (${m.harmonic}× harmonic)` : '';
        const sb = m.sidebands ? ' with 1×-shaft sidebands — inner-race modulation pattern' : '';
        findings.push({
            label: approx
                ? `Envelope tone near approximate ${m.raceLabel} order — bearing defect hint`
                : `Envelope tone matches ${m.raceLabel}${where ? ` — ${where}` : ''}`,
            detail: `Demodulated tone at ${m.peakHz} Hz vs expected ${m.expectedHz} Hz${harm} (${(m.deviationFrac * 100).toFixed(1)}% off)${sb}. ` +
                (approx
                    ? 'Orders estimated from ball count only — confirm against the datasheet BPFO/BPFI before condemning.'
                    : impulsive
                        ? `Impulsive time signal (kurtosis ${time.kurtosis}, crest ${time.crest}) supports a developing ${m.raceLabel} defect.`
                        : 'Signal is not yet impulsive — possible early-stage defect or lubrication issue; trend this tone.'),
            tone: impulsive && !approx ? 'investigate' : 'watch',
        });
    }

    const bearingTones = envPeaks.filter(p => {
        if (!runHz) return true;
        return !near(p.freqHz, runHz) && !near(p.freqHz, 2 * runHz) && !near(p.freqHz, 3 * runHz);
    });
    if (seenRaces.size > 0) {
        // named findings above already cover the bearing story for this capture
    } else if (impulsive && bearingTones.length > 0) {
        const t = bearingTones[0];
        findings.push({
            label: 'Impulsive signal + envelope tone — rolling-element bearing defect candidate',
            detail: `Kurtosis ${time.kurtosis} / crest ${time.crest} with a demodulated tone at ${t.freqHz} Hz${t.order != null ? ` (${t.order}× shaft)` : ''}. Compare against BPFO/BPFI for the bearing part number before condemning.`,
            tone: 'investigate',
        });
    } else if (impulsive) {
        findings.push({
            label: 'Impulsive time signal',
            detail: `Kurtosis ${time.kurtosis} / crest ${time.crest} exceed Gaussian norms — impacting present, but no clear envelope tone in this capture. Re-capture at higher rate or longer window.`,
            tone: 'watch',
        });
    }

    if (findings.length === 0) {
        findings.push({
            label: 'No dominant fault signature',
            detail: rpm
                ? 'No 1×/2× dominance, no impulsive content, no unexplained envelope tones in this capture.'
                : 'No impulsive content or dominant tones. Provide the running speed (RPM) to enable order-based checks.',
            tone: 'ok',
        });
    }

    const severity: SpectralDiagnosis['severity'] =
        findings.some(f => f.tone === 'investigate') ? 'investigate'
            : findings.some(f => f.tone === 'watch') ? 'watch' : 'ok';
    return { severity, findings };
}

// ─── One-call analysis (what the panel and any future feed use) ──

export interface SpectralAnalysis {
    time: TimeFeatures;
    spectrum: Spectrum;
    envelope: Spectrum;
    specPeaks: SpectralPeak[];
    envPeaks: SpectralPeak[];
    diagnosis: SpectralDiagnosis;
    sampleRateHz: number;
    rpm: number | null;
    /** computed defect frequencies for the asset's bearing specs (when given + RPM known) */
    bearingFaults: BearingFaultFrequencies[];
    /** envelope tones that landed on a computed defect frequency */
    bearingMatches: BearingToneMatch[];
}

export function analyzeWaveform(
    samples: number[],
    sampleRateHz: number,
    rpm?: number | null,
    bearings?: BearingSpec[],
): SpectralAnalysis {
    const clean = samples.filter(v => Number.isFinite(v)).slice(0, MAX_SAMPLES);
    if (clean.length < 64) throw new Error(`Need at least 64 samples (got ${clean.length}).`);
    if (!(sampleRateHz > 0)) throw new Error('Sample rate must be > 0 Hz.');
    const time = timeFeatures(clean);
    const spectrum = amplitudeSpectrum(clean, sampleRateHz);
    const envelope = envelopeSpectrum(clean, sampleRateHz);
    const specPeaks = findPeaks(spectrum, { rpm });
    // Envelope spectrum: ignore the sub-1 Hz region (envelope DC leakage)
    const envPeaks = findPeaks(envelope, { rpm, minFreqHz: 1 });
    const shaftHz = rpm ? rpm / 60 : null;
    const bearingFaults = (bearings ?? [])
        .map(b => faultFrequencies(b, shaftHz))
        .filter((f): f is BearingFaultFrequencies => f != null);
    const bearingMatches = bearingFaults.length > 0
        ? matchEnvelopeTones(envPeaks, bearingFaults, shaftHz)
        : [];
    const diagnosis = diagnose({ time, specPeaks, envPeaks, rpm, bearingMatches });
    return {
        time, spectrum, envelope, specPeaks, envPeaks, diagnosis,
        sampleRateHz, rpm: rpm ?? null, bearingFaults, bearingMatches,
    };
}

/** Max-hold decimation for plotting — preserves peaks at ~maxPoints bins. */
export function decimateForPlot(spec: Spectrum, maxPoints = 400, fMaxHz?: number): { freqHz: number; amp: number }[] {
    const cut = fMaxHz != null ? spec.freqs.findIndex(f => f > fMaxHz) : -1;
    const end = cut > 0 ? cut : spec.freqs.length;
    if (end <= maxPoints) {
        return spec.freqs.slice(0, end).map((f, i) => ({ freqHz: round2(f), amp: round4(spec.amps[i]) }));
    }
    const bin = Math.ceil(end / maxPoints);
    const out: { freqHz: number; amp: number }[] = [];
    for (let i = 0; i < end; i += bin) {
        let maxAmp = 0, maxF = spec.freqs[i];
        for (let j = i; j < Math.min(i + bin, end); j++) {
            if (spec.amps[j] > maxAmp) { maxAmp = spec.amps[j]; maxF = spec.freqs[j]; }
        }
        out.push({ freqHz: round2(maxF), amp: round4(maxAmp) });
    }
    return out;
}

/** Parse pasted/CSV waveform text: bare numbers, or rows whose LAST numeric column is the value. */
export function parseWaveformText(text: string): number[] {
    const out: number[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^[a-zA-Z#]/.test(line)) continue;   // headers/comments
        const cells = line.split(/[,;\t ]+/).filter(Boolean);
        if (cells.length === 1) {
            const v = Number(cells[0]);
            if (Number.isFinite(v)) out.push(v);
        } else {
            // time,value style — take the last numeric cell per row
            const v = Number(cells[cells.length - 1]);
            if (Number.isFinite(v)) out.push(v);
        }
        if (out.length >= MAX_SAMPLES) break;
    }
    return out;
}

/**
 * Synthetic demo signal (clearly labelled in the UI): 1× imbalance line +
 * bearing-style impact train at `impactHz` ringing a high-frequency carrier,
 * plus noise. Lets users exercise the pipeline before wiring a real feed.
 */
export function demoBearingSignal(opts: { sampleRateHz?: number; seconds?: number; rpm?: number; impactHz?: number } = {}): number[] {
    const fs = opts.sampleRateHz ?? 5120;
    const secs = opts.seconds ?? 2;
    const rpm = opts.rpm ?? 1480;
    const impactHz = opts.impactHz ?? 87;      // BPFO-ish, non-integer order
    const runHz = rpm / 60;
    const carrier = 1800;                       // structural resonance being rung
    const n = Math.min(MAX_SAMPLES, Math.floor(fs * secs));
    const out = new Array<number>(n);
    // deterministic pseudo-noise (no Math.random — honest-by-construction rule)
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    for (let i = 0; i < n; i++) {
        const t = i / fs;
        const sinceImpact = (t * impactHz) % 1 / impactHz;      // seconds since last impact
        const ring = Math.exp(-sinceImpact * 2000) * Math.sin(2 * Math.PI * carrier * t);
        out[i] = 0.35 * Math.sin(2 * Math.PI * runHz * t)       // modest 1×
            + 0.1 * Math.sin(2 * Math.PI * 2 * runHz * t)       // mild 2×
            + 3.0 * ring                                        // sharp bearing impacts
            + 0.08 * rand();                                    // noise
    }
    return out;
}

// ─── rounding helpers ────────────────────────────────────────
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
