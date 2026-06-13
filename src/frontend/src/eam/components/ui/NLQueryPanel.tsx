/**
 * NLQueryPanel — Natural Language to SQL Query Panel (Phase 5, Cap 8)
 * ═══════════════════════════════════════════════════════════════════
 *
 * "Show me Criticality A pumps with >3 failures" → SQL → Results table
 *
 * Workflow:
 *   1. User types a natural language question
 *   2. AI generates SQL + explanation + visualization suggestion
 *   3. "Preview Query" shows syntax-highlighted SQL (HITL review)
 *   4. "Run Query" executes via sandboxed Supabase RPC
 *   5. Results render as a dynamic table (or chart)
 *
 * Security: READ-ONLY SELECT queries only, max 100 rows, whitelisted tables.
 */

import React, { useState, useCallback, useRef } from 'react';
import { aiEngine } from '../../services/AIAnalysisEngine';

// ── Styles ──────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
    container: {
        width: '100%', maxWidth: 880,
        borderRadius: 16,
        background: 'rgba(15, 15, 30, 0.95)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        overflow: 'hidden',
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    },
    header: {
        padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    },
    headerTitle: {
        fontSize: 15, fontWeight: 700, color: '#e2e8f0',
    },
    headerBadge: {
        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
        background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8',
        textTransform: 'uppercase' as const, letterSpacing: 0.5,
    },
    inputRow: {
        padding: '16px 20px', display: 'flex', gap: 10,
    },
    searchInput: {
        flex: 1, padding: '12px 16px', borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#e2e8f0', fontSize: 14, fontFamily: '"Inter", sans-serif',
        outline: 'none', transition: 'border-color 0.2s',
    },
    runBtn: {
        padding: '10px 20px', borderRadius: 10, border: 'none',
        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
        color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        whiteSpace: 'nowrap' as const, transition: 'all 0.2s',
        display: 'flex', alignItems: 'center', gap: 6,
    },
    btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
    sqlBlock: {
        margin: '0 20px 16px', padding: '14px 16px', borderRadius: 10,
        background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.06)',
        fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
        fontSize: 12, lineHeight: 1.6, color: '#a5b4fc',
        whiteSpace: 'pre-wrap' as const, overflowX: 'auto' as const,
    },
    explanation: {
        margin: '0 20px 12px', padding: '10px 14px', borderRadius: 8,
        background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)',
        fontSize: 12, color: '#86efac', lineHeight: 1.5,
    },
    resultsSection: {
        margin: '0 20px 20px',
    },
    resultsMeta: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, fontSize: 11, color: '#64748b',
    },
    resultsTable: {
        width: '100%', borderCollapse: 'collapse' as const, fontSize: 12,
    },
    resTh: {
        textAlign: 'left' as const, padding: '8px 10px', fontWeight: 600,
        color: '#94a3b8', borderBottom: '2px solid rgba(99, 102, 241, 0.2)',
        fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5,
        position: 'sticky' as const, top: 0,
        background: 'rgba(15, 15, 30, 0.98)',
    },
    resTd: {
        padding: '6px 10px', color: '#cbd5e1',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const,
    },
    resScroll: {
        maxHeight: 320, overflowY: 'auto' as const, overflowX: 'auto' as const,
        borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)',
    },
    statusRow: {
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: '#94a3b8',
    },
    errorBox: {
        margin: '0 20px 16px', padding: '10px 14px', borderRadius: 8,
        background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
        fontSize: 12, color: '#fca5a5',
    },
    historySection: {
        padding: '0 20px 16px',
    },
    historyItem: {
        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
        fontSize: 12, color: '#94a3b8', transition: 'all 0.2s',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
    },
};

// ── Component ───────────────────────────────────────────────

interface NLQueryPanelProps {
    onClose?: () => void;
}

interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
}

interface HistoryItem {
    question: string;
    sql: string;
    timestamp: string;
}

