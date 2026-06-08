import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, ChevronRight, Database, Wrench, AlertTriangle, Clock,
  DollarSign, Activity, Shield, ExternalLink, Link2, Unlink,
  FileText, TrendingUp, BarChart3, History, Loader2,
} from 'lucide-react';
import type {
  EAMAssetDetail, EAMWorkOrder, EAMFailureTrends, RCAInvestigation,
} from '../../eam/services/AnalyzeService';

// ─── Props ────────────────────────────────────────────────────
interface EAMContextPanelProps {
  asset: EAMAssetDetail | null;
  workOrders: EAMWorkOrder[];
  failureTrends: EAMFailureTrends;
  relatedRCAs: RCAInvestigation[];
  triggerWOId: string | null;
  onLinkTriggerWO: (woId: string) => void;
  onUnlinkTriggerWO: () => void;
  onClose: () => void;
  loading?: boolean;
}

// ─── Utility functions ────────────────────────────────────────
function formatCost(val: number): string {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function critColor(c: string): { bg: string; text: string; border: string } {
  switch (c?.toUpperCase()) {
    case 'A': return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };
    case 'B': return { bg: '#fffbeb', text: '#d97706', border: '#fde68a' };
    case 'C': return { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' };
    default: return { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' };
  }
}

// ─── Badge helpers ────────────────────────────────────────────
const LEVEL_BADGES: Record<string, { label: string; color: string }> = {
  site:      { label: 'SITE',    color: '#a855f7' },
  unit:      { label: 'UNIT',    color: '#3b82f6' },
  system:    { label: 'SYSTEM',  color: '#6366f1' },
  equipment: { label: 'EQUIP',   color: '#06b6d4' },
  subunit:   { label: 'SUBUNIT', color: '#14b8a6' },
  component: { label: 'COMP',    color: '#10b981' },
};

const WO_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CM: { bg: '#fef2f2', text: '#ef4444', border: '#fecaca' },
  PM: { bg: '#eff6ff', text: '#3b82f6', border: '#bfdbfe' },
  BM: { bg: '#fffbeb', text: '#f59e0b', border: '#fde68a' },
  EM: { bg: '#faf5ff', text: '#a855f7', border: '#e9d5ff' },
};

const WO_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  OPEN:      { bg: '#eff6ff', text: '#3b82f6', border: '#bfdbfe' },
  WIP:       { bg: '#fffbeb', text: '#f59e0b', border: '#fde68a' },
  TECO:      { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
  CLOSED:    { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
  CANCELLED: { bg: '#fef2f2', text: '#ef4444', border: '#fecaca' },
};

const RCA_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:       { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
  in_progress: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  review:      { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
  closed:      { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
};

const RCA_METHOD_LABELS: Record<string, string> = {
  five_why: '5-Why', fishbone: 'Fishbone', fault_tree: 'Fault Tree',
  taproot: 'TapRooT®', apollo: 'Apollo',
};

const CRIT_LABELS: Record<string, string> = {
  A: 'Safety Critical', B: 'Production Critical', C: 'Standard',
  D: 'Low', E: 'Low',
};

// ─── Component ────────────────────────────────────────────────
export default function EAMContextPanel({
  asset, workOrders, failureTrends, relatedRCAs,
  triggerWOId, onLinkTriggerWO, onUnlinkTriggerWO, onClose, loading = false,
}: EAMContextPanelProps) {

  const [activeTab, setActiveTab] = useState<'asset' | 'wo' | 'trends' | 'related'>('asset');
  const [woFilter, setWoFilter] = useState<'all' | 'cm' | 'pm' | 'closed'>('all');
  const [expandedWO, setExpandedWO] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<string>('480px');

  // ── Responsive width via matchMedia ───────────────────────
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setPanelWidth('100vw');
      else if (w <= 1024) setPanelWidth('60%');
      else setPanelWidth('480px');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // ── Escape key handler ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Filtered WOs ──────────────────────────────────────────
  const filteredWOs = useMemo(() => {
    if (woFilter === 'all') return workOrders;
    if (woFilter === 'cm') return workOrders.filter(w => w.type?.toUpperCase() === 'CM');
    if (woFilter === 'pm') return workOrders.filter(w => w.type?.toUpperCase() === 'PM');
    if (woFilter === 'closed') return workOrders.filter(w => {
      const s = w.status?.toUpperCase();
      return s === 'TECO' || s === 'CLOSED';
    });
    return workOrders;
  }, [workOrders, woFilter]);

  // ── WO Summary KPIs ───────────────────────────────────────
  const woSummary = useMemo(() => {
    const total = workOrders.length;
    const cm = workOrders.filter(w => w.type?.toUpperCase() === 'CM').length;
    const totalCost = workOrders.reduce((s, w) => s + (w.total_cost || 0), 0);
    const avgCost = total > 0 ? totalCost / total : 0;
    return { total, cm, totalCost, avgCost };
  }, [workOrders]);

  // ── Linked trigger WO ─────────────────────────────────────
  const linkedWO = useMemo(() =>
    triggerWOId ? workOrders.find(w => w.id === triggerWOId) : null,
  [triggerWOId, workOrders]);

  // ── Failure Trends: top modes for bar chart ───────────────
  const topModes = useMemo(() => {
    const sorted = [...failureTrends.modes].sort((a, b) => b.count - a.count);
    return sorted.slice(0, 10);
  }, [failureTrends.modes]);

  const maxModeCount = useMemo(() =>
    topModes.length > 0 ? Math.max(...topModes.map(m => m.count)) : 1,
  [topModes]);

  const totalModeCount = useMemo(() =>
    failureTrends.modes.reduce((s, m) => s + m.count, 0),
  [failureTrends.modes]);

  // ── Recurrence alerts ─────────────────────────────────────
  const recurrenceAlerts = useMemo(() =>
    failureTrends.modes.filter(m => m.count >= 3),
  [failureTrends.modes]);

  // ── Tab config ────────────────────────────────────────────
  const tabs: { key: typeof activeTab; label: string; icon: React.ReactNode }[] = [
    { key: 'asset', label: 'Asset', icon: <Database size={14} /> },
    { key: 'wo', label: 'Work Orders', icon: <Wrench size={14} /> },
    { key: 'trends', label: 'Failure Trends', icon: <TrendingUp size={14} /> },
    { key: 'related', label: 'Related RCAs', icon: <FileText size={14} /> },
  ];

  // ── Shimmer helper for loading state ──────────────────────
  const Shimmer = useCallback(({ width = '100%', height = 16, borderRadius = 8 }: { width?: string | number; height?: number; borderRadius?: number }) => (
    <div style={{
      width, height, borderRadius,
      background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
      backgroundSize: '200% 100%',
      animation: 'eam-shimmer 1.5s ease-in-out infinite',
    }} />
  ), []);

  // ── Empty state helper ────────────────────────────────────
  const EmptyState = useCallback(({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16, border: '1px solid #e2e8f0',
      }}>
        {icon}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#64748b', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, maxWidth: 260 }}>{description}</div>
    </div>
  ), []);

  // ═════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════
  return (
    <>
      {/* Injected keyframe styles */}
      <style>{`
        @keyframes eam-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes eam-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes eam-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* ── Backdrop Overlay ───────────────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
          animation: 'eam-fade-in 0.2s ease-out',
        }}
      />

      {/* ── Panel ──────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: panelWidth, maxWidth: '100vw',
        zIndex: 9999, background: '#ffffff',
        boxShadow: '-8px 0 30px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        animation: 'eam-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* ── Header ─────────────────────────────────────── */}
        <div style={{
          padding: '16px 20px 0', borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc', flexShrink: 0,
        }}>
          {/* Title row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                border: '1px solid #bfdbfe',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Database size={16} color="#3b82f6" />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                EAM Context
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: 8,
                border: '1px solid #e2e8f0', background: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#64748b',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#fecaca'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 0, overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '10px 16px', fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#3b82f6' : '#64748b',
                    background: 'transparent', border: 'none',
                    borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content Area ───────────────────────────────── */}
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '20px',
        }}>

          {/* Loading state */}
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Shimmer width="60%" height={20} />
              <Shimmer width="100%" height={80} />
              <Shimmer width="100%" height={60} />
              <Shimmer width="80%" height={20} />
              <Shimmer width="100%" height={100} />
              <Shimmer width="40%" height={20} />
            </div>
          ) : (
            <>
              {/* ═══════ TAB 1: Asset Overview ═══════════════ */}
              {activeTab === 'asset' && (
                <>
                  {!asset ? (
                    <EmptyState
                      icon={<Database size={24} color="#94a3b8" />}
                      title="No Asset Selected"
                      description="Link this investigation to an asset to view its details, hierarchy, and criticality information."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                      {/* 1. Hierarchy Breadcrumb */}
                      {asset.breadcrumb && asset.breadcrumb.length > 0 && (
                        <div style={{
                          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                          gap: 4, padding: '10px 14px',
                          background: '#f8fafc', borderRadius: 10,
                          border: '1px solid #e2e8f0',
                        }}>
                          {asset.breadcrumb.map((crumb, i) => {
                            const badge = LEVEL_BADGES[crumb.level?.toLowerCase()] || { label: crumb.level, color: '#64748b' };
                            return (
                              <React.Fragment key={crumb.id}>
                                {i > 0 && <ChevronRight size={12} color="#94a3b8" style={{ flexShrink: 0 }} />}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{
                                    fontSize: 9, fontWeight: 800, letterSpacing: '0.05em',
                                    padding: '2px 6px', borderRadius: 4,
                                    background: `${badge.color}15`, color: badge.color,
                                    border: `1px solid ${badge.color}30`,
                                  }}>
                                    {badge.label}
                                  </span>
                                  <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
                                    {crumb.name}
                                  </span>
                                </div>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      )}

                      {/* 2. Identity Card */}
                      <div style={{
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        borderRadius: 14, border: '1px solid #e2e8f0',
                        padding: '20px', position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Glass shimmer accent */}
                        <div style={{
                          position: 'absolute', top: -30, right: -30,
                          width: 120, height: 120, borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
                        }} />
                        <div style={{
                          fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
                          fontSize: 18, fontWeight: 700, color: '#0f172a',
                          marginBottom: 6, letterSpacing: '0.02em',
                        }}>
                          {asset.asset_tag}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>
                          {asset.name}
                        </div>
                        {asset.description && (
                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 12 }}>
                            {asset.description}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {asset.equipment_type && (
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 8,
                              background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                            }}>
                              {asset.equipment_type}
                            </span>
                          )}
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 8,
                            background: asset.status?.toLowerCase() === 'active' ? '#ecfdf5' : '#f8fafc',
                            color: asset.status?.toLowerCase() === 'active' ? '#059669' : '#64748b',
                            border: `1px solid ${asset.status?.toLowerCase() === 'active' ? '#a7f3d0' : '#e2e8f0'}`,
                          }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: asset.status?.toLowerCase() === 'active' ? '#059669' : '#94a3b8',
                            }} />
                            {asset.status || 'Unknown'}
                          </span>
                        </div>
                      </div>

                      {/* 3. Criticality Badge */}
                      {asset.criticality && (
                        <div style={{
                          padding: '16px 20px', borderRadius: 12,
                          background: `linear-gradient(135deg, ${critColor(asset.criticality).bg}, ${critColor(asset.criticality).border}40)`,
                          border: `1px solid ${critColor(asset.criticality).border}`,
                          display: 'flex', alignItems: 'center', gap: 14,
                        }}>
                          <div style={{
                            width: 44, height: 44, borderRadius: 12,
                            background: `${critColor(asset.criticality).text}15`,
                            border: `1px solid ${critColor(asset.criticality).text}25`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Shield size={22} color={critColor(asset.criticality).text} />
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: critColor(asset.criticality).text }}>
                              Criticality {asset.criticality.toUpperCase()}
                            </div>
                            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                              {CRIT_LABELS[asset.criticality.toUpperCase()] || 'Unclassified'}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 4. Design Data Grid */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
                        borderRadius: 12, overflow: 'hidden',
                        border: '1px solid #e2e8f0',
                      }}>
                        {[
                          { label: 'Manufacturer', value: asset.manufacturer },
                          { label: 'Model', value: asset.model },
                          { label: 'Serial Number', value: asset.serial_number },
                          { label: 'Equipment Type', value: asset.equipment_type },
                          { label: 'Location', value: asset.location },
                          { label: 'Install Date', value: asset.install_date ? formatDate(asset.install_date) : null },
                        ].map((item, i) => (
                          <div key={item.label} style={{
                            padding: '12px 14px',
                            background: i % 2 === 0 ? '#f8fafc' : '#ffffff',
                            borderBottom: i < 4 ? '1px solid #f1f5f9' : 'none',
                          }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                              {item.label}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: item.value ? '#1e293b' : '#cbd5e1' }}>
                              {item.value || '—'}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 5. Quick Action */}
                      <button style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 8, width: '100%', padding: '12px 16px',
                        background: '#eff6ff', color: '#2563eb',
                        border: '1px solid #bfdbfe', borderRadius: 10,
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; }}
                      >
                        <ExternalLink size={14} />
                        View in Asset Register
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ═══════ TAB 2: Work Orders ═════════════════ */}
              {activeTab === 'wo' && (
                <>
                  {workOrders.length === 0 ? (
                    <EmptyState
                      icon={<Wrench size={24} color="#94a3b8" />}
                      title="No Work Orders"
                      description="No work order history found for this asset. Work orders will appear here once maintenance activities are recorded."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                      {/* Summary Bar — 4 KPI cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                        {[
                          { label: 'Total WOs', value: woSummary.total.toString(), icon: <Wrench size={14} />, color: '#3b82f6' },
                          { label: 'CM WOs', value: woSummary.cm.toString(), icon: <AlertTriangle size={14} />, color: '#ef4444' },
                          { label: 'Total Cost', value: formatCost(woSummary.totalCost), icon: <DollarSign size={14} />, color: '#059669' },
                          { label: 'Avg Cost', value: formatCost(woSummary.avgCost), icon: <Activity size={14} />, color: '#8b5cf6' },
                        ].map(kpi => (
                          <div key={kpi.label} style={{
                            padding: '12px 10px', borderRadius: 10,
                            background: '#f8fafc', border: '1px solid #e2e8f0',
                            textAlign: 'center',
                          }}>
                            <div style={{ color: kpi.color, marginBottom: 6, display: 'flex', justifyContent: 'center' }}>
                              {kpi.icon}
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>
                              {kpi.value}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontWeight: 600, letterSpacing: '0.03em' }}>
                              {kpi.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Filter Pills */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {([
                          { key: 'all', label: 'All' },
                          { key: 'cm', label: 'CM Only' },
                          { key: 'pm', label: 'PM Only' },
                          { key: 'closed', label: 'TECO/Closed' },
                        ] as const).map(pill => {
                          const isActive = woFilter === pill.key;
                          return (
                            <button
                              key={pill.key}
                              onClick={() => setWoFilter(pill.key)}
                              style={{
                                padding: '6px 14px', borderRadius: 20,
                                fontSize: 12, fontWeight: isActive ? 700 : 500,
                                background: isActive ? '#3b82f6' : '#f1f5f9',
                                color: isActive ? '#fff' : '#475569',
                                border: isActive ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                                cursor: 'pointer', transition: 'all 0.15s',
                              }}
                            >
                              {pill.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Linked Trigger WO (pinned at top) */}
                      {linkedWO && (
                        <div style={{
                          padding: '14px 16px', borderRadius: 12,
                          background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
                          border: '1.5px solid #6ee7b7',
                          position: 'relative',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Link2 size={14} color="#059669" />
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>Linked Trigger WO</span>
                            </div>
                            <button
                              onClick={onUnlinkTriggerWO}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 6,
                                fontSize: 11, fontWeight: 600,
                                background: '#fff', color: '#ef4444',
                                border: '1px solid #fecaca', cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                            >
                              <Unlink size={10} /> Unlink
                            </button>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#065f46' }}>
                            {linkedWO.wo_number}
                          </div>
                          <div style={{ fontSize: 12, color: '#047857', marginTop: 2, lineHeight: 1.4 }}>
                            {linkedWO.title}
                          </div>
                          {linkedWO.total_cost > 0 && (
                            <div style={{ fontSize: 12, color: '#065f46', fontWeight: 600, marginTop: 6 }}>
                              {formatCost(linkedWO.total_cost)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* WO Cards List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filteredWOs.map(wo => {
                          const isExpanded = expandedWO === wo.id;
                          const isLinked = wo.id === triggerWOId;
                          const typeStyle = WO_TYPE_COLORS[wo.type?.toUpperCase()] || { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' };
                          const statusStyle = WO_STATUS_COLORS[wo.status?.toUpperCase()] || { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' };
                          return (
                            <div
                              key={wo.id}
                              style={{
                                borderRadius: 12, border: `1px solid ${isLinked ? '#6ee7b7' : '#e2e8f0'}`,
                                background: isLinked ? '#f0fdf4' : '#fff',
                                overflow: 'hidden',
                                transition: 'all 0.2s',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                              }}
                              onMouseEnter={e => {
                                if (!isLinked) {
                                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                                  e.currentTarget.style.transform = 'translateY(-1px)';
                                }
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
                                e.currentTarget.style.transform = 'translateY(0)';
                              }}
                            >
                              {/* Card header — clickable to expand */}
                              <div
                                onClick={() => setExpandedWO(isExpanded ? null : wo.id)}
                                style={{ padding: '14px 16px', cursor: 'pointer' }}
                              >
                                {/* Row 1: WO# + badges */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                                    {wo.wo_number}
                                  </span>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                    background: typeStyle.bg, color: typeStyle.text, border: `1px solid ${typeStyle.border}`,
                                  }}>
                                    {wo.type?.toUpperCase() || '—'}
                                  </span>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                    background: statusStyle.bg, color: statusStyle.text, border: `1px solid ${statusStyle.border}`,
                                  }}>
                                    {wo.status?.toUpperCase() || '—'}
                                  </span>
                                  {isLinked && (
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                      background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0',
                                    }}>
                                      ✓ Trigger WO
                                    </span>
                                  )}
                                </div>
                                {/* Row 2: Title (truncated) */}
                                <div style={{
                                  fontSize: 13, color: '#475569', lineHeight: 1.4,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {wo.title || wo.description || '—'}
                                </div>
                                {/* Row 3: Date + Cost */}
                                <div style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  marginTop: 8,
                                }}>
                                  <span style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Clock size={11} />
                                    {formatDate(wo.created_at)}
                                  </span>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                                    {formatCost(wo.total_cost || 0)}
                                  </span>
                                </div>
                              </div>

                              {/* Expanded section */}
                              {isExpanded && (
                                <div style={{
                                  padding: '0 16px 14px', borderTop: '1px solid #f1f5f9',
                                  paddingTop: 14,
                                }}>
                                  {/* Full description */}
                                  {wo.description && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                                        Description
                                      </div>
                                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                                        {wo.description}
                                      </div>
                                    </div>
                                  )}
                                  {/* Failure details grid */}
                                  <div style={{
                                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                                    marginBottom: 12,
                                  }}>
                                    {[
                                      { label: 'Failure Mode', value: wo.failure_mode },
                                      { label: 'Failure Cause', value: wo.failure_cause },
                                      { label: 'Remedy', value: wo.remedy },
                                      { label: 'Cost', value: wo.total_cost ? formatCost(wo.total_cost) : null },
                                    ].map(item => (
                                      <div key={item.label}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 3 }}>
                                          {item.label}
                                        </div>
                                        <div style={{ fontSize: 12, color: item.value ? '#1e293b' : '#cbd5e1', fontWeight: item.value ? 500 : 400 }}>
                                          {item.value || '—'}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  {/* Link as Trigger button */}
                                  {!isLinked && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); onLinkTriggerWO(wo.id); }}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '8px 14px', borderRadius: 8,
                                        fontSize: 12, fontWeight: 600,
                                        background: '#eff6ff', color: '#2563eb',
                                        border: '1px solid #bfdbfe', cursor: 'pointer',
                                        transition: 'all 0.15s', width: '100%',
                                        justifyContent: 'center',
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; }}
                                    >
                                      <Link2 size={12} />
                                      Link as Trigger WO
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ═══════ TAB 3: Failure Trends ══════════════ */}
              {activeTab === 'trends' && (
                <>
                  {failureTrends.modes.length === 0 ? (
                    <EmptyState
                      icon={<TrendingUp size={24} color="#94a3b8" />}
                      title="No Failure Trends"
                      description="No failure mode data available for this asset. Trends will appear as work orders with failure coding are completed."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                      {/* Summary KPIs */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        {[
                          { label: 'Corrective (CM)', value: failureTrends.totalCM.toString(), color: '#ef4444', icon: <AlertTriangle size={14} /> },
                          { label: 'Preventive (PM)', value: failureTrends.totalPM.toString(), color: '#3b82f6', icon: <Wrench size={14} /> },
                          { label: 'Total Cost (12mo)', value: formatCost(failureTrends.totalCost), color: '#059669', icon: <DollarSign size={14} /> },
                        ].map(kpi => (
                          <div key={kpi.label} style={{
                            padding: '14px 12px', borderRadius: 10,
                            background: '#f8fafc', border: '1px solid #e2e8f0',
                            textAlign: 'center',
                          }}>
                            <div style={{ color: kpi.color, marginBottom: 6, display: 'flex', justifyContent: 'center' }}>
                              {kpi.icon}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>
                              {kpi.value}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontWeight: 600, letterSpacing: '0.03em' }}>
                              {kpi.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Failure Mode Frequency — Horizontal bar chart */}
                      <div style={{
                        borderRadius: 12, border: '1px solid #e2e8f0',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          padding: '12px 16px', background: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          <BarChart3 size={14} color="#3b82f6" />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                            Failure Mode Frequency
                          </span>
                          <span style={{
                            fontSize: 11, color: '#94a3b8', fontWeight: 500, marginLeft: 'auto',
                          }}>
                            Top {topModes.length}
                          </span>
                        </div>
                        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {topModes.map((mode, i) => {
                            const pct = totalModeCount > 0 ? ((mode.count / totalModeCount) * 100) : 0;
                            const barWidth = maxModeCount > 0 ? ((mode.count / maxModeCount) * 100) : 0;
                            // Color intensity by rank
                            const barColors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1'];
                            const barColor = barColors[i] || '#94a3b8';
                            return (
                              <div key={mode.mode}>
                                <div style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  marginBottom: 4,
                                }}>
                                  <span style={{ fontSize: 12, color: '#475569', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
                                    {mode.mode}
                                  </span>
                                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {mode.count} ({pct.toFixed(0)}%)
                                  </span>
                                </div>
                                <div style={{
                                  height: 8, borderRadius: 4,
                                  background: '#f1f5f9', overflow: 'hidden',
                                }}>
                                  <div style={{
                                    width: `${barWidth}%`, height: '100%',
                                    borderRadius: 4, background: barColor,
                                    transition: 'width 0.4s ease-out',
                                  }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Failure Timeline */}
                      {failureTrends.timeline.length > 0 && (
                        <div style={{
                          borderRadius: 12, border: '1px solid #e2e8f0',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            padding: '12px 16px', background: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <History size={14} color="#3b82f6" />
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                              Failure Timeline
                            </span>
                          </div>
                          <div style={{ padding: '12px 16px', maxHeight: 320, overflowY: 'auto' }}>
                            {failureTrends.timeline.map((evt, i) => {
                              const dotColor = evt.type?.toUpperCase() === 'CM' ? '#ef4444'
                                : evt.type?.toUpperCase() === 'BM' ? '#f59e0b' : '#3b82f6';
                              return (
                                <div key={`${evt.wo_number}-${i}`} style={{
                                  display: 'flex', alignItems: 'flex-start', gap: 12,
                                  paddingBottom: i < failureTrends.timeline.length - 1 ? 16 : 0,
                                  position: 'relative',
                                }}>
                                  {/* Vertical line connector */}
                                  {i < failureTrends.timeline.length - 1 && (
                                    <div style={{
                                      position: 'absolute', left: 36, top: 18,
                                      width: 1, height: 'calc(100% - 2px)',
                                      background: '#e2e8f0',
                                    }} />
                                  )}
                                  {/* Date */}
                                  <div style={{
                                    fontSize: 11, color: '#94a3b8', fontWeight: 500,
                                    width: 28, textAlign: 'right', flexShrink: 0,
                                    paddingTop: 2,
                                  }}>
                                    {formatDate(evt.date)}
                                  </div>
                                  {/* Dot */}
                                  <div style={{
                                    width: 10, height: 10, borderRadius: '50%',
                                    background: dotColor, flexShrink: 0,
                                    marginTop: 4, zIndex: 1,
                                    boxShadow: `0 0 0 3px ${dotColor}20`,
                                  }} />
                                  {/* Content */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>
                                        {evt.wo_number}
                                      </span>
                                      <span style={{ fontSize: 11, color: '#475569' }}>
                                        {evt.mode}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                      {formatCost(evt.cost)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Recurrence Alerts */}
                      {recurrenceAlerts.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {recurrenceAlerts.map(mode => (
                            <div key={mode.mode} style={{
                              padding: '12px 16px', borderRadius: 10,
                              background: '#fffbeb', border: '1px solid #fde68a',
                              display: 'flex', alignItems: 'flex-start', gap: 10,
                            }}>
                              <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                              <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                                <strong>{mode.mode}</strong> has recurred <strong>{mode.count} times</strong> in 12 months — chronic defect candidate
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ═══════ TAB 4: Related RCAs ════════════════ */}
              {activeTab === 'related' && (
                <>
                  {relatedRCAs.length === 0 ? (
                    <EmptyState
                      icon={<FileText size={24} color="#94a3b8" />}
                      title="No Prior Investigations"
                      description="No prior RCA investigations found on this asset. Previous root cause analyses will appear here for reference."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                      {/* Re-occurrence Banner */}
                      <div style={{
                        padding: '14px 18px', borderRadius: 12,
                        background: relatedRCAs.length >= 3
                          ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                          : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                        border: `1px solid ${relatedRCAs.length >= 3 ? '#fecaca' : '#fde68a'}`,
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <AlertTriangle size={18} color={relatedRCAs.length >= 3 ? '#dc2626' : '#d97706'} />
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: relatedRCAs.length >= 3 ? '#991b1b' : '#92400e',
                        }}>
                          ⚠️ This asset has {relatedRCAs.length} prior RCA investigation{relatedRCAs.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Investigation Cards */}
                      {relatedRCAs.map(rca => {
                        const statusStyle = RCA_STATUS_COLORS[rca.status || ''] || RCA_STATUS_COLORS.draft;
                        const methodLabel = RCA_METHOD_LABELS[rca.method || ''] || rca.method || 'RCA';
                        return (
                          <div
                            key={rca.id}
                            style={{
                              borderRadius: 12, border: '1px solid #e2e8f0',
                              background: '#fff', padding: '16px',
                              transition: 'all 0.2s',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                              e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)';
                              e.currentTarget.style.transform = 'translateY(0)';
                            }}
                          >
                            {/* Title */}
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8, lineHeight: 1.4 }}>
                              {rca.title}
                            </div>
                            {/* Badges row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd',
                              }}>
                                {methodLabel}
                              </span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                background: statusStyle.bg, color: statusStyle.text,
                                border: `1px solid ${statusStyle.border}`,
                              }}>
                                {(rca.status || 'draft').replace('_', ' ').toUpperCase()}
                              </span>
                            </div>
                            {/* Root cause summary */}
                            {rca.root_cause_summary && (
                              <div style={{
                                fontSize: 12, color: '#475569', lineHeight: 1.5,
                                marginBottom: 10,
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                display: '-webkit-box', WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}>
                                {rca.root_cause_summary}
                              </div>
                            )}
                            {/* Footer: date + view link */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            }}>
                              <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Clock size={11} />
                                {formatDate(rca.created_at)}
                              </span>
                              <span style={{
                                fontSize: 11, fontWeight: 600, color: '#3b82f6',
                                display: 'flex', alignItems: 'center', gap: 4,
                              }}>
                                <ExternalLink size={11} />
                                View
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
