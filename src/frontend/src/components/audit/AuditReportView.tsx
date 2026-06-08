import React, { useState, useEffect } from 'react';
import { Loader2, TrendingUp, AlertTriangle, CheckCircle, Map, BarChart3, FileText, Save, CheckCheck, Shield, Wrench, Target, BookOpen } from 'lucide-react';
import { auditAssessor, SIXM_DIMENSIONS } from '../../eam/services/AuditAssessor';
import { assessmentService } from '../../eam/services/AssessmentService';
import type { AssessmentRecord } from '../../eam/services/AssessmentService';
import type { AuditRegistration, DimensionResult, AuditReport, ImprovementRoadmap, RoadmapAction } from '../../eam/services/AuditAssessor';
import type { AuditAssessmentState, ScoredFinding } from '../../eam/services/AuditTypes';

interface Props {
  registration: AuditRegistration;
  results: DimensionResult[];
  auditState?: AuditAssessmentState;
  existingRecord?: AssessmentRecord | null;
  onSaved?: () => void;
}

type ReportTab = 'maturity' | 'integrity' | 'safety' | 'sixm' | 'roadmap';

const TABS: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
  { key: 'maturity', label: 'ISO Maturity', icon: <BarChart3 size={14} /> },
  { key: 'integrity', label: 'Asset Integrity', icon: <Shield size={14} /> },
  { key: 'safety', label: 'Process Safety', icon: <AlertTriangle size={14} /> },
  { key: 'sixm', label: '6M Review', icon: <Target size={14} /> },
  { key: 'roadmap', label: 'Roadmap', icon: <Map size={14} /> },
];

export const AuditReportView: React.FC<Props> = ({ registration, results, auditState, existingRecord, onSaved }) => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [roadmap, setRoadmap] = useState<ImprovementRoadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReportTab>('maturity');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [recordId, setRecordId] = useState<string | null>(existingRecord?.id || null);
  const [notes, setNotes] = useState(existingRecord?.notes || '');

  useEffect(() => {
    if (existingRecord?.report_data) {
      setReport(existingRecord.report_data);
      setRoadmap(existingRecord.roadmap_data || null);
      setLoading(false);
      return;
    }
    const generate = async () => {
      setLoading(true);
      try {
        const r = await auditAssessor.generateReport(results, registration);
        setReport(r);
        const rm = await auditAssessor.generateRoadmap(r, registration);
        setRoadmap(rm);
        if (!existingRecord) {
          setSaveStatus('saving');
          try {
            const saved = await assessmentService.createAssessment(registration, results, r, rm);
            if (saved) { setRecordId(saved.id); setSaveStatus('saved'); }
            else setSaveStatus('error');
          } catch { setSaveStatus('error'); }
        }
      } catch (e) { console.error('Report generation failed:', e); }
      setLoading(false);
    };
    generate();
  }, [results, registration, existingRecord]);

  const handleSaveNotes = async () => {
    if (!recordId) return;
    setSaveStatus('saving');
    const ok = await assessmentService.updateAssessment(recordId, { notes });
    setSaveStatus(ok ? 'saved' : 'error');
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <Loader2 size={28} className="animate-spin text-white" />
      </div>
      <h2 className="text-xl font-bold text-slate-700">Generating 5-Part Report...</h2>
      <p className="text-sm text-slate-500">Synthesizing ISO Maturity, Integrity, Safety, 6M, and Roadmap</p>
    </div>
  );

  if (!report) return <div className="text-center py-12 text-slate-500">Failed to generate report.</div>;

  const maturityColor = report.overallScore >= 4 ? '#22c55e' : report.overallScore >= 3 ? '#f59e0b' : '#ef4444';
  const findings = auditState?.scoredFindings || [];
  const integrityFindings = findings.filter(f => f.category === 'Asset Integrity');
  const safetyFindings = findings.filter(f => f.category === 'Process Safety');

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-2xl p-6 text-white shadow-xl shadow-indigo-500/20">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-indigo-200 text-xs font-mono uppercase tracking-wider mb-1">Integrated Audit Report — ISO 55000:2024 Series</p>
            <h1 className="text-2xl font-black">{registration.company}</h1>
            <p className="text-sm text-indigo-200 mt-1">{registration.industrySector} · {registration.siteName || 'All Sites'}</p>
            <p className="text-xs text-indigo-300 mt-1">Assessed by {registration.fullName} ({registration.jobTitle}) · {new Date(report.generatedAt).toLocaleDateString()}</p>
            {auditState?.intake?.orgVision && (
              <p className="text-xs text-indigo-200/80 mt-2 italic border-t border-indigo-500/30 pt-2">
                <BookOpen size={10} className="inline mr-1" />Vision: "{auditState.intake.orgVision}"
              </p>
            )}
          </div>
          <div className="text-center">
            <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur flex flex-col items-center justify-center">
              <span className="text-3xl font-black">{report.overallScore.toFixed(1)}</span>
              <span className="text-[10px] font-bold text-indigo-200">/5.0</span>
            </div>
            <div className="mt-2 px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: maturityColor + '33', color: maturityColor }}>
              {report.maturityLevel}
            </div>
          </div>
        </div>
        {/* 5-part summary stats */}
        <div className="grid grid-cols-5 gap-2 mt-4 pt-4 border-t border-white/10">
          <MiniStat label="Dimensions" value={`${results.length}/6`} />
          <MiniStat label="Findings" value={String(findings.length)} />
          <MiniStat label="Integrity" value={`${integrityFindings.length}`} />
          <MiniStat label="Safety" value={`${safetyFindings.length}`} />
          <MiniStat label="Docs Reviewed" value={`${auditState?.documentReview?.filter(d => d.status === 'received').length || 0}`} />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === t.key ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving...</span>}
          {saveStatus === 'saved' && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCheck size={12} /> Saved</span>}
          {saveStatus === 'error' && <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} /> Save failed</span>}
          {onSaved && (
            <button onClick={onSaved} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">← Back to List</button>
          )}
        </div>
      </div>

      {/* Notes */}
      {recordId && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Assessment Notes</label>
          <div className="flex gap-2">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes, observations, or follow-up actions..."
              rows={2} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:outline-none focus:border-indigo-400 placeholder:text-slate-400" />
            <button onClick={handleSaveNotes} className="self-end px-3 py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1">
              <Save size={12} /> Save
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {tab === 'maturity' && <MaturityTab report={report} />}
      {tab === 'integrity' && <IntegrityTab findings={integrityFindings} siteChecks={auditState?.siteVerification || []} />}
      {tab === 'safety' && <SafetyTab findings={safetyFindings} />}
      {tab === 'sixm' && <SixMTab report={report} />}
      {tab === 'roadmap' && (roadmap ? <RoadmapTab roadmap={roadmap} /> : <p className="text-slate-500 text-center py-8">Roadmap unavailable.</p>)}
    </div>
  );
};

