import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, CheckCircle, Sparkles, X, Loader2 } from 'lucide-react';
import { apiPost } from '../api/client';
import { Button } from '../eam/components/ui';

const AGENTS = [
    { id: '1', name: 'Master AI', initial: 'M' },
    { id: '2', name: 'Planning', initial: 'P' },
    { id: '3', name: 'Scheduling', initial: 'S' },
    { id: '4', name: 'Reliability', initial: 'R' },
    { id: '5', name: 'Predictive', initial: 'Pd' },
    { id: '6', name: 'Compliance', initial: 'C' },
    { id: '7', name: 'HR/People', initial: 'H' },
    { id: '8', name: 'Vision', initial: 'V' },
    { id: '9', name: 'Sustain', initial: 'Su' },
];

interface AgentMessage {
    id: string;
    sender: 'user' | 'agent';
    agentId?: string;
    text: string;
    confidence?: number;
    tier?: string;
}

interface AgentPanelProps {
    onClose: () => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ onClose }) => {
    const [messages, setMessages] = useState<AgentMessage[]>([
        { id: '1', sender: 'agent', agentId: '4', text: 'Top 5 bad actors identified based on downtime. I have auto-drafted Defect Elimination tasks for review.', confidence: 88, tier: 'Tier 2' },
        { id: '2', sender: 'user', text: 'Show me the breakdown for the Compressor.' },
        { id: '3', sender: 'agent', agentId: '5', text: 'RUL estimated at 45 days (P50). P10=30d, P90=68d. Recommend scheduling PM within 30 days.', confidence: 82, tier: 'Tier 2' }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSend = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userText = inputValue;
        setInputValue('');

        const userMessage: AgentMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: userText
        };
        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const res = await apiPost<any>('/agents/execute', { query: userText });

            if (res.ok && res.data) {
                const domainMap: Record<string, string> = {
                    'reliability_analyst': '4',
                    'predictive_maintenance': '5',
                    'strategic_asset': '1',
                    'work_intelligence': '3',
                    'compliance_safety': '6',
                    'asset_integrity_auditor': '4',
                    'inspection_vision': '8',
                    'sustainability': '9',
                    'knowledge_people': '2'
                };

                const domain = res.data.agent;
                const mappedAgentId = domainMap[domain] || '1';

                const agentMessage: AgentMessage = {
                    id: (Date.now() + 1).toString(),
                    sender: 'agent',
                    agentId: mappedAgentId,
                    text: res.data.answer || 'I could not process that request.',
                    confidence: res.data.confidence ? Math.round(res.data.confidence * 100) : undefined,
                    tier: res.data.tier_used ? `Tier ${res.data.tier_used}` : undefined
                };
                setMessages(prev => [...prev, agentMessage]);
            } else {
                const errorMessage: AgentMessage = {
                    id: (Date.now() + 1).toString(),
                    sender: 'agent',
                    agentId: '1',
                    text: `Connection error: ${!res.ok ? res.error : 'Unknown error'}`,
                };
                setMessages(prev => [...prev, errorMessage]);
            }
        } catch (err) {
            console.error('Agent chat error:', err);
            const errorMessage: AgentMessage = {
                id: (Date.now() + 1).toString(),
                sender: 'agent',
                agentId: '1',
                text: 'A network error occurred. Please try again later.',
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="w-80 h-full bg-white border-l border-slate-200 flex flex-col z-20 shadow-overlay">
            {/* Agent Roster Header */}
            <div className="p-4 border-b border-slate-200 relative bg-gradient-to-br from-primary-700 to-primary-600 text-white">
                <button
                    onClick={onClose}
                    className="absolute top-3.5 right-3.5 text-white/70 hover:text-white p-1 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                    aria-label="Close AI panel"
                >
                    <X size={14} />
                </button>
                <div className="flex items-center justify-between mb-3 pr-8">
                    <h3 className="font-semibold flex items-center gap-2">
                        <span className="w-7 h-7 rounded-control bg-relantern-500 flex items-center justify-center shadow-sm">
                            <Sparkles size={15} className="text-white" />
                        </span>
                        Specialist Agents
                    </h3>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/15 text-white">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-safe animate-pulse" />
                        L3 Active
                    </span>
                </div>

                {/* Avatars */}
                <div className="flex flex-wrap gap-2">
                    {AGENTS.map(agent => (
                        <div
                            key={agent.id}
                            className="w-8 h-8 rounded-full bg-white/15 border border-white/25 flex items-center justify-center text-xs font-bold text-white cursor-pointer hover:bg-white/30 transition-colors"
                            title={agent.name}
                        >
                            {agent.initial}
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>

                        <div className={`max-w-[85%] rounded-card p-3 text-sm shadow-card ${msg.sender === 'user'
                            ? 'bg-primary-600 text-white rounded-br-sm'
                            : 'bg-white text-slate-800 rounded-bl-sm border border-slate-200'
                            }`}>
                            {msg.sender === 'agent' && (
                                <div className="flex items-center gap-1.5 mb-1.5 text-xs text-primary-600 font-semibold">
                                    <Bot size={12} />
                                    <span>{AGENTS.find(a => a.id === msg.agentId)?.name} Agent</span>
                                </div>
                            )}

                            <p className="leading-relaxed">{msg.text}</p>

                            {msg.sender === 'agent' && msg.confidence && (
                                <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between items-center text-xs">
                                    <span className={`flex items-center gap-1 font-medium ${msg.confidence > 80 ? 'text-accent-safe' : 'text-accent-warn'}`}>
                                        <CheckCircle size={10} />
                                        {msg.confidence}% Conf
                                    </span>
                                    <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded uppercase font-semibold" style={{ fontSize: '0.65rem' }}>
                                        {msg.tier}
                                    </span>
                                </div>
                            )}
                        </div>

                    </div>
                ))}

                {isLoading && (
                    <div className="flex items-start">
                        <div className="bg-white text-slate-600 rounded-card rounded-bl-sm border border-slate-200 p-3 max-w-[85%] flex items-center gap-2 text-sm shadow-card">
                            <Loader2 size={14} className="animate-spin text-primary-600" />
                            Thinking…
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-200">
                <div className="relative flex items-center gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask IREAMS AI…"
                        className="flex-1 bg-slate-50 border border-slate-300 rounded-control pl-4 pr-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100"
                    />
                    <Button
                        size="sm"
                        onClick={handleSend}
                        disabled={isLoading || !inputValue.trim()}
                        aria-label="Send message"
                        className="!px-3"
                    >
                        <Send size={16} />
                    </Button>
                </div>
                <p className="text-center mt-2 text-xs text-slate-400">
                    Agent router dispatches to the best specialist.
                </p>
            </div>

        </div>
    );
};
