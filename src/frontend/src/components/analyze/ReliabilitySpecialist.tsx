/**
 * ReliabilitySpecialist — AI-Powered Reliability Advisor
 * 
 * HITL: All outputs are SUGGESTIONS requiring human validation.
 * Standards: ISO 55000 · ISO 14224 · IEC 60812 · OREDA
 */
import React, { useState, useCallback, useRef, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import {
    Bot, Send, ChevronDown, ChevronUp, Sparkles, Loader2,
    Lightbulb, Shield, Search, Wrench, BarChart2, Cpu,
    AlertTriangle, CheckCircle, MessageSquare, Clock, RefreshCw,
} from 'lucide-react';
import { aiEngine } from '../../eam/services/AIAnalysisEngine';
import type { ToolRecommendation } from '../../eam/services/AIAnalysisEngine';
import type { Asset } from '../../types/assets';
import type { ParetoResult } from '../../eam/services/AnalyzeService';

// ─── Types ───────────────────────────────────────────────────

type Division = 'defect_elimination' | 'rca' | 'fmeca' | 'reliability_modelling';

interface Message {
    id: string;
    role: 'user' | 'specialist';
    content: string;
    timestamp: Date;
    type: 'text' | 'recommendation' | 'quick_action';
    data?: ToolRecommendation | Record<string, unknown>;
    suggestedActions?: string[];
}

interface Props {
    activeDivision: Division;
    contextAsset: Asset | null;
    paretoData: ParetoResult[];
    paretoCriteria: string;
}

// ─── Quick Action Definitions ────────────────────────────────

const QUICK_ACTIONS: Record<Division, { label: string; icon: React.ReactNode; action: string; description: string }[]> = {
    fmeca: [
        { label: 'Recommend Tool', icon: <Sparkles size={13} />, action: 'recommend_tool', description: 'Suggest the best analysis approach' },
        { label: 'Risk Assessment', icon: <Shield size={13} />, action: 'risk_assessment', description: 'Evaluate failure mode risks' },
    ],
    rca: [
        { label: 'Generate Hypotheses', icon: <Search size={13} />, action: 'rca_hypothesis', description: 'AI-generated RCA hypotheses (5-Why / Fishbone)' },
        { label: 'Corrective Actions', icon: <Wrench size={13} />, action: 'corrective_actions', description: 'Suggest corrective actions for root causes' },
    ],
    defect_elimination: [
        { label: 'Assess Defect Pattern', icon: <BarChart2 size={13} />, action: 'defect_pattern', description: 'Detect repeat failure patterns' },
        { label: 'Draft DE Plan', icon: <Lightbulb size={13} />, action: 'de_plan', description: 'Draft a defect elimination plan' },
    ],
    reliability_modelling: [
        { label: 'Analyze RBD', icon: <Cpu size={13} />, action: 'rbd_analysis', description: 'Suggest optimal RBD redundancy configuration' },
        { label: 'Recommend Tool', icon: <Sparkles size={13} />, action: 'recommend_tool', description: 'Suggest the best analysis approach' },
    ],
};

// ─── HITL Badge ──────────────────────────────────────────────

const HITLBadge: React.FC = () => (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded text-[9px] font-semibold uppercase tracking-wider">
        <AlertTriangle size={9} /> AI Suggestion — Human Validation Required
    </span>
);

// ─── Tool Label ──────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
    rca: 'Root Cause Analysis',
    fmea: 'FMECA',
    pareto: 'Pareto Analysis',
    rbd: 'Reliability Block Diagram',
    fault_tree: 'Fault Tree Analysis',
    monte_carlo: 'Monte Carlo Simulation',
};

// ═════════════════════════════════════════════════════════════
//  COMPONENT
// ═════════════════════════════════════════════════════════════