// ─── Part 1: ISO Maturity ──────────────────────────────────
const MaturityTab: React.FC<{ report: AuditReport }> = ({ report }) => (
  <div className="space-y-6">
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-indigo-500" /> ISO 55001 Maturity Scorecard</h3>
      <div className="space-y-3">
        {report.dimensionResults.map(d => {
          const dim = SIXM_DIMENSIONS.find(dd => dd.key === d.dimensionKey);
          return (
            <div key={d.dimensionKey} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-700">{d.dimensionCode}: {d.dimensionLabel}</span>
                <span className="text-xs font-mono" style={{ color: dim?.color }}>{d.averageScore.toFixed(1)}/5</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(d.averageScore / 5) * 100}%`, backgroundColor: dim?.color || '#6366f1' }} />
              </div>
              {d.keyGaps.length > 0 && <p className="text-[10px] text-slate-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Gap: {d.keyGaps[0]}</p>}
            </div>
          );
        })}
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Key Findings" icon={<FileText size={14} className="text-amber-500" />}>
        {report.keyFindings.map((f, i) => <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-2"><span className="text-amber-400 mt-0.5">•</span> {f}</li>)}
      </Card>
      <Card title="Priority Recommendations" icon={<TrendingUp size={14} className="text-green-500" />}>
        {report.priorityRecommendations.map((r, i) => <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-2"><span className="text-green-400 mt-0.5">{i + 1}.</span> {r}</li>)}
      </Card>
    </div>
  </div>
);

// ─── Part 2: Asset Integrity ──────────────────────────────────
const IntegrityTab: React.FC<{ findings: ScoredFinding[]; siteChecks: any[] }> = ({ findings, siteChecks }) => {
  const siteIssues = siteChecks.filter((s: any) => s.status !== 'ok');
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Shield size={16} className="text-blue-500" /> Asset Integrity Findings</h3>
        {findings.length === 0 ? <p className="text-xs text-slate-400 text-center py-6">No asset integrity findings recorded in Step 6.</p> : (
          <div className="space-y-2">{findings.map((f, i) => <FindingRow key={i} finding={f} />)}</div>
        )}
      </div>
      {siteIssues.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Wrench size={16} className="text-orange-500" /> Site Verification Issues</h3>
          <div className="space-y-1">
            {siteIssues.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg text-xs">
                <StatusDot status={s.status} />
                <div><span className="font-semibold text-slate-700">{s.area}:</span> <span className="text-slate-600">{s.checkItem}</span>
                  {s.notes && <p className="text-slate-400 mt-0.5">{s.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Part 3: Process Safety ──────────────────────────────────
const SafetyTab: React.FC<{ findings: ScoredFinding[] }> = ({ findings }) => (
  <div className="space-y-6">
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-red-500" /> Process Safety Findings</h3>
      {findings.length === 0 ? <p className="text-xs text-slate-400 text-center py-6">No process safety findings recorded in Step 6.</p> : (
        <div className="space-y-2">{findings.map((f, i) => <FindingRow key={i} finding={f} />)}</div>
      )}
    </div>
  </div>
);

// ─── Part 4: 6M Dimension Detail ──────────────────────────────
const SixMTab: React.FC<{ report: AuditReport }> = ({ report }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-6">
    <h3 className="text-sm font-bold text-slate-800 mb-4">6M Dimension Details</h3>
    <div className="space-y-3">
      {report.dimensionResults.map(d => (
        <details key={d.dimensionKey} className="group border border-slate-100 rounded-xl">
          <summary className="px-4 py-3 cursor-pointer flex items-center justify-between hover:bg-slate-50 rounded-xl text-sm font-semibold text-slate-700">
            <span>{d.dimensionCode}: {d.dimensionLabel}</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100">{d.averageScore.toFixed(1)}/5</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <p className="text-xs text-slate-600 leading-relaxed">{d.summary}</p>
            {d.keyStrengths.length > 0 && (
              <div><p className="text-[10px] font-bold text-green-600 uppercase mb-1">Strengths</p>
                <ul className="space-y-0.5">{d.keyStrengths.map((s, i) => <li key={i} className="text-xs text-slate-600 flex gap-1.5"><CheckCircle size={12} className="text-green-400 shrink-0 mt-0.5" />{s}</li>)}</ul>
              </div>
            )}
            {d.keyGaps.length > 0 && (
              <div><p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Gaps</p>
                <ul className="space-y-0.5">{d.keyGaps.map((g, i) => <li key={i} className="text-xs text-slate-600 flex gap-1.5"><AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />{g}</li>)}</ul>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  </div>
);

// ─── Part 5: Improvement Roadmap ──────────────────────────────
const RoadmapTab: React.FC<{ roadmap: ImprovementRoadmap }> = ({ roadmap }) => (
  <div className="space-y-6">
    <RoadmapPhase title="30-Day Quick Wins" color="#22c55e" actions={roadmap.thirtyDayActions} />
    <RoadmapPhase title="90-Day Foundation" color="#f59e0b" actions={roadmap.ninetyDayActions} />
    <RoadmapPhase title="365-Day Strategic Transformation" color="#8b5cf6" actions={roadmap.yearActions} />
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Estimated Investment</p>
        <p className="text-sm font-bold text-slate-800">{roadmap.estimatedInvestment}</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Expected ROI</p>
        <p className="text-sm font-bold text-slate-800">{roadmap.expectedROI}</p>
      </div>
    </div>
  </div>
);

const RoadmapPhase: React.FC<{ title: string; color: string; actions: RoadmapAction[] }> = ({ title, color, actions }) => (
  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
    <div className="px-5 py-3 border-b border-slate-100" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
    </div>
    <div className="p-4 space-y-2">
      {actions.length === 0 ? <p className="text-xs text-slate-400 text-center py-4">No actions for this phase.</p> : (
        actions.map((a, i) => (
          <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <PriorityBadge priority={a.priority} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700">{a.action}</p>
              <div className="flex gap-3 mt-1">
                <span className="text-[10px] text-slate-400 font-mono">{a.dimension}</span>
                <span className="text-[10px] text-slate-400">→ {a.owner}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{a.expectedOutcome}</p>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

// ─── Shared Widgets ──────────────────────────────────────────
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="text-[9px] text-indigo-200 uppercase">{label}</p>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">{icon} {title}</h3>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function FindingRow({ finding }: { finding: ScoredFinding }) {
  const ratingColors: Record<string, string> = { compliant: '#22c55e', minor_gap: '#f59e0b', major_gap: '#f97316', critical_risk: '#ef4444' };
  return (
    <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <span className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded uppercase shrink-0 mt-0.5" style={{ backgroundColor: ratingColors[finding.rating] || '#94a3b8' }}>
        {finding.rating?.replace('_', ' ')}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-700">{finding.finding}</p>
        <div className="flex flex-wrap gap-2 mt-1">
          {finding.isoReference && <span className="text-[10px] font-mono text-slate-400">{finding.isoReference}</span>}
          {finding.sixmCategory && <span className="text-[10px] text-slate-400">6M: {finding.sixmCategory}</span>}
          {finding.owner && <span className="text-[10px] text-slate-400">→ {finding.owner}</span>}
        </div>
        {finding.recommendedAction && <p className="text-[10px] text-indigo-500 mt-1">Action: {finding.recommendedAction}</p>}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = { minor_gap: '#f59e0b', major_gap: '#f97316', critical: '#ef4444' };
  return <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: colors[status] || '#94a3b8' }} />;
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#22c55e' };
  return <span className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded uppercase shrink-0 mt-0.5" style={{ backgroundColor: colors[priority] || '#94a3b8' }}>{priority}</span>;
}
