import React, { useState } from 'react';
import { ClipboardCheck, Users, Cog, ClipboardList, Package, Gauge, Cloud, ArrowRight, Sparkles } from 'lucide-react';
import type { AuditRegistration } from '../../eam/services/AuditAssessor';
import { SIXM_DIMENSIONS } from '../../eam/services/AuditAssessor';

const INDUSTRY_OPTIONS = [
  { value: 'Oil & Gas (Upstream)', label: 'Oil & Gas — Upstream' },
  { value: 'Oil & Gas (Midstream)', label: 'Oil & Gas — Midstream' },
  { value: 'Oil & Gas (Downstream)', label: 'Oil & Gas — Downstream' },
  { value: 'Manufacturing', label: 'Manufacturing' },
  { value: 'Mining & Minerals', label: 'Mining & Minerals' },
  { value: 'Power Generation', label: 'Power Generation' },
  { value: 'Utilities', label: 'Utilities' },
  { value: 'Pharmaceutical', label: 'Pharmaceutical' },
  { value: 'Food & Beverage', label: 'Food & Beverage' },
  { value: 'Other', label: 'Other' },
];

const ICON_MAP: Record<string, React.ComponentType<{size?: number; className?: string}>> = {
  Users, Cog, ClipboardList, Package, Gauge, Cloud,
};

interface Props {
  onStart: (reg: AuditRegistration) => void;
}

export const AuditWelcome: React.FC<Props> = ({ onStart }) => {
  const [showReg, setShowReg] = useState(false);
  const [form, setForm] = useState<AuditRegistration>({
    fullName: '', jobTitle: '', company: '', email: '', mobile: '', industrySector: 'Oil & Gas (Upstream)', siteName: '',
  });

  const canSubmit = form.fullName && form.company && form.email && form.industrySector;

  if (!showReg) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/30">
            <Sparkles size={36} className="text-white" />
          </div>
          <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-3">
            6M Maturity Assessment
          </h1>
          <p className="text-lg text-slate-500 leading-relaxed">
            AI-powered audit across <strong>6 critical dimensions</strong> of asset management excellence.
            Powered by Relantern Intelligence.
          </p>
        </div>

        {/* 6M Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl mx-auto mb-10 w-full">
          {SIXM_DIMENSIONS.map(dim => {
            const Icon = ICON_MAP[dim.icon] || ClipboardCheck;
            return (
              <div key={dim.key} className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-slate-300 transition-all group">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${dim.gradient} flex items-center justify-center shadow-sm`}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400">{dim.code}</span>
                    <h3 className="text-sm font-bold text-slate-800 -mt-0.5">{dim.label}</h3>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">{dim.description}</p>
                <p className="text-[9px] text-slate-400 mt-1 font-mono">{dim.standards[0]}</p>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={() => setShowReg(true)}
          className="px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-lg font-bold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:scale-[1.02] transition-all flex items-center gap-3"
        >
          <ClipboardCheck size={22} />
          Begin Audit Assessment
          <ArrowRight size={18} />
        </button>
        <p className="text-xs text-slate-400 mt-3">30 questions · ~20 minutes · AI-scored maturity report</p>
      </div>
    );
  }

  // Registration Form
  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
          <Users size={24} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Assessor Registration</h2>
        <p className="text-sm text-slate-500 mt-1">Tell us about yourself and your organization</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name *">
            <input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="J. Martinez" className="input-field" />
          </Field>
          <Field label="Job Title">
            <input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} placeholder="Reliability Engineer" className="input-field" />
          </Field>
          <Field label="Company *">
            <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Acme Energy" className="input-field" />
          </Field>
          <Field label="Email *">
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="j.martinez@acme.com" className="input-field" />
          </Field>
          <Field label="Mobile">
            <input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder="+1 555 0123" className="input-field" />
          </Field>
          <Field label="Site / Location">
            <input value={form.siteName} onChange={e => setForm(f => ({ ...f, siteName: e.target.value }))} placeholder="Houston Refinery" className="input-field" />
          </Field>
        </div>
        <Field label="Industry Sector *">
          <select value={form.industrySector} onChange={e => setForm(f => ({ ...f, industrySector: e.target.value }))} className="input-field">
            {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        <div className="flex justify-between items-center pt-4 border-t border-slate-100">
          <button onClick={() => setShowReg(false)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
          <button
            onClick={() => canSubmit && onStart(form)}
            disabled={!canSubmit}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-40 transition-all flex items-center gap-2"
          >
            Launch Assessment <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}
