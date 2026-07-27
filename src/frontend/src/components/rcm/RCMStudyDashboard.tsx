/**
 * RCMStudyDashboard — Premium dashboard with KPIs, study cards, and loading skeletons
 */
import React from 'react';
import {
  FileText, Clock, CheckCircle, AlertTriangle, Shield,
  MoreVertical, Eye, Edit3, Trash2, Plus, RefreshCw,
  TrendingUp, Sparkles
} from 'lucide-react';
import { AvatarStack } from '../analyze/CollaboratorPicker';
import type { RCMDashboardProps, RCMStudy } from './types';
import { STATUS_COLORS, CRIT_COLORS } from './types';

// ── KPI Card — compact on mobile (2×2 chips), roomy on desktop ──
const KPICard: React.FC<{
  label: string; value: number; icon: React.ReactNode;
  color: string; accentColor: string; trend?: string;
}> = ({ label, value, icon, color, accentColor, trend }) => (
  <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all group">
    <div className="flex items-stretch h-full">
      <div className="w-1 shrink-0" style={{ background: accentColor }} />
      <div className="flex-1 p-3 sm:p-5 flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
          <p className="text-xl sm:text-3xl font-bold text-slate-800 mt-0.5 sm:mt-1 tabular-nums">{value}</p>
          {trend && (
            <p className="hidden sm:flex text-[10px] text-slate-400 mt-1 items-center gap-1">
              <TrendingUp size={10} className="text-emerald-500" />
              {trend}
            </p>
          )}
        </div>
        <div className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl shrink-0 ${color} transition-transform group-hover:scale-110 [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-5 sm:[&>svg]:h-5`}>
          {icon}
        </div>
      </div>
    </div>
  </div>
);

// ── Skeleton Card ────────────────────────────────────────────
const SkeletonCard: React.FC = () => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
    <div className="flex items-center gap-2">
      <div className="rcm-skeleton h-5 w-16" />
      <div className="rcm-skeleton h-5 w-12" />
    </div>
    <div className="rcm-skeleton h-4 w-3/4" />
    <div className="rcm-skeleton h-3 w-1/2" />
    <div className="rcm-skeleton h-2 w-full rounded-full mt-2" />
    <div className="flex items-center gap-2 mt-2">
      <div className="rcm-skeleton h-3 w-20" />
      <div className="rcm-skeleton h-3 w-24" />
    </div>
  </div>
);

// ── Study Card Menu ──────────────────────────────────────────
const StudyCardMenu: React.FC<{
  study: RCMStudy;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: () => void;
}> = ({ study, open, onToggle, onOpen, onEdit, onDelete }) => (
  <div className="relative">
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
    >
      <MoreVertical size={14} />
    </button>
    {/* Invisible backdrop — closes the menu on any outside tap */}
    {open && (
      <div
        className="fixed inset-0 z-10"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      />
    )}
    {open && (
      <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 w-40 animate-in fade-in zoom-in-95 duration-150">
        <button onClick={onOpen} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <Eye size={12} /> Open Study
        </button>
        <button onClick={onEdit} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
          <Edit3 size={12} /> Edit Details
        </button>
        <hr className="my-1 border-slate-100" />
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
          <Trash2 size={12} /> Delete Study
        </button>
      </div>
    )}
  </div>
);

// ── Main Component ───────────────────────────────────────────
export const RCMStudyDashboard: React.FC<RCMDashboardProps> = ({
  studies, loading, searchQuery, onSelectStudy, onCreateStudy, onEditStudy, onDeleteStudy,
}) => {
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  const filteredStudies = React.useMemo(() => {
    if (!searchQuery) return studies;
    const q = searchQuery.toLowerCase();
    return studies.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.asset_id || '').toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q)
    );
  }, [studies, searchQuery]);

  const kpis = React.useMemo(() => [
    { label: 'Total Studies', value: studies.length, icon: <FileText size={20} />, color: 'text-slate-600 bg-slate-50', accentColor: '#64748b' },
    { label: 'In Progress', value: studies.filter(s => s.status === 'in_progress').length, icon: <Clock size={20} />, color: 'text-primary-600 bg-primary-50', accentColor: '#3b82f6' },
    { label: 'Approved', value: studies.filter(s => s.status === 'approved').length, icon: <CheckCircle size={20} />, color: 'text-emerald-600 bg-emerald-50', accentColor: '#10b981' },
    { label: 'Under Review', value: studies.filter(s => s.status === 'review').length, icon: <AlertTriangle size={20} />, color: 'text-amber-600 bg-amber-50', accentColor: '#f59e0b' },
  ], [studies]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* KPI Row — 2×2 compact grid on mobile, 4-up on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {kpis.map((kpi, i) => (
          <KPICard key={i} {...kpi} />
        ))}
      </div>

      {/* Study Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : filteredStudies.length === 0 ? (
        /* Empty State */
        <div className="bg-gradient-to-br from-white via-slate-50 to-primary-50/30 border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent-cyan/10 flex items-center justify-center">
            <Shield size={32} className="text-accent-cyan" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">No RCM Studies Yet</h3>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            Create your first RCM study to define optimal maintenance strategies per SAE JA1011.
          </p>
          <button
            onClick={onCreateStudy}
            className="mt-6 px-6 py-3 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)]"
          >
            <Plus size={16} className="inline mr-2" /> Create RCM Study
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudies.map(study => {
            const sc = STATUS_COLORS[study.status] || STATUS_COLORS.draft;
            return (
              <div
                key={study.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:border-accent-cyan/50 hover:shadow-lg hover:scale-[1.01] transition-all group relative"
              >
                {/* Top accent strip */}
                <div className="h-1" style={{ background: study.status === 'approved' ? '#10b981' : study.status === 'in_progress' ? '#3b82f6' : study.status === 'review' ? '#f59e0b' : '#e2e8f0' }} />

                <div className="p-5">
                  {/* Header: badges + menu */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-md border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${sc.dot} mr-1`} />
                        {study.status.replace('_', ' ')}
                      </span>
                      {study.criticality_rank && (
                        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${CRIT_COLORS[study.criticality_rank]}`}>
                          Crit {study.criticality_rank}
                        </span>
                      )}
                    </div>
                    <StudyCardMenu
                      study={study}
                      open={menuOpen === study.id}
                      onToggle={() => setMenuOpen(menuOpen === study.id ? null : study.id)}
                      onOpen={() => { setMenuOpen(null); onSelectStudy(study); }}
                      onEdit={(e) => { setMenuOpen(null); onEditStudy(study, e); }}
                      onDelete={() => { setMenuOpen(null); onDeleteStudy(study); }}
                    />
                  </div>

                  {/* Body — clickable */}
                  <button onClick={() => onSelectStudy(study)} className="w-full text-left">
                    <h3 className="text-sm font-bold text-slate-800 group-hover:text-accent-cyan transition-colors truncate">
                      {study.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {study.study_type.replace(/_/g, ' ')} • {study.asset_id || 'No asset linked'}
                    </p>

                    {/* Completion bar (placeholder based on available data) */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[9px] text-slate-400 mb-1">
                        <span>Completion</span>
                        <span className="font-bold">{study.completion_pct ?? 0}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${study.completion_pct ?? 0}%`,
                            background: (study.completion_pct ?? 0) > 75 ? '#10b981' : (study.completion_pct ?? 0) > 40 ? '#3b82f6' : '#f59e0b',
                          }}
                        />
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                          {study.rcm_source === 'ai_generated' ? <><Sparkles size={10} className="text-primary-400" /> AI</> : '📝 Manual'}
                        </span>
                        <span>{new Date(study.updated_at).toLocaleDateString()}</span>
                      </div>
                      {(study as any).collaborators?.length > 0 && (
                        <AvatarStack collaborators={(study as any).collaborators} max={3} size="sm" />
                      )}
                    </div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RCMStudyDashboard;
