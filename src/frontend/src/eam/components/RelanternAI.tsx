import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, AlertTriangle, ShieldCheck, Sparkles, TrendingUp, DollarSign, Wrench, BarChart3, Target, Loader2, Clock, Search } from 'lucide-react';
import { createRelanternChat, proxyAIChat, isAIProxyEnabled } from '../services/geminiService';
import { ChatMessage } from '../types';

// ─── Quick Action Chip Definitions by Context ─────────────
const QUICK_ACTIONS: Record<string, { label: string; icon: React.ReactNode; prompt: string }[]> = {
  asset: [
    { label: 'TCO Analysis', icon: <DollarSign size={12} />, prompt: 'Based on the asset context provided, calculate the Total Cost of Ownership including acquisition, cumulative maintenance, downtime cost, and projected disposal. Provide a breakdown and recommend whether to continue maintaining or replace.' },
    { label: 'OREDA Benchmark', icon: <BarChart3 size={12} />, prompt: 'Compare this asset\'s actual failure rate and MTBF against OREDA generic industry data for this equipment class. Highlight whether performance is above or below benchmark and recommend actions.' },
    { label: 'PM Strategy', icon: <Wrench size={12} />, prompt: 'Based on this asset\'s criticality, failure history, and condition data, recommend the optimal preventive maintenance strategy: Time-Based, Condition-Based, or Run-to-Failure. Justify with RCM logic and ISO 55000 principles.' },
    { label: 'Replace vs Repair', icon: <TrendingUp size={12} />, prompt: 'Analyze the repair cost trajectory for this asset. Project remaining useful life against cumulative maintenance spend. At what point does replacement deliver better ROI? Include payback period estimate.' },
  ],
  workOrder: [
    { label: 'Root Cause', icon: <Target size={12} />, prompt: 'Based on the failure codes and work order context, suggest the most probable root causes using ISO 14224 taxonomy. Rank by likelihood and recommend investigation steps.' },
    { label: 'Cost Estimate', icon: <DollarSign size={12} />, prompt: 'Estimate the total cost for this work order based on asset type, work type, labor rates, and historical maintenance data. Include labor, materials, and downtime cost.' },
    { label: 'Optimize Tasks', icon: <Wrench size={12} />, prompt: 'Review the task list for this work order. Identify any missing safety steps, redundant tasks, or optimization opportunities. Suggest improvements based on best maintenance practices.' },
  ],
  dashboard: [
    { label: 'Daily Briefing', icon: <Sparkles size={12} />, prompt: 'Provide an executive morning briefing summarizing: critical alerts, overdue PMs, bad actor assets, budget status, and top risks. Format for a Plant Director audience.' },
    { label: 'Bad Actor Plan', icon: <Target size={12} />, prompt: 'Identify the top cost and downtime drivers from the data. For each bad actor, suggest a defect elimination strategy with estimated cost savings and implementation timeline.' },
    { label: 'Spend Projection', icon: <DollarSign size={12} />, prompt: 'Project maintenance spend for the remainder of the fiscal year based on current trajectory. Highlight areas of budget overrun risk and suggest cost optimization opportunities.' },
  ],
  finops: [
    { label: 'Budget Health', icon: <DollarSign size={12} />, prompt: 'Analyze current budget vs actuals across all cost centers. Identify variance drivers, flag overspending areas, and recommend corrective actions to stay within budget.' },
    { label: 'RONA Analysis', icon: <TrendingUp size={12} />, prompt: 'Calculate Return on Net Assets for the asset fleet. Identify which asset groups deliver the best and worst returns. Recommend capital allocation priorities.' },
    { label: 'Warranty Recovery', icon: <ShieldCheck size={12} />, prompt: 'Review recent repair costs against active warranty coverage. Identify repairs that should have been warranty claims and estimate recoverable value.' },
  ],
  inventory: [
    { label: 'Reorder Intelligence', icon: <Wrench size={12} />, prompt: 'Analyze current stock levels, usage velocity, and lead times. Recommend optimal reorder points and quantities using criticality-weighted EOQ. Flag stockout risks on critical items.' },
    { label: 'Dead Stock', icon: <DollarSign size={12} />, prompt: 'Identify inventory items not used in 12+ months. Calculate holding cost and recommend disposition: transfer, sell, or write off.' },
  ],
  readings: [
    { label: 'Anomaly Check', icon: <AlertTriangle size={12} />, prompt: 'Analyze recent condition monitoring data for anomalies. Flag any readings deviating from historical baseline and suggest probable causes and recommended actions.' },
    { label: 'P-F Curve Position', icon: <TrendingUp size={12} />, prompt: 'Based on the condition data trends, estimate where this asset is on the P-F curve. How much potential failure lead time remains? Recommend intervention timing.' },
  ],
  reliability: [
    { label: 'Failure Analysis', icon: <Target size={12} />, prompt: 'Based on the asset health index and RUL data in context, perform a failure analysis. Identify dominant failure modes using ISO 14224 taxonomy, estimate failure probability at 30/90/365 day horizons, and recommend risk mitigation actions.' },
    { label: 'Weibull Fit', icon: <BarChart3 size={12} />, prompt: 'Using the asset\'s operating data and failure history, recommend appropriate Weibull distribution parameters (β, η). Interpret the shape parameter for failure pattern (infant mortality, random, or wear-out) and recommend maintenance strategy.' },
    { label: 'RCM Strategy', icon: <Wrench size={12} />, prompt: 'Based on the reliability intelligence data in context (Health Index, RUL, Failure Probability, Criticality), recommend the optimal RCM strategy per SAE JA1011. Should this asset be on time-based PM, condition-based monitoring, or run-to-failure? Justify with cost-risk tradeoff.' },
    { label: 'Defect Elimination', icon: <Target size={12} />, prompt: 'Analyze this asset\'s reliability data to identify chronic defects. Draft a defect elimination plan including root cause hypothesis, recommended corrective actions, expected reliability improvement, and estimated cost savings.' },
  ],
  people: [
    { label: 'Skill Gap Analysis', icon: <Target size={12} />, prompt: 'Analyze workforce skills versus maintenance requirements. Identify critical skill gaps, estimate the cost impact of using contractors to fill gaps, and recommend training priorities with ROI estimates.' },
    { label: 'Capacity Planning', icon: <BarChart3 size={12} />, prompt: 'Project available wrench-hours versus planned maintenance demand for the next quarter. Flag capacity constraints and recommend resource leveling strategies.' },
  ],
  serviceRequest: [
    { label: 'Auto-Triage', icon: <Target size={12} />, prompt: 'Based on the service request context, assess the asset criticality and reported impact to recommend a priority level (Emergency/Urgent/Normal/Low). Calculate the RPN and justify the recommendation per ISO 55000 risk-based prioritization.' },
    { label: 'Similar Work', icon: <Search size={12} />, prompt: 'Check if there are similar open service requests or work orders on this asset. Flag potential duplicates and recommend whether to merge or proceed independently.' },
  ],
  recurringWork: [
    { label: 'PM Effectiveness', icon: <Target size={12} />, prompt: 'Analyze the execution history and failure data for this PM. Calculate the value ratio (failures prevented vs cost). Recommend: continue as-is, adjust interval, suspend, or convert to condition-based monitoring.' },
    { label: 'Interval Optimization', icon: <TrendingUp size={12} />, prompt: 'Based on MTBF data, failure patterns, and OREDA benchmarks for this equipment class, recommend the optimal PM interval. Reference P-F interval theory and SAE JA1011.' },
    { label: 'PdM Migration', icon: <Wrench size={12} />, prompt: 'Evaluate whether this time-based PM could be converted to condition-based monitoring. Identify applicable PdM technologies (vibration, thermography, oil analysis, ultrasonic) and expected cost savings.' },
  ],
  scheduling: [
    { label: 'Resource Conflicts', icon: <AlertTriangle size={12} />, prompt: 'Analyze the current schedule for resource conflicts, overloaded technicians, and equipment isolation overlaps. Recommend optimal rescheduling to minimize operational impact.' },
    { label: 'Load Balancing', icon: <BarChart3 size={12} />, prompt: 'Compare available wrench-hours versus planned work for the next 2 weeks by craft. Identify bottleneck crafts and suggest leveling strategies including contractor augmentation.' },
  ],
  vendor: [
    { label: 'Vendor Scorecard', icon: <Target size={12} />, prompt: 'Generate a vendor performance scorecard based on delivery history, quality metrics, pricing competitiveness, and compliance. Rate overall vendor risk and recommend improvement actions.' },
    { label: 'Single-Source Risk', icon: <AlertTriangle size={12} />, prompt: 'Identify critical parts sourced from a single vendor. Assess supply chain risk and recommend dual-sourcing strategies for critical items with lead times and cost implications.' },
  ],
  moc: [
    { label: 'Impact Assessment', icon: <AlertTriangle size={12} />, prompt: 'Based on the Management of Change context, assess the technical and financial risk per ISO 31000. Identify all affected documents, procedures, training requirements, and recommend a risk mitigation plan.' },
    { label: 'Affected Assets', icon: <Wrench size={12} />, prompt: 'Identify all assets, PM programs, procedures, and training records that may be impacted by this change. Recommend a change execution plan with sequencing and validation steps.' },
  ],
  notifications: [
    { label: 'Priority Summary', icon: <Sparkles size={12} />, prompt: 'Summarize all unread notifications by severity and module. Highlight critical items requiring immediate attention and suggest an optimal action sequence to address them efficiently.' },
  ],
  general: [
    { label: 'Ask Specialist', icon: <Sparkles size={12} />, prompt: '' },
  ],
};