const NLQueryPanel: React.FC<NLQueryPanelProps> = ({ onClose }) => {
    const [question, setQuestion] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [generatedSQL, setGeneratedSQL] = useState('');
    const [explanation, setExplanation] = useState('');
    const [confidence, setConfidence] = useState(0);
    const [results, setResults] = useState<QueryResult | null>(null);
    const [error, setError] = useState('');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleGenerate = useCallback(async () => {
        if (!question.trim()) return;
        setIsGenerating(true);
        setError('');
        setResults(null);
        setGeneratedSQL('');

        try {
            const result = await aiEngine.generateEnhancedNLQuery({
                naturalLanguage: question,
            });
            setGeneratedSQL(result.sqlQuery);
            setExplanation(result.explanation);
            setConfidence(result.confidence);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Query generation failed');
        } finally {
            setIsGenerating(false);
        }
    }, [question]);

    const handleExecute = useCallback(async () => {
        if (!generatedSQL) return;
        setIsExecuting(true);
        setError('');

        try {
            // Get Supabase session token for backend auth
            const { createClient } = await import('@supabase/supabase-js');
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
            const sb = createClient(supabaseUrl, supabaseKey);
            const { data: { session } } = await sb.auth.getSession();
            const token = session?.access_token || '';

            const proxyUrl = import.meta.env.VITE_AI_PROXY_URL || '';
            const response = await fetch(`${proxyUrl}/ai/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ sql: generatedSQL }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ detail: 'Query execution failed' }));
                throw new Error(errData.detail || `Error: ${response.status}`);
            }

            const data = await response.json();
            setResults({
                columns: data.columns || [],
                rows: data.rows || [],
                rowCount: data.row_count || 0,
                executionTimeMs: data.execution_time_ms || 0,
            });

            // Add to history
            setHistory(prev => [{
                question, sql: generatedSQL,
                timestamp: new Date().toLocaleTimeString(),
            }, ...prev.slice(0, 9)]);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Query execution failed');
        } finally {
            setIsExecuting(false);
        }
    }, [generatedSQL, question]);

    const handleHistoryClick = useCallback((item: HistoryItem) => {
        setQuestion(item.question);
        setGeneratedSQL(item.sql);
        setResults(null);
    }, []);

    return (
        <div style={S.container}>
            {/* Header */}
            <div style={S.header}>
                <span style={{ fontSize: 18 }}>🔍</span>
                <span style={S.headerTitle}>Ask Your Data</span>
                <span style={S.headerBadge}>NL-to-SQL</span>
                {onClose && (
                    <button
                        onClick={onClose}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}
                    >✕</button>
                )}
            </div>

            {/* Search Input */}
            <div style={S.inputRow}>
                <input
                    ref={inputRef}
                    style={S.searchInput}
                    placeholder='Ask a question: "Show me Criticality A pumps with >3 failures last year"'
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if (generatedSQL && !results) handleExecute();
                            else handleGenerate();
                        }
                    }}
                />
                <button
                    style={{ ...S.runBtn, ...(isGenerating ? S.btnDisabled : {}) }}
                    onClick={generatedSQL && !results ? handleExecute : handleGenerate}
                    disabled={isGenerating || isExecuting || !question.trim()}
                >
                    {isGenerating ? '⏳ Generating…' :
                     isExecuting ? '⏳ Running…' :
                     generatedSQL && !results ? '▶ Run Query' : '✨ Generate SQL'}
                </button>
            </div>

            {/* Error */}
            {error && <div style={S.errorBox}>⚠️ {error}</div>}

            {/* Generated SQL */}
            {generatedSQL && (
                <>
                    {explanation && (
                        <div style={S.explanation}>
                            💡 {explanation}
                            {confidence > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>({(confidence * 100).toFixed(0)}% confidence)</span>}
                        </div>
                    )}
                    <div style={S.sqlBlock}>{generatedSQL}</div>
                </>
            )}

            {/* Results Table */}
            {results && (
                <div style={S.resultsSection}>
                    <div style={S.resultsMeta}>
                        <span>{results.rowCount} row{results.rowCount !== 1 ? 's' : ''} returned</span>
                        <span>{results.executionTimeMs}ms</span>
                    </div>
                    <div style={S.resScroll}>
                        <table style={S.resultsTable}>
                            <thead>
                                <tr>
                                    {results.columns.map((col) => (
                                        <th key={col} style={S.resTh}>{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {results.rows.map((row, i) => (
                                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                                        {results.columns.map((col) => (
                                            <td key={col} style={S.resTd} title={String(row[col] ?? '')}>
                                                {row[col] === null ? <span style={{ color: '#475569', fontStyle: 'italic' }}>null</span> : String(row[col])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Status */}
            {(isGenerating || isExecuting) && (
                <div style={S.statusRow}>
                    <span style={{ animation: 'cpPulse 1.5s ease-in-out infinite' }}>⏳</span>
                    <span>{isGenerating ? 'Generating SQL from your question…' : 'Executing query against EAM database…'}</span>
                </div>
            )}

            {/* History */}
            {history.length > 0 && !results && (
                <div style={S.historySection}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                        Recent Queries
                    </div>
                    {history.slice(0, 5).map((item, i) => (
                        <div
                            key={i}
                            style={S.historyItem}
                            onClick={() => handleHistoryClick(item)}
                        >
                            <span>🕒</span>
                            <span style={{ flex: 1 }}>{item.question}</span>
                            <span style={{ fontSize: 10, color: '#475569' }}>{item.timestamp}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NLQueryPanel;
