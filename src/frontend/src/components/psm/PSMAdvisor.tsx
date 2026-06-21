/**
 * PSMAdvisor — AI Reliability Specialist Panel for Process Safety Management
 *
 * Each PSM study type renders a UNIQUE AI specialist with:
 *  - Distinct name & title (e.g., "HAZOP Facilitator", "LOPA Analyst", "Barrier Analyst")
 *  - Per-type color scheme (blue for HAZOP, violet for LOPA, orange for Bow-Tie, etc.)
 *  - Per-type system instruction supplement scoped to the governing standard
 *  - Per-type welcome message and quick actions
 *  - Active study context injection
 *  - HITL badge on all AI responses
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    X, Send, Bot, AlertTriangle, ShieldCheck, Loader2,
    Clock, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';
import { createPSMAdvisorChat } from '../../eam/services/geminiService';
import type { PSMStudy } from '../../types/safety';
import type { StudyContext, QuickAction } from './PSMAdvisorPrompts';
import { getQuickActionsForStudy, buildStudyContextHeader, getPersona } from './PSMAdvisorPrompts';

// ─── Internal chat message type ──────────────────────────────────
interface ChatMsg {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

// ─── Props ───────────────────────────────────────────────────────
interface PSMAdvisorProps {
    isOpen: boolean;
    onClose: () => void;
    study: PSMStudy | null;
    /** Serialized items summary (deviations, scenarios, etc.) */
    itemsSummary: string;
    itemCount: number;
    divisionLabel: string;
}

// ─── HITL Badge ──────────────────────────────────────────────────
const HITLBadge: React.FC = () => (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded text-[9px] font-semibold uppercase tracking-wider">
        <AlertTriangle size={9} /> AI Suggestion — Human Validation Required
    </span>
);

// ─── Markdown renderer (reuses pattern from RelanternAI) ─────────
const renderMarkdown = (text: string): React.ReactNode[] => {
    return text.split('\n').map((line, li) => {
        const parts: React.ReactNode[] = [];
        let remaining = line;
        let keyIdx = 0;

        // Headers
        if (remaining.startsWith('### ')) {
            return <h4 key={li} className="font-bold text-slate-800 text-xs mt-2 mb-1">{remaining.slice(4)}</h4>;
        }
        if (remaining.startsWith('## ')) {
            return <h3 key={li} className="font-bold text-slate-800 text-sm mt-2 mb-1">{remaining.slice(3)}</h3>;
        }

        while (remaining.length > 0) {
            const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
            const codeMatch = remaining.match(/`(.*?)`/);
            const boldIdx = boldMatch?.index ?? Infinity;
            const codeIdx = codeMatch?.index ?? Infinity;

            if (boldIdx === Infinity && codeIdx === Infinity) {
                parts.push(<span key={keyIdx++}>{remaining}</span>);
                break;
            }

            if (boldIdx <= codeIdx && boldMatch) {
                if (boldIdx > 0) parts.push(<span key={keyIdx++}>{remaining.slice(0, boldIdx)}</span>);
                parts.push(<strong key={keyIdx++} className="font-semibold text-slate-800">{boldMatch[1]}</strong>);
                remaining = remaining.slice(boldIdx + boldMatch[0].length);
            } else if (codeMatch) {
                if (codeIdx > 0) parts.push(<span key={keyIdx++}>{remaining.slice(0, codeIdx)}</span>);
                parts.push(<code key={keyIdx++} className="px-1 py-0.5 bg-slate-200 rounded text-[10px] font-mono">{codeMatch[1]}</code>);
                remaining = remaining.slice(codeIdx + codeMatch[0].length);
            }
        }

        return (
            <React.Fragment key={li}>
                {parts}
                {li < text.split('\n').length - 1 && <br />}
            </React.Fragment>
        );
    });
};

