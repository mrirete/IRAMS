/**
 * ReliabilityIntelligenceTab — Asset Reliability Intelligence Panel
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Surfaces Layer 2 predictions from the Railway-hosted FastAPI backend
 * directly into the Asset detail view:
 * - Health Index gauge (multi-model ensemble)
 * - RUL estimate with 50/80/95% confidence bands
 * - Failure probability at 7/30/90 day horizons
 * - Data Quality Score
 * - Governance tier (HITL badge)
 * 
 * Falls back gracefully when the API is unavailable or not configured.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Activity, Shield, TrendingDown, AlertTriangle, CheckCircle,
    RefreshCw, Zap, BarChart2, Clock, Target, Cpu, Heart,
    ChevronRight, AlertCircle, Info, Gauge
} from 'lucide-react';
import {
    ResponsiveContainer, RadialBarChart, RadialBar, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell
} from 'recharts';
import { Asset } from '../types';
import { ersApi } from '../services/ERSApiClient';
import type {
    AssetHealthIndex, RULEstimate, FailurePrediction,
    DQSResult, FeatureVector
} from '../services/ERSApiClient';
import { predictionService } from '../services/PredictionService';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '../../contexts/LicenseContext';
import AssetReliabilityStudiesCard from '../../components/analyze/AssetReliabilityStudiesCard';
import { useRelantern } from '../contexts/RelanternContext';
import { Sparkles } from 'lucide-react';

interface ReliabilityIntelligenceTabProps {
    asset: Asset;
}

// ── Governance Badge ──────────────────────────────────────
const GovernanceBadge: React.FC<{ tier: string }> = ({ tier }) => {
    const config = {
        GREEN: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', label: 'Autonomous', icon: CheckCircle },
        AMBER: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', label: 'HITL Review', icon: AlertTriangle },
        RED: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', label: 'Manual Override', icon: AlertCircle },
    }[tier] || { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', label: 'Unknown', icon: Info };

    const Icon = config.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${config.bg} ${config.text} border ${config.border}`}>
            <Icon size={10} />
            {config.label}
        </span>
    );
};

// ── Health Gauge ──────────────────────────────────────────
const HealthGauge: React.FC<{ score: number; confidence: number }> = ({ score, confidence }) => {
    const getColor = (s: number) => s >= 80 ? '#10b981' : s >= 60 ? '#f59e0b' : s >= 40 ? '#f97316' : '#ef4444';
    const color = getColor(score);

    const gaugeData = [{ value: score, fill: color }];

    return (
        <div className="relative w-full" style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                    cx="50%" cy="80%"
                    innerRadius="65%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                    data={gaugeData}
                    barSize={16}
                >
                    <RadialBar
                        dataKey="value"
                        cornerRadius={8}
                        background={{ fill: '#f1f5f9' }}
                    />
                </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-4">
                <span className="text-3xl font-black" style={{ color }}>{score.toFixed(0)}</span>
                <span className="text-[10px] text-slate-400 font-medium">/ 100</span>
                <span className="text-[9px] text-slate-400 mt-0.5">{(confidence * 100).toFixed(0)}% confidence</span>
            </div>
        </div>
    );
};

// ── Metric Card ───────────────────────────────────────────
const MetricCard: React.FC<{
    icon: React.ElementType;
    label: string;
    value: string | number;
    unit?: string;
    subtext?: string;
    color?: string;
}> = ({ icon: Icon, label, value, unit, subtext, color = 'text-slate-700' }) => {
    const IconComp = Icon as any;
    return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-1">
            <IconComp size={12} className="text-slate-400" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className={`text-xl font-black ${color}`}>
            {value}
            {unit && <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>}
        </div>
        {subtext && <span className="text-[10px] text-slate-400">{subtext}</span>}
    </div>
    );
};

// ── DQS Grade Badge ───────────────────────────────────────
const DQSBadge: React.FC<{ grade: string; score: number }> = ({ grade, score }) => {
    const colors: Record<string, string> = {
        A: 'bg-green-100 text-green-700 border-green-200',
        B: 'bg-blue-100 text-blue-700 border-blue-200',
        C: 'bg-amber-100 text-amber-700 border-amber-200',
        D: 'bg-orange-100 text-orange-700 border-orange-200',
        F: 'bg-red-100 text-red-700 border-red-200',
    };
    return (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${colors[grade] || colors.C}`}>
            <Shield size={12} />
            DQS: {score.toFixed(0)} ({grade})
        </div>
    );
};

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export const ReliabilityIntelligenceTab: React.FC<ReliabilityIntelligenceTabProps> = ({ asset }) => {
    const navigate = useNavigate();
    const { isModuleEnabled } = useLicense();
    const { openRelantern } = useRelantern();
    const hasReliabilitySuite = isModuleEnabled('predict');

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [health, setHealth] = useState<AssetHealthIndex | null>(null);
    const [rul, setRul] = useState<RULEstimate | null>(null);
    const [failure, setFailure] = useState<FailurePrediction | null>(null);
    const [dqs, setDqs] = useState<DQSResult | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    // Fallback data from Supabase (PredictionService)
    const [fallbackTwin, setFallbackTwin] = useState<any>(null);
    const [fallbackRUL, setFallbackRUL] = useState<any>(null);

    // Build feature vector from asset metadata
    const buildFeatureVector = useCallback((): FeatureVector => ({
        asset_id: asset.id,
        operating_hours: (asset as any).operatingHours || 0,
        vibration_rms: undefined,
        temperature_c: undefined,
        pressure_bar: undefined,
        flow_rate: undefined,
    }), [asset]);

    // Fetch intelligence from Railway API
    const fetchIntelligence = useCallback(async () => {
        setLoading(true);
        setError(null);

        const features = buildFeatureVector();
        const assetClass = (asset.assetType || asset.category || 'default').toLowerCase();
        const criticality = (asset.criticality as 'A' | 'B' | 'C') || 'B';

        // Try Railway API first, fall back to Supabase data
        if (ersApi.isConfigured) {
            try {
                const [healthRes, rulRes, failureRes, dqsRes] = await Promise.allSettled([
                    ersApi.predictHealth(features, assetClass),
                    ersApi.predictRUL(features, assetClass),
                    ersApi.predictFailure(features, 'general', assetClass, criticality),
                    ersApi.getAssetDQS(asset.id),
                ]);

                if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
                if (rulRes.status === 'fulfilled') setRul(rulRes.value);
                if (failureRes.status === 'fulfilled') setFailure(failureRes.value);
                if (dqsRes.status === 'fulfilled') setDqs(dqsRes.value);

                setLastRefresh(new Date());
                setLoading(false);
                return;
            } catch (e: any) {
                console.warn('[ReliabilityIntelligence] API call failed, falling back to Supabase:', e.message);
            }
        }

        // Fallback: use existing PredictionService (Supabase CRUD)
        try {
            const [twin, rulEst] = await Promise.allSettled([
                predictionService.getTwinState(asset.id),
                predictionService.getRULEstimate(asset.id),
            ]);

            let twinData: any = null;
            if (twin.status === 'fulfilled' && twin.value) {
                twinData = twin.value;
                setFallbackTwin(twin.value);
                // Map to health format
                setHealth({
                    asset_id: asset.id,
                    health_index: twin.value.health_index,
                    confidence: twin.value.calibration_quality ? twin.value.calibration_quality / 100 : 0.75,
                    model_agreement: 0.85,
                    governance_tier: twin.value.health_index >= 70 ? 'GREEN' : twin.value.health_index >= 50 ? 'AMBER' : 'RED',
                    contributing_factors: [],
                    dqs_adjusted: false,
                    timestamp: twin.value.updated_at || twin.value.created_at,
                });
            }

            if (rulEst.status === 'fulfilled' && rulEst.value) {
                setFallbackRUL(rulEst.value);
                setRul({
                    asset_id: asset.id,
                    rul_days: rulEst.value.rul_days,
                    confidence: rulEst.value.confidence || 0.75,
                    distribution_type: rulEst.value.distribution_type || 'weibull_2p',
                    confidence_bands: rulEst.value.confidence_bands || [],
                    recommended_action: rulEst.value.rul_days < 30 ? 'Schedule preventive maintenance' : 'Monitor',
                    governance_tier: rulEst.value.governance_tier === 2 ? 'RED' : rulEst.value.governance_tier === 3 ? 'AMBER' : 'GREEN',
                });
            }

            // DQS from available data — use local twinData, not stale state
            const hasReadings = !!twinData?.sensor_summary && Object.keys(twinData?.sensor_summary || {}).length > 0;
            setDqs({
                asset_id: asset.id,
                overall_score: hasReadings ? 72 : 45,
                completeness: hasReadings ? 80 : 40,
                accuracy: 85,
                timeliness: hasReadings ? 70 : 35,
                consistency: 78,
                grade: hasReadings ? 'B' : 'D',
            });

            setLastRefresh(new Date());
        } catch (e: any) {
            setError('Unable to fetch reliability data. Run a Digital Twin analysis from the Predictions module first.');
        } finally {
            setLoading(false);
        }
    }, [asset, buildFeatureVector]);

    useEffect(() => {
        fetchIntelligence();
    }, [asset.id]); // Re-fetch when asset changes

    // ── Loading State ────────────────────────────────────
    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white border border-slate-200 rounded-xl p-6 h-48">
                            <div className="h-4 bg-slate-200 rounded w-1/3 mb-4" />
                            <div className="h-20 bg-slate-100 rounded-lg" />
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 h-20">
                            <div className="h-3 bg-slate-200 rounded w-1/2 mb-2" />
                            <div className="h-6 bg-slate-100 rounded w-2/3" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Empty State (no prediction data) ─────────────────
    // The studies dossier still renders: manual reliability studies exist
    // independently of the prediction backend.
    if (!health && !rul && !failure) {
        return (
            <div className="space-y-4">
                <AssetReliabilityStudiesCard asset={{ id: asset.id, tag: asset.tag, name: asset.name, criticality: asset.criticality }} />
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                    <Cpu size={48} className="mx-auto mb-4 text-slate-300" />
                    <h3 className="text-lg font-bold text-slate-700 mb-2">No Reliability Intelligence Available</h3>
                    <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
                        {error || 'Run a Digital Twin snapshot or RUL analysis from the Predictions module to generate intelligence for this asset.'}
                    </p>
                    {!ersApi.isConfigured && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 inline-block">
                            <AlertTriangle size={12} className="inline mr-1" />
                            Backend API not configured. Set <code className="bg-amber-100 px-1 rounded">VITE_ERS_API_URL</code> in Vercel environment variables.
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Confidence Band Chart Data ───────────────────────
    const confidenceBandData = rul?.confidence_bands?.map(band => ({
        percentile: `${band.percentile}%`,
        lower: band.lower_days,
        median: band.median_days,
        upper: band.upper_days,
        range: band.upper_days - band.lower_days,
    })) || [];

    // ── Failure Probability Bar Data ─────────────────────
    const failureBarData = failure ? [
        { horizon: '7 days', probability: failure.probability_7d * 100, fill: failure.probability_7d > 0.3 ? '#ef4444' : failure.probability_7d > 0.1 ? '#f59e0b' : '#10b981' },
        { horizon: '30 days', probability: failure.probability_30d * 100, fill: failure.probability_30d > 0.3 ? '#ef4444' : failure.probability_30d > 0.1 ? '#f59e0b' : '#10b981' },
        { horizon: '90 days', probability: failure.probability_90d * 100, fill: failure.probability_90d > 0.5 ? '#ef4444' : failure.probability_90d > 0.2 ? '#f59e0b' : '#10b981' },
    ] : [];

    return (
        <div className="space-y-4">
            {/* ── Header Bar ────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Activity size={16} className="text-relantern-500" />
                        Reliability Intelligence
                    </h3>
                    {health && <GovernanceBadge tier={health.governance_tier} />}
                    {dqs && <DQSBadge grade={dqs.grade} score={dqs.overall_score} />}
                </div>
                <div className="flex items-center gap-2">
                    {lastRefresh && (
                        <span className="text-[9px] text-slate-400">
                            Updated {lastRefresh.toLocaleTimeString()}
                        </span>
                    )}
                    {/* Ask Specialist — launches Relantern AI panel with rich reliability context */}
                    <button
                        onClick={() => {
                            // Build rich reliability context for the AI
                            const healthStr = health
                                ? `Health Index: ${health.health_index?.toFixed(0)}/100 (Confidence: ${((health.confidence || 0.85) * 100).toFixed(0)}%) | Governance: ${health.governance_tier || 'N/A'}`
                                : fallbackTwin
                                    ? `Health Index: ${fallbackTwin.health_index?.toFixed(0)}/100 (Fallback Estimate)`
                                    : 'Health Index: Not yet computed';
                            const rulStr = rul
                                ? `RUL: ${Math.round(rul.rul_days)} days (${((rul.confidence || 0.78) * 100).toFixed(0)}% confidence) | Model: ${(rul as any).model_used || 'Ensemble'}`
                                : fallbackRUL
                                    ? `RUL: ${Math.round(fallbackRUL.rul_days)} days (Fallback Estimate)`
                                    : 'RUL: Not yet computed';
                            const failStr = failure
                                ? `Failure Probability: 7d=${((failure.probability_7d || 0) * 100).toFixed(1)}% | 30d=${((failure.probability_30d || 0) * 100).toFixed(1)}% | 90d=${((failure.probability_90d || 0) * 100).toFixed(1)}%`
                                : 'Failure Probability: Not yet computed';
                            const dqsStr = dqs
                                ? `DQS: ${dqs.overall_score?.toFixed(0)} (${dqs.grade}) — Data quality ${dqs.grade === 'A' ? 'Excellent' : dqs.grade === 'B' ? 'Good' : dqs.grade === 'C' ? 'Fair' : 'Poor'}`
                                : 'DQS: Not assessed';

                            const richContext = `═══ RELIABILITY INTELLIGENCE CONTEXT ═══
Asset: ${asset.tag} (${asset.name})
Type: ${asset.assetType || (asset as any).category || 'N/A'} | Criticality: ${asset.criticality || 'N/A'}

▸ PREDICTIVE ANALYTICS:
  ${healthStr}
  ${rulStr}
  ${failStr}
  ${dqsStr}

▸ IRAMS MODULE: Reliability Intelligence Tab
  This data comes from the predictive analytics engine. Ask about reliability strategy, maintenance optimization, or failure pattern analysis.`;
                            openRelantern(richContext, 'reliability');
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-all
                            bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-sm hover:shadow-md"
                        title="Ask Reliability Specialist"
                    >
                        <Sparkles size={12} />
                        Ask Specialist
                    </button>
                    {/* Open Reliability Suite — RBAC-gated: only for users with Reliability Tier access */}
                    {hasReliabilitySuite && (
                        <button
                            onClick={() => navigate('/analyze')}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all
                                bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300"
                            title="Open the full Reliability Suite (RCA, FMEA, Weibull, Bad Actors)"
                        >
                            <BarChart2 size={12} />
                            Reliability Suite →
                        </button>
                    )}
                    <button
                        onClick={fetchIntelligence}
                        disabled={loading}
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-500 hover:text-slate-700"
                        title="Refresh intelligence"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* ── Top Row: Health + RUL + Failure ────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Health Index Gauge */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                            <Heart size={12} className="text-rose-500" />
                            Health Index
                        </span>
                        {health && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                health.model_agreement >= 0.8 ? 'bg-green-100 text-green-700' :
                                health.model_agreement >= 0.7 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                            }`}>
                                {(health.model_agreement * 100).toFixed(0)}% model agreement
                            </span>
                        )}
                    </div>
                    {health ? (
                        <HealthGauge score={health.health_index} confidence={health.confidence} />
                    ) : (
                        <div className="flex items-center justify-center h-40 text-slate-300">
                            <Gauge size={48} />
                        </div>
                    )}
                </div>

                {/* RUL Estimate */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                            <Clock size={12} className="text-blue-500" />
                            Remaining Useful Life
                        </span>
                        {rul && (
                            <span className="text-[9px] text-slate-400 font-mono">
                                {rul.distribution_type}
                            </span>
                        )}
                    </div>
                    {rul ? (
                        <div>
                            <div className="text-center mb-3">
                                <span className="text-4xl font-black text-slate-800">{Math.round(rul.rul_days)}</span>
                                <span className="text-sm text-slate-400 ml-1">days</span>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                    ≈ {(rul.rul_days / 30).toFixed(1)} months · {(rul.confidence * 100).toFixed(0)}% confidence
                                </div>
                            </div>
                            {/* Confidence Bands */}
                            {confidenceBandData.length > 0 && (
                                <div className="space-y-1.5">
                                    {confidenceBandData.map((band, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[10px]">
                                            <span className="w-8 text-right font-mono text-slate-400">{band.percentile}</span>
                                            <div className="flex-1 h-4 bg-slate-100 rounded-full relative overflow-hidden">
                                                <div
                                                    className="absolute h-full rounded-full"
                                                    style={{
                                                        left: `${(band.lower / (band.upper * 1.2)) * 100}%`,
                                                        width: `${((band.upper - band.lower) / (band.upper * 1.2)) * 100}%`,
                                                        backgroundColor: i === 0 ? '#3b82f6' : i === 1 ? '#60a5fa' : '#93c5fd',
                                                        opacity: 0.7,
                                                    }}
                                                />
                                                <div
                                                    className="absolute h-full w-0.5 bg-slate-700 rounded"
                                                    style={{ left: `${(band.median / (band.upper * 1.2)) * 100}%` }}
                                                />
                                            </div>
                                            <span className="w-20 text-slate-500 font-mono">{band.lower}-{band.upper}d</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {rul.recommended_action && (
                                <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 text-[10px] text-blue-700 flex items-center gap-1.5">
                                    <Target size={10} />
                                    {rul.recommended_action}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-40 text-slate-300">
                            <Clock size={48} />
                        </div>
                    )}
                </div>

                {/* Failure Probability */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                            <AlertTriangle size={12} className="text-amber-500" />
                            Failure Probability
                        </span>
                        {failure && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                failure.rpn > 200 ? 'bg-red-100 text-red-700' :
                                failure.rpn > 100 ? 'bg-amber-100 text-amber-700' :
                                'bg-green-100 text-green-700'
                            }`}>
                                RPN: {failure.rpn}
                            </span>
                        )}
                    </div>
                    {failure && failureBarData.length > 0 ? (
                        <div>
                            <ResponsiveContainer width="100%" height={120}>
                                <BarChart data={failureBarData} layout="vertical" margin={{ left: 50, right: 10 }}>
                                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                                    <YAxis type="category" dataKey="horizon" tick={{ fontSize: 10 }} width={50} />
                                    <Tooltip
                                        formatter={(value: any) => [`${Number(value).toFixed(1)}%`, 'Probability']}
                                        contentStyle={{ fontSize: 11 }}
                                    />
                                    <Bar dataKey="probability" radius={[0, 4, 4, 0]} barSize={18}>
                                        {failureBarData.map((entry, i) => (
                                            <Cell key={i} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                            <div className="text-center text-[10px] text-slate-500 mt-1">
                                Mode: <span className="font-mono font-bold">{failure.failure_mode}</span>
                            </div>
                            {failure.recommended_action && (
                                <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 text-[10px] text-amber-700 flex items-center gap-1.5">
                                    <Zap size={10} />
                                    {failure.recommended_action}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-40 text-slate-300">
                            <BarChart2 size={48} />
                        </div>
                    )}
                </div>
            </div>

            {/* ── Bottom Row: DQS Breakdown + Criticality ─────── */}
            {dqs && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                        icon={CheckCircle}
                        label="Completeness"
                        value={dqs.completeness.toFixed(0)}
                        unit="%"
                        color={dqs.completeness >= 80 ? 'text-green-600' : dqs.completeness >= 60 ? 'text-amber-600' : 'text-red-600'}
                    />
                    <MetricCard
                        icon={Target}
                        label="Accuracy"
                        value={dqs.accuracy.toFixed(0)}
                        unit="%"
                        color={dqs.accuracy >= 80 ? 'text-green-600' : dqs.accuracy >= 60 ? 'text-amber-600' : 'text-red-600'}
                    />
                    <MetricCard
                        icon={Clock}
                        label="Timeliness"
                        value={dqs.timeliness.toFixed(0)}
                        unit="%"
                        color={dqs.timeliness >= 80 ? 'text-green-600' : dqs.timeliness >= 60 ? 'text-amber-600' : 'text-red-600'}
                    />
                    <MetricCard
                        icon={Activity}
                        label="Consistency"
                        value={dqs.consistency.toFixed(0)}
                        unit="%"
                        color={dqs.consistency >= 80 ? 'text-green-600' : dqs.consistency >= 60 ? 'text-amber-600' : 'text-red-600'}
                    />
                </div>
            )}

            {/* ── Reliability Studies Dossier — what Modelling knows about this asset ── */}
            <AssetReliabilityStudiesCard asset={{ id: asset.id, tag: asset.tag, name: asset.name, criticality: asset.criticality }} />

            {/* ── API Source Indicator ─────────────────────────── */}
            <div className="text-[9px] text-slate-400 text-right flex items-center justify-end gap-2">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                    ersApi.isConfigured ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'
                }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ersApi.isConfigured ? 'bg-green-400' : 'bg-slate-400'}`} />
                    {ersApi.isConfigured ? 'Railway API' : 'Supabase Fallback'}
                </span>
                {asset.criticality && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${
                        asset.criticality === 'A' ? 'bg-red-50 text-red-600 border-red-200' :
                        asset.criticality === 'B' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                        'bg-green-50 text-green-600 border-green-200'
                    }`}>
                        <Shield size={8} />
                        Criticality {asset.criticality}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ReliabilityIntelligenceTab;
