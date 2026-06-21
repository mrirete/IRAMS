/**
 * RelanternCoPilot — MaintainX-style floating AI coach
 * 
 * Always-available reliability AI assistant accessible from every page.
 * Features:
 * - Floating Action Button (FAB) — bottom-right, always visible
 * - Context-aware: auto-detects current page + asset
 * - Quick Actions: Create WR, Run Analysis, Draft RCA (page-specific)
 * - Conversational AI chat with specialist agent routing
 * - Integrated WR creation flow (PdM → EAM bridge)
 * 
 * ISO 55000 · HITL: AI is advisor — user validates all actions
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Sparkles, X, Send, ChevronDown, Wrench, Search, BarChart2, AlertTriangle,
    CheckCircle, Bot, Loader2, Target, Layers, FileWarning, Activity,
    ShieldCheck, ClipboardList, Cpu, TrendingUp, Microscope, ArrowRight,
    MessageCircle, Minimize2, Maximize2
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createRelanternChat, proxyAIChat, isAIProxyEnabled } from '../../eam/services/geminiService';
import type { GeminiChat } from '../../eam/services/geminiService';
import { useAssetLookup } from '../../hooks/useAssetLookup';
import { DatabaseService } from '../../eam/services/DatabaseService';

// ─── Page Context Detection ─────────────────────────────────
interface PageContext {
    id: string;
    label: string;
    icon: React.ReactNode;
    color: string;
}

const PAGE_CONTEXTS: Record<string, PageContext> = {
    '/dashboard': { id: 'dashboard', label: 'Dashboard', icon: <Activity size={14} />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    '/assets': { id: 'assets', label: 'Asset Register', icon: <Layers size={14} />, color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
    '/work-orders': { id: 'work-orders', label: 'Work Management', icon: <Wrench size={14} />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    '/work-requests': { id: 'requests', label: 'Work Requests', icon: <ClipboardList size={14} />, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    '/predict': { id: 'predict', label: 'Predictive Insights', icon: <TrendingUp size={14} />, color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
    '/analyze': { id: 'analyze', label: 'Reliability Analysis', icon: <Microscope size={14} />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    '/reliability': { id: 'reliability', label: 'Reliability Modelling', icon: <BarChart2 size={14} />, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    '/scheduling': { id: 'scheduling', label: 'Scheduling', icon: <Target size={14} />, color: 'text-sky-600 bg-sky-50 border-sky-200' },
    '/inventory': { id: 'inventory', label: 'Inventory', icon: <Layers size={14} />, color: 'text-orange-600 bg-orange-50 border-orange-200' },
};

// ─── Quick Action Definitions ───────────────────────────────
interface QuickAction {
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    pages: string[]; // empty = global (show on all pages)
    action: 'create_wr' | 'quick_analysis' | 'search_kb' | 'draft_rca' | 'run_fmea' | 'check_warranty' | 'draft_job_plan' | 'compare_fleet' | 'navigate';
    navigateTo?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
    // Global
    { id: 'create_wr', label: 'Create Work Request', description: 'Go to Work Requests module', icon: <Wrench size={16} />, color: 'text-cyan-600 bg-cyan-50 border-cyan-200 hover:bg-cyan-100', pages: [], action: 'navigate', navigateTo: '/work-requests' },
    { id: 'quick_analysis', label: 'Quick AI Brief', description: 'Get a 30-second executive summary', icon: <Sparkles size={16} />, color: 'text-relantern-700 bg-relantern-50 border-relantern-200 hover:bg-relantern-100', pages: [], action: 'quick_analysis' },
    { id: 'search_kb', label: 'Search Knowledge', description: 'Query SOPs, OEM manuals, standards', icon: <Search size={16} />, color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100', pages: [], action: 'search_kb' },
    // Predict-specific
    { id: 'compare_fleet', label: 'Compare Fleet Health', description: 'Cross-fleet health comparison', icon: <BarChart2 size={16} />, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 hover:bg-indigo-100', pages: ['predict'], action: 'compare_fleet' },
    // Analyze-specific
    { id: 'draft_rca', label: 'Draft Root Cause', description: 'AI-assisted 5-Why / Fishbone analysis', icon: <Microscope size={16} />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100', pages: ['analyze'], action: 'draft_rca' },
    // Assets-specific
    { id: 'run_fmea', label: 'Run FMEA', description: 'Failure mode analysis for focused asset', icon: <AlertTriangle size={16} />, color: 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100', pages: ['assets'], action: 'run_fmea' },
    { id: 'check_warranty', label: 'Check Warranty', description: 'Verify warranty status & claims', icon: <ShieldCheck size={16} />, color: 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100', pages: ['assets'], action: 'check_warranty' },
    // Work Orders-specific
    { id: 'draft_job_plan', label: 'Draft Job Plan', description: 'AI-generated tasks, BOM & labour', icon: <ClipboardList size={16} />, color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100', pages: ['work-orders'], action: 'draft_job_plan' },
];

// ─── Agent definitions for chat ─────────────────────────────
const AGENTS: Record<string, { name: string; color: string }> = {
    '1': { name: 'Master AI', color: 'text-relantern-700' },
    '2': { name: 'Planning', color: 'text-sky-600' },
    '3': { name: 'Scheduling', color: 'text-amber-600' },
    '4': { name: 'Reliability', color: 'text-emerald-600' },
    '5': { name: 'Predictive', color: 'text-cyan-600' },
    '6': { name: 'Compliance', color: 'text-red-600' },
    '8': { name: 'Vision', color: 'text-purple-600' },
};

const DOMAIN_MAP: Record<string, string> = {
    reliability_analyst: '4', predictive_maintenance: '5', strategic_asset: '1',
    work_intelligence: '3', compliance_safety: '6', asset_integrity_auditor: '4',
    inspection_vision: '8', sustainability: '1', knowledge_people: '2',
};

// ─── Types ──────────────────────────────────────────────────
interface ChatMessage {
    id: string;
    sender: 'user' | 'agent';
    agentId?: string;
    text: string;
    confidence?: number;
    tier?: string;
    timestamp: Date;
}

type CoPilotView = 'actions' | 'chat';

// ─── Component ──────────────────────────────────────────────
export const RelanternCoPilot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [view, setView] = useState<CoPilotView>('actions');
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: '0', sender: 'agent', agentId: '4', text: 'Relantern CoPilot active. I can help with work requests, reliability analysis, troubleshooting, or anything across the EAM suite. What do you need?', timestamp: new Date() },
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [fabPulse, setFabPulse] = useState(true);
    const abortRef = useRef<AbortController | null>(null);
    const chatRef = useRef<GeminiChat | null>(null);

    // Proxy-first architecture: route through backend AI proxy when available
    const useProxy = isAIProxyEnabled();

    // WR form state
    const [wrForm, setWrForm] = useState({ title: '', description: '', priority: 'ROUTINE', workType: 'CM' });
    const [wrSubmitting, setWrSubmitting] = useState(false);
    const [wrSuccess, setWrSuccess] = useState(false);
    const [wrError, setWrError] = useState<string | null>(null);

    const location = useLocation();
    const navigate = useNavigate();
    const { assetOptions } = useAssetLookup();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // ─── Context detection ──────────────────────────────────
    const pageContext = useMemo(() => {
        const path = location.pathname;
        for (const [route, ctx] of Object.entries(PAGE_CONTEXTS)) {
            if (path.startsWith(route)) return ctx;
        }
        return PAGE_CONTEXTS['/dashboard'];
    }, [location.pathname]);

    // ─── Available quick actions for current page ───────────
    const availableActions = useMemo(() => {
        const pageId = pageContext.id;
        return QUICK_ACTIONS.filter(a => a.pages.length === 0 || a.pages.includes(pageId));
    }, [pageContext]);

    // ─── Listen for toggle-copilot event from TopBar ────────
    useEffect(() => {
        const handler = () => {
            setIsOpen(prev => !prev);
            setFabPulse(false);
        };
        window.addEventListener('toggle-copilot', handler);
        return () => window.removeEventListener('toggle-copilot', handler);
    }, []);

    // ─── Auto-scroll chat ───────────────────────────────────
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    // ─── Focus input when chat opens ────────────────────────
    useEffect(() => {
        if (isOpen && view === 'chat') {
            setTimeout(() => inputRef.current?.focus(), 200);
        }
    }, [isOpen, view]);

    // ─── Stop pulse after first open ────────────────────────
    useEffect(() => {
        if (isOpen) setFabPulse(false);
    }, [isOpen]);

    // ─── Chat send (proxy-first, direct SDK fallback) ───────
    const handleSend = async () => {
        if (!inputValue.trim() || isLoading) return;
        const userText = inputValue;
        setInputValue('');

        const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text: userText, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        try {
            let responseText: string;
            const pageContextStr = `User is on ${pageContext.label} page (${location.pathname})`;

            if (useProxy) {
                // ── Production path: route through backend AI proxy ──
                // API key stays server-side, full audit trail, RBAC, rate limiting
                responseText = await proxyAIChat(
                    userText,
                    pageContext.id,       // module context
                    pageContextStr,       // additional context
                    'copilot_chat',       // context type for audit
                );
            } else {
                // ── Dev-only fallback: direct Gemini SDK ──
                if (!chatRef.current) {
                    chatRef.current = await createRelanternChat();
                }
                const contextPrompt = `[Context: ${pageContextStr}]\n\n${userText}`;
                const response = await chatRef.current.sendMessage({ message: contextPrompt });
                responseText = response.text || 'I could not generate a response.';
            }

            const agentMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                sender: 'agent',
                agentId: '4',
                text: responseText,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, agentMsg]);
        } catch (err: any) {
            let errorText: string;
            const errMsg = err?.message || 'Unknown error';
            if (!import.meta.env.VITE_AI_PROXY_URL && !import.meta.env.VITE_GEMINI_API_KEY) {
                errorText = '⚠️ AI Not Configured — Set VITE_AI_PROXY_URL (recommended) or VITE_GEMINI_API_KEY in .env.local and restart the dev server.';
            } else if (errMsg.includes('API key') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('validate credentials')) {
                errorText = `⚠️ Authentication Error — ${errMsg}`;
            } else if (errMsg.includes('429') || errMsg.includes('rate limit') || errMsg.includes('Rate limit') || errMsg.includes('quota')) {
                errorText = `⚠️ Rate Limited — ${errMsg}. Please wait a moment and try again.`;
            } else {
                errorText = `⚠️ AI Error — ${errMsg}`;
            }
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                sender: 'agent',
                agentId: '4',
                text: errorText,
                timestamp: new Date(),
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    // ─── Quick action handler ───────────────────────────────
    const handleAction = (action: QuickAction) => {
        switch (action.action) {
            case 'navigate':
                // Navigate to the target route and close CoPilot
                if (action.navigateTo) {
                    setIsOpen(false);
                    navigate(action.navigateTo);
                }
                break;
            case 'quick_analysis':
            case 'search_kb':
            case 'draft_rca':
            case 'run_fmea':
            case 'check_warranty':
            case 'draft_job_plan':
            case 'compare_fleet':
                // Switch to chat and PRE-FILL input — let user review and send
                setView('chat');
                const prompt = {
                    quick_analysis: `Give me a 30-second executive brief for ${pageContext.label}. Summarize the current state, critical alerts, and recommended actions.`,
                    search_kb: `Search the knowledge base for the most relevant SOPs, OEM manuals, and standards for this context: ${pageContext.label}.`,
                    draft_rca: `Help me draft a Root Cause Analysis. Start with a 5-Why framework and suggest potential failure causes per ISO 14224.`,
                    run_fmea: `Help me run an FMEA analysis. List the top failure modes, effects, and recommended detection methods per SAE JA1011.`,
                    check_warranty: `Check the warranty status for the current asset. Summarize coverage, expiry, and any open claims.`,
                    draft_job_plan: `Draft a complete job plan with tasks, BOM, labour requirements, and LOTO isolation points per ISO 55000.`,
                    compare_fleet: `Compare the health of all assets in the current fleet. Identify the worst performers and recommend prioritized actions.`,
                }[action.action];
                // Pre-fill input — user presses Enter or Send to execute
                setTimeout(() => {
                    setInputValue(prompt);
                    inputRef.current?.focus();
                }, 150);
                break;
        }
    };

    // ─── WR submit handler ──────────────────────────────────
    const handleWRSubmit = async () => {
        setWrSubmitting(true);
        setWrError(null);
        try {
            const db = DatabaseService.getInstance();
            const now = new Date().toISOString();
            await db.createWorkOrder({
                title: wrForm.title,
                description: wrForm.description,
                type: wrForm.workType,
                priority: wrForm.priority.toLowerCase(),
                status: 'WIP',
                source: 'COPILOT',
                wo_number: `CoPilot-${Date.now().toString(36).toUpperCase()}`,
                created_at: now,
                updated_at: now,
                properties: {
                    source_module: 'relantern_copilot',
                    source_page: pageContext.id,
                    source_route: location.pathname,
                },
            }, 'system_admin');
            setWrSuccess(true);
        } catch (err: any) {
            setWrError(err.message || 'Failed to create work request.');
        } finally {
            setWrSubmitting(false);
        }
    };

    // ─── Panel dimensions ───────────────────────────────────
    const panelWidth = isExpanded ? 'w-[440px]' : 'w-[380px]';
    const panelHeight = isExpanded ? 'max-h-[85vh]' : 'max-h-[70vh]';

    return (
        <>
            {/* ═══ FAB — Always visible ═══ */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 w-14 h-14 rounded-2xl shadow-lg shadow-relantern-500/30 flex items-center justify-center transition-all duration-300 group ${isOpen
                    ? 'bg-slate-700 hover:bg-slate-600 rotate-0'
                    : 'bg-gradient-to-br from-relantern-500 to-relantern-700 hover:from-relantern-400 hover:to-relantern-600 hover:shadow-xl hover:shadow-relantern-500/40 hover:scale-105'
                    }`}
                title="Relantern CoPilot · Reliability AI Coach"
            >
                {isOpen ? (
                    <X size={22} className="text-white" />
                ) : (
                    <>
                        <Sparkles size={22} className="text-white" />
                        {fabPulse && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-cyan-400 rounded-full border-2 border-white animate-pulse" />
                        )}
                    </>
                )}
            </button>

            {/* ═══ Expanded Panel ═══ */}
            {isOpen && (
                <div className={`fixed bottom-36 md:bottom-24 right-4 md:right-6 z-50 ${panelWidth} ${panelHeight} bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-black/20 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 zoom-in-95 duration-200`}>

                    {/* ─── Header ─── */}
                    <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-relantern-50 to-white flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-gradient-to-br from-relantern-500 to-relantern-700 rounded-lg text-white shadow-sm">
                                <Sparkles size={14} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 leading-tight">Relantern CoPilot</h3>
                                <p className="text-[9px] text-slate-400 uppercase tracking-wider font-medium">Reliability AI Coach · ISO 55000</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                title={isExpanded ? 'Compact' : 'Expand'}
                            >
                                {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>

                    {/* ─── Context Badge ─── */}
                    <div className="px-4 py-2 border-b border-slate-50 bg-white flex items-center justify-between shrink-0">
                        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border ${pageContext.color}`}>
                            {pageContext.icon} {pageContext.label}
                        </span>
                        {/* View Tabs */}
                        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                            {([
                                { id: 'actions' as CoPilotView, label: 'Actions', icon: <Target size={12} /> },
                                { id: 'chat' as CoPilotView, label: 'Chat', icon: <MessageCircle size={12} /> },
                            ]).map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setView(tab.id)}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${view === tab.id
                                        ? 'bg-white text-slate-700 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    {tab.icon} {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ─── ACTIONS VIEW ─── */}
                    {view === 'actions' && (
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                            {/* Page-specific header */}
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider px-1 mb-1">
                                {availableActions.some(a => a.pages.length > 0) ? `${pageContext.label} + Global Actions` : 'Global Actions'}
                            </p>
                            {availableActions.map(action => (
                                <button
                                    key={action.id}
                                    onClick={() => handleAction(action)}
                                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all group ${action.color}`}
                                >
                                    <div className="shrink-0">{action.icon}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-slate-800 group-hover:text-slate-900">{action.label}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">{action.description}</p>
                                    </div>
                                    <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
                                </button>
                            ))}

                            {/* Coaching tip */}
                            <div className="mt-3 px-3 py-2.5 bg-relantern-50 border border-relantern-100 rounded-xl">
                                <p className="text-[10px] text-relantern-700 font-medium leading-relaxed">
                                    <strong>💡 CoPilot Tip:</strong> Switch to <strong>Chat</strong> to ask any question about assets, maintenance strategy, or reliability engineering. I'm trained on ISO 55000, ISO 14224, OREDA, and SAE JA1011.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ─── CHAT VIEW ─── */}
                    {view === 'chat' && (
                        <>
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                {messages.map(msg => (
                                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${msg.sender === 'user'
                                            ? 'bg-primary-500 text-white rounded-br-sm'
                                            : 'bg-slate-50 text-slate-700 border border-slate-200 rounded-bl-sm'
                                            }`}
                                        >
                                            {msg.sender === 'agent' && msg.agentId && (
                                                <div className="flex items-center gap-1 mb-1 text-[10px] font-bold">
                                                    <Bot size={11} className={AGENTS[msg.agentId]?.color || 'text-slate-400'} />
                                                    <span className={AGENTS[msg.agentId]?.color || 'text-slate-400'}>{AGENTS[msg.agentId]?.name || 'AI'}</span>
                                                </div>
                                            )}
                                            <p className="whitespace-pre-wrap">{msg.text}</p>
                                            {msg.confidence && (
                                                <div className="mt-2 pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                                                    <span className={`flex items-center gap-1 ${msg.confidence > 80 ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                        <CheckCircle size={10} /> {msg.confidence}%
                                                    </span>
                                                    {msg.tier && <span className="text-slate-400 bg-white/80 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase">{msg.tier}</span>}
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-[9px] text-slate-300 mt-1 px-1">
                                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))}

                                {isLoading && (
                                    <div className="flex items-start gap-2">
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2 text-sm text-slate-500">
                                            <Loader2 size={14} className="animate-spin text-relantern-500" />
                                            <span className="text-xs">Analyzing...</span>
                                        </div>
                                        <button
                                            onClick={() => { setIsLoading(false); }}
                                            className="mt-1 px-2 py-1 text-[10px] text-red-500 hover:bg-red-50 rounded-lg border border-red-200 font-semibold transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Chat Input */}
                            <div className="p-3 border-t border-slate-100 bg-white shrink-0">
                                <div className="relative">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                        placeholder={`Ask about ${pageContext.label.toLowerCase()}...`}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-12 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-relantern-500 transition-all"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={isLoading || !inputValue.trim()}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-30 disabled:bg-slate-300 transition-all"
                                    >
                                        <Send size={14} />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
};
