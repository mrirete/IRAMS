/**
 * RCMContextualHelp — Reusable tooltip component for SAE JA1011 guidance
 */
import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface RCMContextualHelpProps {
  question: string;
  standard?: string;
  className?: string;
}

export const RCMContextualHelp: React.FC<RCMContextualHelpProps> = ({ question, standard, className = '' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="p-0.5 text-slate-400 hover:text-violet-500 transition-colors rounded-full hover:bg-violet-50"
        type="button"
        aria-label="Help"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3 max-w-xs w-64 text-left">
            {standard && (
              <span className="rcm-step-badge mb-1.5 inline-block">{standard}</span>
            )}
            <p className="text-[11px] text-slate-600 leading-relaxed">{question}</p>
          </div>
          {/* Arrow */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white border-r border-b border-slate-200 rotate-45" />
        </div>
      )}
    </div>
  );
};

export default RCMContextualHelp;
