import { useState, useEffect, useCallback } from 'react';
import { AuditService } from '../eam/services/AuditService';
import { AuditReportGenerator } from '../eam/services/AuditReportGenerator';
import { ISO55001_TEMPLATE, ISO55001_SECTIONS } from '../eam/data/audit-templates/iso55001';
import { PSM14_TEMPLATE, PSM14_SECTIONS } from '../eam/data/audit-templates/psm14';
import { API_RBI_TEMPLATE, API_RBI_SECTIONS } from '../eam/data/audit-templates/apiRbi';
import type {
    AuditRecord, AuditTemplate, AuditModuleSummary, AuditParticipant,
    AuditFindingRecord, AuditCorrectiveAction, AuditResponse,
    AuditMgmtType, AuditDomain, AuditMgmtStatus, SectionScore
} from '../types/audit';

const svc = AuditService.getInstance();

export function useAudits() {
    const [audits, setAudits] = useState<AuditRecord[]>([]);
    const [templates, setTemplates] = useState<AuditTemplate[]>([]);
    const [summary, setSummary] = useState<AuditModuleSummary>({
        total_audits: 0, planned: 0, in_progress: 0, completed: 0,
        total_findings: 0, open_findings: 0, critical_findings: 0,
        overdue_cas: 0, ca_closure_rate_pct: 100, avg_maturity: null
    });
    const [selectedAudit, setSelectedAudit] = useState<AuditRecord | null>(null);
    const [responses, setResponses] = useState<AuditResponse[]>([]);
    const [sectionScores, setSectionScores] = useState<SectionScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [seeded, setSeeded] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);

    // Seed templates on first load
    const seedTemplates = useCallback(async () => {
        if (seeded) return;
        try {
            await svc.seedTemplate(ISO55001_TEMPLATE as any, ISO55001_SECTIONS);
            await svc.seedTemplate(PSM14_TEMPLATE as any, PSM14_SECTIONS);
            await svc.seedTemplate(API_RBI_TEMPLATE as any, API_RBI_SECTIONS);
            setSeeded(true);
        } catch (e) { console.error('seedTemplates:', e); }
    }, [seeded]);

    const refresh = useCallback(async () => {
        setLoading(true);
        const [a, t, s] = await Promise.all([svc.listAudits(), svc.getTemplates(), svc.getSummary()]);
        setAudits(a); setTemplates(t); setSummary(s);
        setLoading(false);
    }, []);

    useEffect(() => { seedTemplates().then(refresh); }, []);

    const selectAudit = useCallback(async (id: string | null) => {
        if (!id) { setSelectedAudit(null); setResponses([]); setSectionScores([]); return; }
        const a = await svc.getAudit(id);
        setSelectedAudit(a);
        if (a) {
            const r = await svc.getResponses(id);
            setResponses(r);
        }
    }, []);

    const createAudit = useCallback(async (data: {
        template_id?: string; audit_type: AuditMgmtType; audit_domain: AuditDomain;
        scheduled_date?: string; scope: string; objectives?: string; industry?: string;
        lead_auditor_name?: string;
    }) => {
        const a = await svc.createAudit(data);
        if (a) await refresh();
        return a;
    }, [refresh]);

    const updateStatus = useCallback(async (id: string, status: AuditMgmtStatus) => {
        await svc.updateAuditStatus(id, status);
        await refresh();
        if (selectedAudit?.id === id) await selectAudit(id);
    }, [refresh, selectAudit, selectedAudit]);

    const addParticipant = useCallback(async (p: Omit<AuditParticipant, 'id'>) => {
        const result = await svc.addParticipant(p);
        if (result && selectedAudit) await selectAudit(selectedAudit.id);
        return result;
    }, [selectAudit, selectedAudit]);

    const removeParticipant = useCallback(async (id: string) => {
        await svc.removeParticipant(id);
        if (selectedAudit) await selectAudit(selectedAudit.id);
    }, [selectAudit, selectedAudit]);

    const submitResponse = useCallback(async (r: Omit<AuditResponse, 'id'>) => {
        const result = await svc.submitResponse(r);
        if (result && selectedAudit) {
            const rs = await svc.getResponses(selectedAudit.id);
            setResponses(rs);
        }
        return result;
    }, [selectedAudit]);

    const calculateScores = useCallback(async (auditId: string) => {
        const result = await svc.calculateMaturity(auditId);
        if (result) {
            setSectionScores(result.sections);
            await refresh();
            await selectAudit(auditId);
        }
        return result;
    }, [refresh, selectAudit]);

    const createFinding = useCallback(async (f: Omit<AuditFindingRecord, 'id' | 'raised_at' | 'ca_count' | 'ca_closed' | 'corrective_actions'>) => {
        const result = await svc.createFinding(f);
        if (result && selectedAudit) { await selectAudit(selectedAudit.id); await refresh(); }
        return result;
    }, [selectAudit, selectedAudit, refresh]);

    const createCA = useCallback(async (ca: Omit<AuditCorrectiveAction, 'id' | 'created_at'>) => {
        const result = await svc.createCorrectiveAction(ca);
        if (result && selectedAudit) await selectAudit(selectedAudit.id);
        return result;
    }, [selectAudit, selectedAudit]);

    // ── Relantern AI Analysis ──
    const runAIAnalysis = useCallback(async (auditId: string) => {
        if (sectionScores.length === 0) return null;
        setAiLoading(true);
        try {
            const result = await svc.generateAIAnalysis(auditId, sectionScores);
            await selectAudit(auditId); // Refresh to pick up ai_summary + ai_recommendations
            return result;
        } finally {
            setAiLoading(false);
        }
    }, [sectionScores, selectAudit]);

    // ── PDF Export ──
    const exportPDF = useCallback(async () => {
        if (!selectedAudit) return;
        await AuditReportGenerator.generateExecutiveReport({
            audit: selectedAudit,
            sectionScores,
        });
    }, [selectedAudit, sectionScores]);

    // ── Build context for Relantern AI panel ──
    const getAIContext = useCallback(() => {
        if (!selectedAudit) return '';
        return svc.buildAuditContextForAI(selectedAudit, sectionScores);
    }, [selectedAudit, sectionScores]);

    return {
        audits, templates, summary, selectedAudit, responses, sectionScores, loading, aiLoading,
        refresh, selectAudit, createAudit, updateStatus,
        addParticipant, removeParticipant, submitResponse,
        calculateScores, createFinding, createCA,
        runAIAnalysis, exportPDF, getAIContext,
    };
}

