import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, AlertTriangle, ShieldCheck } from 'lucide-react';
import { createRelanternChat as createNexusChat } from '../services/geminiService';
import { ChatMessage } from '../types';

interface NexusAIProps {
  isOpen: boolean;
  onClose: () => void;
  contextData?: string;
}

export const NexusAI: React.FC<NexusAIProps> = ({ isOpen, onClose, contextData }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Hello. I am Relantern, your Reliability Specialist. How can I assist with asset strategy, failure analysis, or ISO compliance today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatSessionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !chatSessionRef.current) {
      chatSessionRef.current = createNexusChat();
    }
    // If context data is provided when opening, send it silently to prime the chat
    if (isOpen && contextData && chatSessionRef.current) {
      const prime = async () => {
        await chatSessionRef.current.sendMessage({ message: `Current Context: ${contextData}. Please wait for my question.` });
      }
      prime();
    }
  }, [isOpen, contextData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      if (!chatSessionRef.current) {
        chatSessionRef.current = createNexusChat();
      }

      const result = await chatSessionRef.current.sendMessage({ message: input });
      const responseText = result.text;

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "System Alert: Connection to Relantern Core interrupted. Please retry.",
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 transform transition-transform duration-300 ease-in-out">
      {/* Header */}
      <div className="bg-slate-900 text-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 p-2 rounded-lg">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-sm tracking-wide">RELANTERN AI</h3>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <ShieldCheck size={10} /> Reliability Architect
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition">
          <X size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm shadow-sm ${msg.role === 'user'
                ? 'bg-relantern-500 text-white rounded-br-none'
                : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
              }`}>
              {msg.role === 'model' && (
                <div className="flex items-center gap-1 mb-1 text-xs text-blue-600 font-semibold uppercase tracking-wider">
                  <Bot size={10} /> Relantern Advisory
                </div>
              )}
              <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 p-3 rounded-lg rounded-bl-none shadow-sm flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Warning Footer */}
      <div className="bg-amber-50 px-4 py-2 text-[10px] text-amber-800 flex items-start gap-2 border-t border-amber-100">
        <AlertTriangle size={12} className="mt-0.5" />
        <p>Relantern AI recommendations require verification by a qualified site engineer before execution. Reference ISO 31000 for risk validation.</p>
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-slate-200">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about RCA, FMEA, or Asset Strategy..."
            className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-3 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-blue-500 resize-none h-12 scrollbar-hide"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-2 p-1.5 bg-relantern-500 text-white rounded-md hover:bg-relantern-600 disabled:opacity-50 disabled:hover:bg-relantern-500 transition"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};