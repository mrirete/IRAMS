/**
 * KPIAnnotationTooltip — AI "So What?" Badge & Popover (Phase 5, Cap 5)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Reusable component that adds an AI sparkle (✨) icon next to any KPI chart.
 * On click, shows an AI-generated executive commentary popover with:
 *   - Trend indicator (↑ improving / → stable / ↓ declining)
 *   - Business-impact commentary
 *   - Suggested action (if actionRequired)
 *   - "AI Generated" timestamp badge
 *
 * Glassmorphism backdrop consistent with ERS design system.
 * HITL: Informational — no mutations.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { kpiCommentaryService } from '../../services/KPICommentaryService';
import type { KPIAnnotationData } from '../../services/KPICommentaryService';

// ── Styles ──────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    container: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
    },
    badge: {
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.15))',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        fontSize: '14px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        marginLeft: 8,
        position: 'relative' as const,
    },
    badgeHover: {
        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3))',
        border: '1px solid rgba(139, 92, 246, 0.5)',
        transform: 'scale(1.1)',
        boxShadow: '0 0 12px rgba(139, 92, 246, 0.3)',
    },
    badgeLoading: {
        animation: 'kpiSparkleRotate 1.5s ease-in-out infinite',
    },
    popover: {
        position: 'absolute' as const,
        top: '100%',
        right: 0,
        marginTop: 8,
        width: 340,
        padding: '20px',
        borderRadius: 16,
        background: 'rgba(15, 15, 30, 0.92)',
        backdropFilter: 'blur(20px) saturate(1.8)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
        border: '1px solid rgba(139, 92, 246, 0.2)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4), 0 0 30px rgba(139, 92, 246, 0.1)',
        zIndex: 9999,
        color: '#e2e8f0',
        fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
        animation: 'kpiPopoverIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    trendRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
    },
    trendIcon: {
        fontSize: 22,
        lineHeight: 1,
    },
    trendLabel: {
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
    },
    trendValue: {
        marginLeft: 'auto',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    },
    commentary: {
        fontSize: 13.5,
        lineHeight: 1.65,
        color: '#cbd5e1',
        marginBottom: 14,
    },
    actionBox: {
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(251, 191, 36, 0.08)',
        border: '1px solid rgba(251, 191, 36, 0.2)',
        marginBottom: 14,
    },
    actionLabel: {
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.8,
        color: '#fbbf24',
        marginBottom: 4,
    },
    actionText: {
        fontSize: 12.5,
        color: '#fde68a',
        lineHeight: 1.5,
    },
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
        paddingTop: 10,
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    },
    aiBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.8,
        color: '#8b5cf6',
        padding: '3px 8px',
        borderRadius: 6,
        background: 'rgba(139, 92, 246, 0.1)',
        border: '1px solid rgba(139, 92, 246, 0.2)',
    },
    timestamp: {
        fontSize: 10,
        color: '#64748b',
    },
};

// ── Trend Config ────────────────────────────────────────────

const TREND_CONFIG = {
    improving: { icon: '↑', color: '#34d399', label: 'Improving' },
    stable: { icon: '→', color: '#60a5fa', label: 'Stable' },
    declining: { icon: '↓', color: '#f87171', label: 'Declining' },
};

// ── Component ───────────────────────────────────────────────

interface KPIAnnotationTooltipProps {
    kpiName: string;
    currentValue: number;
    previousValue: number;
    unit: string;
    benchmarkValue?: number;
    benchmarkSource?: string;
    relatedMetrics?: { name: string; value: number; unit: string }[];
    period?: string;
}

const KPIAnnotationTooltip: React.FC<KPIAnnotationTooltipProps> = ({
    kpiName,
    currentValue,
    previousValue,
    unit,
    benchmarkValue,
    benchmarkSource,
    relatedMetrics,
    period,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [annotation, setAnnotation] = useState<KPIAnnotationData | null>(null);
    const [generatedAt, setGeneratedAt] = useState<string>('');
    const popoverRef = useRef<HTMLDivElement>(null);
    const badgeRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                badgeRef.current && !badgeRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleClick = useCallback(async () => {
        if (isOpen) {
            setIsOpen(false);
            return;
        }
        setIsOpen(true);

        // Only fetch if we don't have data yet or values changed
        if (!annotation || annotation.currentValue !== `${currentValue}${unit}`) {
            setIsLoading(true);
            try {
                const result = await kpiCommentaryService.getCommentary({
                    name: kpiName,
                    currentValue,
                    previousValue,
                    unit,
                    benchmarkValue,
                    benchmarkSource,
                    relatedMetrics,
                    period,
                });
                setAnnotation(result);
                setGeneratedAt(new Date().toLocaleTimeString());
            } catch (error) {
                console.error('[KPIAnnotationTooltip] Failed:', error);
            } finally {
                setIsLoading(false);
            }
        }
    }, [isOpen, annotation, kpiName, currentValue, previousValue, unit, benchmarkValue, benchmarkSource, relatedMetrics, period]);

    const trendConfig = annotation ? TREND_CONFIG[annotation.trend] : TREND_CONFIG.stable;

    return (
        <div style={styles.container}>
            {/* CSS Keyframes injection */}
            <style>{`
                @keyframes kpiSparkleRotate {
                    0%, 100% { transform: scale(1) rotate(0deg); }
                    50% { transform: scale(1.15) rotate(180deg); }
                }
                @keyframes kpiPopoverIn {
                    from { opacity: 0; transform: translateY(-8px) scale(0.96); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>

            {/* Sparkle Badge */}
            <div
                ref={badgeRef}
                id={`kpi-annotation-${kpiName.replace(/\s+/g, '-').toLowerCase()}`}
                style={{
                    ...styles.badge,
                    ...(isHovered ? styles.badgeHover : {}),
                    ...(isLoading ? styles.badgeLoading : {}),
                }}
                onClick={handleClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                title={`AI Insight: ${kpiName}`}
                role="button"
                aria-label={`View AI insight for ${kpiName}`}
                aria-expanded={isOpen}
            >
                ✨
            </div>

            {/* Popover */}
            {isOpen && (
                <div ref={popoverRef} style={styles.popover}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{ fontSize: 24, marginBottom: 8, animation: 'kpiSparkleRotate 1.5s ease-in-out infinite' }}>✨</div>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>Analyzing {kpiName}…</div>
                        </div>
                    ) : annotation ? (
                        <>
                            {/* Trend Row */}
                            <div style={styles.trendRow}>
                                <span style={{ ...styles.trendIcon, color: trendConfig.color }}>{trendConfig.icon}</span>
                                <span style={{ ...styles.trendLabel, color: trendConfig.color }}>{trendConfig.label}</span>
                                <span style={{ ...styles.trendValue, color: trendConfig.color }}>
                                    {annotation.currentValue}
                                </span>
                            </div>

                            {/* Commentary */}
                            <p style={styles.commentary}>{annotation.commentary}</p>

                            {/* Action Box (conditional) */}
                            {annotation.actionRequired && annotation.suggestedAction && (
                                <div style={styles.actionBox}>
                                    <div style={styles.actionLabel}>⚡ Action Required</div>
                                    <div style={styles.actionText}>{annotation.suggestedAction}</div>
                                </div>
                            )}

                            {/* Footer */}
                            <div style={styles.footer}>
                                <span style={styles.aiBadge}>
                                    <span>🤖</span> Relantern AI
                                </span>
                                <span style={styles.timestamp}>
                                    {generatedAt}
                                </span>
                            </div>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 13 }}>
                            Unable to generate commentary.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default KPIAnnotationTooltip;