interface RelanternAIProps {
  isOpen: boolean;
  onClose: () => void;
  contextData?: string;
  contextType?: string;
}

// ─── HITL Badge ──────────────────────────────────────────────
const HITLBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded text-[9px] font-semibold uppercase tracking-wider">
    <AlertTriangle size={9} /> AI Suggestion — Human Validation Required
  </span>
);

// ─── Simple Markdown Renderer ────────────────────────────────
const renderMarkdown = (text: string): React.ReactNode[] => {
  return text.split('\n').map((line, li) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let keyIdx = 0;

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

export const RelanternAI: React.FC<RelanternAIProps> = ({ isOpen, onClose, contextData, contextType }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: "I'm your **Reliability Specialist**, an AI-powered reliability and asset value advisor.\n\nI can help with failure analysis, maintenance strategy, cost optimization, and executive decision support — all grounded in OREDA benchmarks, ISO 55000, and RCM best practices.\n\nHow can I help you maximize asset value today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatSessionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track whether we're using the proxy or direct SDK
  const useProxy = isAIProxyEnabled();
  // Accumulate context for proxy-mode priming
  const primedContextRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen && !useProxy && !chatSessionRef.current) {
      try {
        chatSessionRef.current = createRelanternChat();
      } catch (err) {
        console.error('[ReliabilitySpecialist] Failed to create chat session:', err);
      }
    }
    if (isOpen && contextData) {
      if (useProxy) {
        // For proxy mode, just store the context — it gets sent with each request
        primedContextRef.current = contextData;
      } else if (chatSessionRef.current) {
        const prime = async () => {
          try {
            await chatSessionRef.current.sendMessage({ message: `Current Context: ${contextData}. Please wait for my question.` });
          } catch (err) {
            console.error('[ReliabilitySpecialist] Failed to prime context:', err);
          }
        };
        prime();
      }
    }
  }, [isOpen, contextData, useProxy]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (overrideInput?: string) => {
    const messageText = overrideInput || input;
    if (!messageText.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: messageText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    if (!overrideInput) setInput('');
    setIsLoading(true);

    try {
      let responseText: string;

      if (useProxy) {
        // Route through the backend AI proxy (API key stays server-side)
        responseText = await proxyAIChat(
          messageText,
          contextType || 'general',
          primedContextRef.current,
          contextType,
        );
      } else {
        // Direct Gemini SDK fallback (dev mode)
        if (!chatSessionRef.current) {
          chatSessionRef.current = createRelanternChat();
        }
        const result = await chatSessionRef.current.sendMessage({ message: messageText });
        responseText = typeof result?.text === 'string' ? result.text : (result?.text?.() || 'No response received.');
      }

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      console.error('[ReliabilitySpecialist] Chat error:', error);

      let errorText = '⚠️ Unable to process your request.';
      if (!import.meta.env.VITE_AI_PROXY_URL && !import.meta.env.VITE_GEMINI_API_KEY) {
        errorText = '⚠️ **AI Not Configured** — Neither `VITE_AI_PROXY_URL` (recommended) nor `VITE_GEMINI_API_KEY` is set. Configure the backend AI proxy or add a Gemini API key to `.env.local` and restart the dev server.';
      } else if (error?.message?.includes('API key') || error?.message?.includes('401') || error?.message?.includes('403') || error?.message?.includes('405')) {
        errorText = '⚠️ **Authentication Error** — The AI service rejected the request (HTTP ' + (error?.message?.match(/\d{3}/)?.[0] || '4xx') + '). Please verify your Gemini API key or backend proxy configuration in `.env.local`.';
      } else {
        errorText = `⚠️ **Connection Error** — ${error?.message || 'Please check your network and API configuration, then retry.'}`;
      }

      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: errorText,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
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

  const handleQuickAction = (prompt: string) => {
    if (!prompt) return;
    handleSend(prompt);
  };

  const activeChips = QUICK_ACTIONS[contextType || 'general'] || QUICK_ACTIONS.general;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[480px] bg-white shadow-2xl z-[60] flex flex-col border-l border-slate-200 transform transition-transform duration-300 ease-in-out pb-[env(safe-area-inset-bottom,0px)]">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-sm tracking-wide">RELIABILITY SPECIALIST</h3>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <ShieldCheck size={10} /> AI-Powered · ISO 55000 · HITL
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition">
          <X size={20} />
        </button>
      </div>

      {/* Quick Actions */}
      {activeChips.length > 0 && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-2">
          {activeChips.filter(c => c.prompt).map((chip, i) => (
            <button
              key={i}
              onClick={() => handleQuickAction(chip.prompt)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-full hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 transition-all shadow-sm disabled:opacity-50"
            >
              {chip.icon}
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm shadow-sm ${msg.role === 'user'
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'
              }`}>
              {msg.role === 'model' && (
                <div className="mb-1.5"><HITLBadge /></div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(msg.text)}
              </div>
              {/* Timestamp */}
              <div className={`text-[9px] mt-1.5 ${msg.role === 'user' ? 'text-blue-200' : 'text-slate-300'}`}>
                <Clock size={8} className="inline mr-1" />
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 p-3 rounded-lg rounded-bl-none shadow-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-blue-400" />
              <span className="text-xs text-slate-400">Analyzing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* HITL Warning Footer */}
      <div className="bg-amber-50 px-4 py-2 text-[10px] text-amber-800 flex items-start gap-2 border-t border-amber-100">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <p>Reliability Specialist is an advisory tool. All recommendations require verification by a qualified engineer before execution. ISO 31000/55000 · AI cannot authorize shutdowns, purchases, or asset disposal.</p>
      </div>

      {/* Input — extra bottom padding on mobile so it sits above the BottomNav */}
      <div className="p-4 pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] sm:pb-4 bg-white border-t border-slate-200 mb-14 sm:mb-0">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about TCO, RCA, FMEA, PM strategy, or asset ROI..."
            className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none h-12 scrollbar-hide"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-2 p-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-md hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 transition"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[9px] text-slate-300 mt-1 text-center">
          Powered by Gemini · All responses are advisory · ISO 55000 · HITL
        </p>
      </div>
    </div>
  );
};