const ReliabilitySpecialist: React.FC<Props> = ({ activeDivision, contextAsset, paretoData, paretoCriteria }) => {
    const [expanded, setExpanded] = useState(true);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Helper to build context for AI calls
    const buildContext = useCallback(() => ({
        assetName: contextAsset?.name,
        assetTag: contextAsset?.tag,
        assetCriticality: contextAsset?.criticality,
        assetType: contextAsset?.equipment_type,
        activeDivision,
        paretoSummary: paretoData.length > 0
            ? `Top ${Math.min(3, paretoData.length)} bad actors by ${paretoCriteria}: ${paretoData.slice(0, 3).map(p => `${p.asset_tag} ($${p.metric_value.toLocaleString()})`).join(', ')}`
            : undefined,
    }), [contextAsset, activeDivision, paretoData, paretoCriteria]);

    const addMessage = useCallback((role: Message['role'], content: string, opts?: Partial<Message>) => {
        const msg: Message = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role,
            content,
            timestamp: new Date(),
            type: 'text',
            ...opts,
        };
        setMessages(prev => [...prev, msg]);
        return msg;
    }, []);

    // ── Quick Action Handlers ────────────────────────────────

    const handleQuickAction = useCallback(async (action: string) => {
        setLoading(true);
        let userMsg = '';
        let responseContent = '';
        let responseData: Record<string, unknown> | undefined;
        let suggestedActions: string[] | undefined;

        try {
            switch (action) {
                case 'recommend_tool': {
                    userMsg = '🔍 Recommend the best analysis tool for my current situation';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const result = await aiEngine.recommendTool({
                        problemDescription: contextAsset?.name || paretoData[0]?.asset_name || 'General reliability analysis',
                        assetCriticality: contextAsset?.criticality || paretoData[0]?.criticality || 'B',
                        failureCount: paretoData.reduce((sum, p) => sum + p.event_count, 0) || undefined,
                        totalCost: paretoData.reduce((sum, p) => sum + p.metric_value, 0) || undefined,
                    });
                    responseContent = `**Recommended: ${TOOL_LABELS[result.tool] || result.tool}**\n\n${result.reasoning}`;
                    if (result.suggestedSteps?.length) {
                        responseContent += '\n\n**Suggested Steps:**\n' + result.suggestedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                    }
                    responseData = result as unknown as Record<string, unknown>;
                    break;
                }
                case 'rca_hypothesis': {
                    userMsg = '🧪 Generate RCA hypotheses for the current asset';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const result = await aiEngine.generateRCAHypothesis({
                        problemStatement: contextAsset ? `Investigate failures on ${contextAsset.name} (${contextAsset.tag})` : 'General failure investigation',
                        assetType: contextAsset?.equipment_type,
                    });
                    if (result.hypotheses.length > 0) {
                        responseContent = '**RCA Hypotheses (PROACT 3-Layer Model):**\n\n';
                        result.hypotheses.forEach((h, i) => {
                            const icon = h.likelihood === 'high' ? '🔴' : h.likelihood === 'medium' ? '🟡' : '🟢';
                            responseContent += `${i + 1}. ${icon} **[${h.category}]** ${h.description} _(Likelihood: ${h.likelihood})_\n`;
                        });
                        if (result.suggestedEvidence?.length) {
                            responseContent += '\n**Evidence to Collect:**\n' + result.suggestedEvidence.map(e => `- ${e}`).join('\n');
                        }
                        if (Object.keys(result.fishboneCategories).length > 0) {
                            responseContent += '\n\n**Fishbone (6M) Categories:**\n';
                            Object.entries(result.fishboneCategories).forEach(([cat, items]) => {
                                if (items.length > 0) responseContent += `- **${cat}:** ${items.join(', ')}\n`;
                            });
                        }
                    } else {
                        responseContent = 'No hypotheses could be generated. Please provide more context about the failure event.';
                    }
                    break;
                }
                case 'corrective_actions': {
                    userMsg = '🔧 Suggest corrective actions for identified root causes';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const result = await aiEngine.suggestCorrectiveActions({
                        rootCauses: [{ description: contextAsset ? `Repeated failures on ${contextAsset.name}` : 'General equipment failure', category: 'physical' }],
                        assetCriticality: contextAsset?.criticality || 'B',
                        industry: 'Oil & Gas',
                    });
                    if (result.actions.length > 0) {
                        responseContent = '**Corrective Actions:**\n\n';
                        result.actions.forEach((a, i) => {
                            const typeIcon = a.type === 'immediate' ? '⚡' : a.type === 'short_term' ? '📋' : '🏗️';
                            responseContent += `${i + 1}. ${typeIcon} **[${a.type.replace('_', ' ')}]** ${a.description}`;
                            if (a.estimatedCost) responseContent += ` _(Est: ${a.estimatedCost})_`;
                            if (a.requiresMoC) responseContent += ' `⚠️ MoC Required`';
                            responseContent += '\n';
                        });
                        if (result.riskOfInaction) {
                            responseContent += `\n**Risk of Inaction:** ${result.riskOfInaction}`;
                        }
                    } else {
                        responseContent = 'Unable to generate corrective actions. Please provide more context about the root causes.';
                    }
                    break;
                }
                case 'defect_pattern': {
                    userMsg = '📊 Assess defect patterns from work order history';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const result = await aiEngine.assessDefectPattern({
                        assetName: contextAsset?.name || paretoData[0]?.asset_name || 'Unknown',
                        assetType: contextAsset?.equipment_type,
                        workOrders: paretoData.slice(0, 10).map(p => ({
                            type: 'CM', title: `Failure on ${p.asset_tag}`, cost: p.metric_value,
                            date: new Date().toISOString().slice(0, 10), failureMode: 'Unknown',
                        })),
                    });
                    responseContent = result.patternDetected
                        ? `**⚠️ Pattern Detected**\n\n- **Failure Mode:** ${result.failureMode}\n- **Recurrence Rate:** ${result.recurrenceRate} failures/year\n- **Estimated Annual Cost:** $${result.estimatedAnnualCost.toLocaleString()}\n\n**Recommendation:** ${result.recommendation}`
                        : '**✅ No Repeat Pattern Detected**\n\nThe failure data does not show a clear recurring pattern. Continue monitoring.';
                    break;
                }
                case 'de_plan': {
                    userMsg = '📝 Draft a defect elimination plan';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const topBadActor = paretoData[0];
                    const result = await aiEngine.draftEliminationPlan({
                        assetName: contextAsset?.name || topBadActor?.asset_name || 'Unknown',
                        assetCriticality: contextAsset?.criticality || topBadActor?.criticality || 'B',
                        annualFailureCost: topBadActor?.metric_value || 50000,
                        failureCount: topBadActor?.event_count || 5,
                        dominantFailureMode: 'Mechanical wear',
                    });
                    responseContent = `**Defect Elimination Plan Draft**\n\n**Title:** ${result.title}\n**Scope:** ${result.scope}\n**Priority:** \`${result.priority}\`\n\n**Root Cause Summary:** ${result.rootCauseSummary}\n\n**Proposed Solution:** ${result.proposedSolution}\n\n| Metric | Value |\n|---|---|\n| Est. Annual Savings | $${result.estimatedSavingsPerYear.toLocaleString()} |\n| Implementation Cost | $${result.estimatedImplementationCost.toLocaleString()} |\n| Payback Period | ${result.paybackMonths} months |`;
                    break;
                }
                case 'rbd_analysis': {
                    userMsg = '⚙️ Analyze RBD configuration for optimal availability';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const result = await aiEngine.analyzeRBDConfiguration({
                        systemName: contextAsset?.name || 'Production System',
                        blocks: [
                            { name: 'Primary Unit', failureRate: 0.02, mtbf: 8760, mttr: 24, currentConfig: 'series' },
                            { name: 'Backup Unit', failureRate: 0.01, mtbf: 17520, mttr: 12, currentConfig: 'standby' },
                        ],
                        targetAvailability: 0.99,
                    });
                    responseContent = `**RBD Analysis Results**\n\n| Metric | Value |\n|---|---|\n| Current Availability | ${(result.currentAvailability * 100).toFixed(2)}% |\n| Target Availability | 99.00% |\n| Expected (with changes) | ${(result.expectedAvailability * 100).toFixed(2)}% |\n| Cost-Benefit Ratio | ${result.costBenefitRatio.toFixed(1)}x |\n\n**Suggested Configuration:** ${result.suggestedConfig}\n\n**Reasoning:** ${result.reasoning}`;
                    break;
                }
                case 'risk_assessment': {
                    userMsg = '🛡️ Evaluate failure mode risks for the current context';
                    addMessage('user', userMsg, { type: 'quick_action' });
                    const resp = await aiEngine.askFreeform(
                        `Perform a quick risk assessment for ${contextAsset?.name || 'the current equipment'}. Identify the top 3-5 failure modes, their severity, likelihood, and detectability (RPN). Format as a table.`,
                        buildContext(),
                    );
                    responseContent = resp.answer;
                    suggestedActions = resp.suggestedActions;
                    break;
                }
                default: {
                    responseContent = 'Unknown action. Please try again.';
                }
            }
        } catch (err) {
            console.error('[ReliabilitySpecialist] Action error:', err);
            responseContent = '⚠️ An error occurred while processing your request. Please check the AI configuration and try again.';
        }

        addMessage('specialist', responseContent, { type: action === 'recommend_tool' ? 'recommendation' : 'text', data: responseData, suggestedActions });
        setLoading(false);
    }, [contextAsset, paretoData, paretoCriteria, addMessage, buildContext]);

    // ── Freeform Question Handler ────────────────────────────

    const handleSendQuestion = useCallback(async () => {
        if (!input.trim() || loading) return;
        const question = input.trim();
        setInput('');
        addMessage('user', question);
        setLoading(true);

        try {
            const result = await aiEngine.askFreeform(question, buildContext());
            addMessage('specialist', result.answer, { suggestedActions: result.suggestedActions });
        } catch (err) {
            console.error('[ReliabilitySpecialist] Freeform error:', err);
            addMessage('specialist', '⚠️ Unable to process your question. Please check the AI configuration.');
        }

        setLoading(false);
    }, [input, loading, addMessage, buildContext]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendQuestion();
        }
    }, [handleSendQuestion]);

    const currentActions = QUICK_ACTIONS[activeDivision] || QUICK_ACTIONS.fmeca;

    // ═══════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════
    return (
        <div className="bg-white border border-indigo-200 rounded-xl shadow-sm overflow-hidden transition-all duration-300">
            {/* ── Header ────────────────────────────────────── */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 transition-colors"
            >
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
                        <Bot size={16} className="text-white" />
                    </div>
                    <div className="text-left">
                        <div className="text-sm font-semibold text-slate-800">Reliability Specialist</div>
                        <div className="text-[10px] text-slate-400">AI-Powered • ISO 55000 • HITL</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {messages.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">
                            <MessageSquare size={10} /> {messages.length}
                        </span>
                    )}
                    {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>
            </button>

            {expanded && (
                <div className="border-t border-indigo-100">
                    {/* ── Quick Actions ────────────────────────── */}
                    <div className="px-4 py-2.5 bg-indigo-50/30 border-b border-indigo-100">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5 font-medium">Quick Actions</div>
                        <div className="flex flex-wrap gap-1.5">
                            {currentActions.map(qa => (
                                <button
                                    key={qa.action}
                                    onClick={() => handleQuickAction(qa.action)}
                                    disabled={loading}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-indigo-200 text-indigo-600 rounded-lg text-[11px] font-medium hover:bg-indigo-50 hover:border-indigo-300 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow"
                                    title={qa.description}
                                >
                                    {qa.icon}
                                    {qa.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ── Message History ───────────────────────── */}
                    <div ref={scrollRef} className="max-h-80 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: messages.length > 0 ? '120px' : '60px' }}>
                        {messages.length === 0 && !loading && (
                            <div className="text-center py-4">
                                <Bot size={28} className="mx-auto text-indigo-200 mb-2" />
                                <p className="text-xs text-slate-400">Hello! I'm your <strong>Reliability Specialist</strong>.</p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                    Ask me a question or use the quick actions above.
                                    {contextAsset && <> I see you're working on <strong>{contextAsset.tag}</strong>.</>}
                                </p>
                            </div>
                        )}

                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${msg.role === 'user'
                                    ? 'bg-indigo-500 text-white rounded-br-sm'
                                    : 'bg-slate-50 text-slate-700 border border-slate-200 rounded-bl-sm'
                                    }`}>
                                    {msg.role === 'specialist' && (
                                        <div className="mb-1.5"><HITLBadge /></div>
                                    )}
                                    {/* Render markdown-like content */}
                                    <div className="whitespace-pre-wrap">
                                        {(msg.content || '').split('\n').map((line, li) => {
                                            // Parse bold (**text**) and inline code (`text`) safely
                                            const parts: React.ReactNode[] = [];
                                            let remaining = line;
                                            let keyIdx = 0;
                                            while (remaining.length > 0) {
                                                // Find earliest match of bold or code
                                                const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
                                                const codeMatch = remaining.match(/`(.*?)`/);
                                                const boldIdx = boldMatch?.index ?? Infinity;
                                                const codeIdx = codeMatch?.index ?? Infinity;

                                                if (boldIdx === Infinity && codeIdx === Infinity) {
                                                    // No more markers, push remaining text
                                                    parts.push(<span key={keyIdx++}>{remaining}</span>);
                                                    break;
                                                }

                                                if (boldIdx <= codeIdx && boldMatch) {
                                                    // Bold comes first
                                                    if (boldIdx > 0) parts.push(<span key={keyIdx++}>{remaining.slice(0, boldIdx)}</span>);
                                                    parts.push(<strong key={keyIdx++} className="font-semibold text-slate-800">{boldMatch[1]}</strong>);
                                                    remaining = remaining.slice(boldIdx + boldMatch[0].length);
                                                } else if (codeMatch) {
                                                    // Code comes first
                                                    if (codeIdx > 0) parts.push(<span key={keyIdx++}>{remaining.slice(0, codeIdx)}</span>);
                                                    parts.push(<code key={keyIdx++} className="px-1 py-0.5 bg-slate-200 rounded text-[10px] font-mono">{codeMatch[1]}</code>);
                                                    remaining = remaining.slice(codeIdx + codeMatch[0].length);
                                                }
                                            }
                                            return (
                                                <React.Fragment key={li}>
                                                    {parts}
                                                    {li < msg.content.split('\n').length - 1 && <br />}
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                    {/* Suggested follow-up actions */}
                                    {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                                        <div className="mt-2 pt-2 border-t border-slate-200">
                                            <div className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Suggested Next Steps</div>
                                            {msg.suggestedActions.map((a, i) => (
                                                <div key={i} className="flex items-start gap-1.5 text-[10px] text-slate-500 mt-0.5">
                                                    <CheckCircle size={10} className="text-green-400 mt-0.5 shrink-0" />
                                                    <span>{a}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Timestamp */}
                                    <div className={`text-[9px] mt-1.5 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-300'}`}>
                                        <Clock size={8} className="inline mr-1" />
                                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Loading indicator */}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-slate-50 border border-slate-200 rounded-xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin text-indigo-400" />
                                    <span className="text-xs text-slate-400">Analyzing...</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Input Bar ─────────────────────────────── */}
                    <div className="px-4 py-2.5 border-t border-indigo-100 bg-slate-50/50">
                        <div className="flex gap-2">
                            <input
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={contextAsset ? `Ask about ${contextAsset.tag}...` : 'Ask the Reliability Specialist...'}
                                disabled={loading}
                                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all disabled:opacity-50"
                            />
                            <button
                                onClick={handleSendQuestion}
                                disabled={loading || !input.trim()}
                                className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                            >
                                <Send size={14} />
                            </button>
                        </div>
                        <p className="text-[9px] text-slate-300 mt-1 text-center">
                            Powered by Gemini · All responses are advisory · ISO 55000 · HITL
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Error Boundary — prevents blank page on unhandled errors ──
class SpecialistErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
    state = { hasError: false, error: undefined as Error | undefined };
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ReliabilitySpecialist] Render crash:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-white border border-red-200 rounded-xl p-4 text-center">
                    <AlertTriangle size={24} className="mx-auto text-red-400 mb-2" />
                    <p className="text-sm font-semibold text-slate-700">Reliability Specialist encountered an error</p>
                    <p className="text-[10px] text-slate-400 mt-1 mb-3">{this.state.error?.message || 'Unknown error'}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: undefined })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                        <RefreshCw size={12} /> Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const ReliabilitySpecialistWithBoundary: React.FC<Props> = (props) => (
    <SpecialistErrorBoundary>
        <ReliabilitySpecialist {...props} />
    </SpecialistErrorBoundary>
);

export default ReliabilitySpecialistWithBoundary;