// ═══════════════════════════════════════════════════════════════
//  PSMAdvisor Component
// ═══════════════════════════════════════════════════════════════
const PSMAdvisor: React.FC<PSMAdvisorProps> = ({
    isOpen, onClose, study, itemsSummary, itemCount, divisionLabel,
}) => {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(true);
    const chatSessionRef = useRef<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contextPrimedRef = useRef(false);

    // ── Resolve persona based on active study type ──
    const persona = useMemo(
        () => getPersona(study?.study_type || null),
        [study?.study_type]
    );

    // Build study context for prompts
    const studyCtx: StudyContext = {
        study,
        itemsSummary,
        itemCount,
        divisionLabel,
    };

    // Get quick actions for current study type
    const quickActions = useMemo(
        () => getQuickActionsForStudy(study?.study_type as any || null),
        [study?.study_type]
    );

    // Initialize chat session with PSM context + persona supplement
    useEffect(() => {
        if (isOpen) {
            // Reset messages with persona-specific welcome
            setMessages([{
                id: 'welcome',
                role: 'model',
                text: persona.welcome,
                timestamp: new Date(),
            }]);

            // Create new chat session with persona-specific system instruction
            (async () => {
                try {
                    const contextHeader = buildStudyContextHeader(study);
                    chatSessionRef.current = await createPSMAdvisorChat(contextHeader, persona.systemSupplement);
                    contextPrimedRef.current = false;
                } catch (err) {
                    console.error('[PSMAdvisor] Failed to create chat session:', err);
                }
            })();
        }
    }, [isOpen, study?.id, persona]); // eslint-disable-line react-hooks/exhaustive-deps

    // Prime context when study changes
    useEffect(() => {
        if (isOpen && chatSessionRef.current && study && !contextPrimedRef.current) {
            const prime = async () => {
                try {
                    const contextMsg = `Active Study Context:\n${buildStudyContextHeader(study)}\n\nExisting Items (${itemCount}):\n${itemsSummary || 'None yet'}\n\nPlease wait for my question.`;
                    await chatSessionRef.current.sendMessage({ message: contextMsg });
                    contextPrimedRef.current = true;
                } catch (err) {
                    console.error('[PSMAdvisor] Failed to prime context:', err);
                }
            };
            prime();
        }
    }, [isOpen, study, itemsSummary, itemCount]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Send handler
    const handleSend = async (overrideInput?: string) => {
        const messageText = overrideInput || input;
        if (!messageText.trim() || isLoading) return;

        const userMsg: ChatMsg = {
            id: Date.now().toString(),
            role: 'user',
            text: messageText,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);
        if (!overrideInput) setInput('');
        setIsLoading(true);

        try {
            if (!chatSessionRef.current) {
                const contextHeader = buildStudyContextHeader(study);
                chatSessionRef.current = await createPSMAdvisorChat(contextHeader, persona.systemSupplement);
            }

            const result = await chatSessionRef.current.sendMessage({ message: messageText });
            const responseText = typeof result?.text === 'string' ? result.text : (result?.text?.() || 'No response received.');

            const aiMsg: ChatMsg = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: responseText,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (error: any) {
            console.error('[PSMAdvisor] Chat error:', error);

            let errorText = '⚠️ Unable to process your request.';
            if (!import.meta.env.VITE_AI_PROXY_URL && !import.meta.env.VITE_GEMINI_API_KEY) {
                errorText = '⚠️ **AI Not Configured** — Neither `VITE_AI_PROXY_URL` (recommended) nor `VITE_GEMINI_API_KEY` is set. Configure the backend AI proxy or add a Gemini API key to `.env.local` and restart the dev server.';
            } else if (error?.message?.includes('API key') || error?.message?.includes('401') || error?.message?.includes('403')) {
                errorText = '⚠️ **Authentication Error** — The AI service rejected the request. Please verify your configuration in `.env.local`.';
            } else {
                errorText = `⚠️ **Connection Error** — ${error?.message || 'Please check your network and API configuration.'}`;
            }

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: errorText,
                timestamp: new Date(),
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleQuickAction = (action: QuickAction) => {
        const prompt = action.buildPrompt(studyCtx);
        handleSend(prompt);
        setShowQuickActions(false);
    };

    if (!isOpen) return null;

    // ── p = shorthand for persona ──
    const p = persona;

    return (
        <div className="fixed inset-y-0 right-0 w-full md:w-[520px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 transform transition-transform duration-300 ease-in-out">
            {/* ── Header (persona-colored) ── */}
            <div className={`${p.headerGradient} text-white p-4 flex justify-between items-center shadow-md`}>
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${p.iconGradient} flex items-center justify-center shadow-lg ${p.iconShadow}`}>
                        <Bot size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-sm tracking-wide flex items-center gap-2">
                            {p.title}
                            <span className="text-[9px] px-1.5 py-0.5 bg-white/15 rounded-full font-normal">{p.badge}</span>
                        </h3>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                            <ShieldCheck size={10} /> {p.subtitle}
                        </span>
                    </div>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition">
                    <X size={20} />
                </button>
            </div>

            {/* ── Study Context Badge (persona-colored) ── */}
            {study && (
                <div className={`px-4 py-2.5 ${p.contextBg} border-b ${p.contextBorder} flex items-center gap-2`}>
                    <Sparkles size={14} className={`${p.sparkleColor} shrink-0`} />
                    <div className={`text-xs ${p.contextText} truncate`}>
                        <strong>{study.study_type.toUpperCase()}</strong> — {study.title}
                        {study.asset_name && <span className={`${p.contextAccent} ml-1`}>· {study.asset_tag || study.asset_name}</span>}
                    </div>
                    <span className={`ml-auto text-[10px] px-2 py-0.5 ${p.contextCountBg} ${p.contextCountText} rounded-full font-medium shrink-0`}>
                        {itemCount} items
                    </span>
                </div>
            )}

            {/* ── Quick Actions (persona chip hover) ── */}
            {quickActions.length > 0 && (
                <div className="border-b border-slate-100 bg-slate-50">
                    <button
                        onClick={() => setShowQuickActions(!showQuickActions)}
                        className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                    >
                        <span className="flex items-center gap-1.5">
                            <Sparkles size={12} className={p.sparkleColor} />
                            Quick Analysis Actions ({quickActions.length})
                        </span>
                        {showQuickActions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showQuickActions && (
                        <div className="px-4 pb-3 flex flex-wrap gap-2">
                            {quickActions.map((action) => (
                                <button
                                    key={action.id}
                                    onClick={() => handleQuickAction(action)}
                                    disabled={isLoading}
                                    className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-full ${p.chipHover} transition-all shadow-sm disabled:opacity-50`}
                                    title={action.description}
                                >
                                    <span className="text-sm">{action.icon}</span>
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Messages (persona user bubble color) ── */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-4">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[88%] rounded-lg p-3 text-sm shadow-sm ${msg.role === 'user'
                            ? `${p.userBubble} text-white rounded-br-none`
                            : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'
                            }`}>
                            {msg.role === 'model' && (
                                <div className="mb-1.5"><HITLBadge /></div>
                            )}
                            <div className="whitespace-pre-wrap leading-relaxed text-[13px]">
                                {renderMarkdown(msg.text)}
                            </div>
                            <div className={`text-[9px] mt-1.5 ${msg.role === 'user' ? p.userTimestamp : 'text-slate-300'}`}>
                                <Clock size={8} className="inline mr-1" />
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-slate-200 p-3 rounded-lg rounded-bl-none shadow-sm flex items-center gap-2">
                            <Loader2 size={14} className={`animate-spin ${p.spinnerColor}`} />
                            <span className="text-xs text-slate-400">Analyzing safety data...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── HITL Warning ── */}
            <div className="bg-amber-50 px-4 py-2 text-[10px] text-amber-800 flex items-start gap-2 border-t border-amber-100">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <p>{p.title} is an advisory tool. All recommendations require verification by a qualified safety engineer per OSHA 1910.119; ISO 31000. AI cannot authorize operational changes.</p>
            </div>

            {/* ── Input (persona send button & focus ring) ── */}
            <div className="p-4 bg-white border-t border-slate-200">
                <div className="relative">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder={p.placeholder}
                        className={`w-full bg-slate-50 border border-slate-300 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 ${p.inputRing} resize-none h-12 scrollbar-hide`}
                    />
                    <button
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className={`absolute right-2 top-2 p-1.5 ${p.sendBtn} text-white rounded-md disabled:opacity-50 transition`}
                    >
                        <Send size={16} />
                    </button>
                </div>
                <p className="text-[9px] text-slate-300 mt-1 text-center">
                    Powered by Gemini · {p.footerStandards}
                </p>
            </div>
        </div>
    );
};

export default PSMAdvisor;
