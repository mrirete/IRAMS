// ═══════════════════════════════════════════════════════════════════════
//  AuditService — CRUD + Governance for Audit Management
//  Standards: ISO 55001:2024, GFMAM, OSHA 1910.119, API 580/581
// ═══════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';
import type {
    AuditRecord, AuditParticipant, AuditResponse, AuditFindingRecord,
    AuditCorrectiveAction, AuditTemplate, AuditTemplateSection,
    AuditTemplateQuestion, AuditModuleSummary, AuditDomain,
    AuditMgmtType, AuditMgmtStatus, AuditCAStatus, SectionScore,
    AuditAIRecommendation
} from '../../types/audit';
import { MATURITY_LEVELS } from '../../types/audit';

export class AuditService {
    private static instance: AuditService;

    static getInstance(): AuditService {
        if (!AuditService.instance) AuditService.instance = new AuditService();
        return AuditService.instance;
    }

    // ═════════════════════════════════════════════════════════════════
    //  TEMPLATES
    // ═════════════════════════════════════════════════════════════════

    async getTemplates(): Promise<AuditTemplate[]> {
        const { data, error } = await supabase
            .from('audit_templates')
            .select('*')
            .eq('is_active', true)
            .order('name');
        if (error) { console.error('getTemplates:', error); return []; }
        return data || [];
    }

    async getTemplateWithSections(templateId: string): Promise<AuditTemplate | null> {
        const { data: template, error: tErr } = await supabase
            .from('audit_templates')
            .select('*')
            .eq('id', templateId)
            .single();
        if (tErr || !template) return null;

        const { data: sections } = await supabase
            .from('audit_template_sections')
            .select('*')
            .eq('template_id', templateId)
            .order('sort_order');

        const sectionIds = (sections || []).map((s: any) => s.id);
        const { data: questions } = sectionIds.length
            ? await supabase
                .from('audit_template_questions')
                .select('*')
                .in('section_id', sectionIds)
                .order('sort_order')
            : { data: [] };

        const sectionsWithQuestions = (sections || []).map((s: any) => ({
            ...s,
            questions: (questions || []).filter((q: any) => q.section_id === s.id)
        }));

        return { ...template, sections: sectionsWithQuestions };
    }

    async seedTemplate(template: Omit<AuditTemplate, 'id'>, sections: Array<{
        section: Omit<AuditTemplateSection, 'id' | 'template_id'>;
        questions: Array<Omit<AuditTemplateQuestion, 'id' | 'section_id'>>;
    }>): Promise<string | null> {
        // Check if already exists
        const { data: existing } = await supabase
            .from('audit_templates')
            .select('id')
            .eq('code', template.code)
            .single();
        if (existing) return existing.id;

        const { data: t, error: tErr } = await supabase
            .from('audit_templates')
            .insert({
                code: template.code,
                name: template.name,
                description: template.description,
                standard_reference: template.standard_reference,
                audit_domain: template.audit_domain,
                industry: template.industry,
                version: template.version,
                maturity_scale: template.maturity_scale || 'IAM_0_5',
                total_sections: sections.length,
                total_questions: sections.reduce((acc, s) => acc + s.questions.length, 0),
                is_active: true
            })
            .select('id')
            .single();
        if (tErr || !t) { console.error('seedTemplate:', tErr); return null; }

        for (const sec of sections) {
            const { data: s, error: sErr } = await supabase
                .from('audit_template_sections')
                .insert({ ...sec.section, template_id: t.id })
                .select('id')
                .single();
            if (sErr || !s) { console.error('seedSection:', sErr); continue; }

            if (sec.questions.length > 0) {
                const qs = sec.questions.map(q => ({ ...q, section_id: s.id }));
                const { error: qErr } = await supabase
                    .from('audit_template_questions')
                    .insert(qs);
                if (qErr) console.error('seedQuestions:', qErr);
            }
        }

        return t.id;
    }

    // ═════════════════════════════════════════════════════════════════
    //  AUDITS — CRUD
    // ═════════════════════════════════════════════════════════════════

    async listAudits(filters?: {
        status?: AuditMgmtStatus;
        domain?: AuditDomain;
        type?: AuditMgmtType;
        limit?: number;
        offset?: number;
    }): Promise<AuditRecord[]> {
        let query = supabase
            .from('audits')
            .select('*')
            .order('created_at', { ascending: false });

        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.domain) query = query.eq('audit_domain', filters.domain);
        if (filters?.type) query = query.eq('audit_type', filters.type);
        if (filters?.limit) query = query.limit(filters.limit);
        if (filters?.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);

        const { data, error } = await query;
        if (error) { console.error('listAudits:', error); return []; }
        return data || [];
    }

    async getAudit(id: string): Promise<AuditRecord | null> {
        const { data: audit, error } = await supabase
            .from('audits')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !audit) return null;

        // Load participants
        const { data: participants } = await supabase
            .from('audit_participants')
            .select('*')
            .eq('audit_id', id)
            .order('created_at');

        // Load findings with CAs
        const { data: findings } = await supabase
            .from('audit_findings')
            .select('*')
            .eq('audit_id', id)
            .order('raised_at', { ascending: false });

        const findingIds = (findings || []).map((f: any) => f.id);
        const { data: cas } = findingIds.length
            ? await supabase
                .from('audit_corrective_actions')
                .select('*')
                .in('finding_id', findingIds)
                .order('created_at')
            : { data: [] };

        const findingsWithCAs = (findings || []).map((f: any) => ({
            ...f,
            corrective_actions: (cas || []).filter((ca: any) => ca.finding_id === f.id)
        }));

        // Load template if linked
        let template: AuditTemplate | null = null;
        if (audit.template_id) {
            template = await this.getTemplateWithSections(audit.template_id);
        }

        return {
            ...audit,
            participants: participants || [],
            findings: findingsWithCAs,
            template: template || undefined,
        };
    }

    async createAudit(data: {
        template_id?: string;
        audit_type: AuditMgmtType;
        audit_domain: AuditDomain;
        scheduled_date?: string;
        scope: string;
        objectives?: string;
        criteria?: string;
        site_name?: string;
        industry?: string;
        lead_auditor_name?: string;
    }): Promise<AuditRecord | null> {
        // Get template section count if linked
        let total_sections = 0;
        if (data.template_id) {
            const { count } = await supabase
                .from('audit_template_sections')
                .select('id', { count: 'exact', head: true })
                .eq('template_id', data.template_id);
            total_sections = count || 0;
        }

        const { data: audit, error } = await supabase
            .from('audits')
            .insert({
                template_id: data.template_id || null,
                audit_type: data.audit_type,
                audit_domain: data.audit_domain,
                status: 'planned',
                scheduled_date: data.scheduled_date || null,
                scope: data.scope,
                objectives: data.objectives || null,
                criteria: data.criteria || null,
                site_name: data.site_name || null,
                industry: data.industry || 'OIL_GAS',
                total_sections,
                lead_auditor_name: data.lead_auditor_name || null,
            })
            .select('*')
            .single();

        if (error) { console.error('createAudit:', error); return null; }
        return audit;
    }

    async updateAuditStatus(id: string, status: AuditMgmtStatus, userId?: string): Promise<boolean> {
        const updates: Record<string, any> = { status, updated_at: new Date().toISOString() };
        if (status === 'in_progress') updates.start_date = new Date().toISOString();
        if (status === 'completed') updates.completion_date = new Date().toISOString();
        if (status === 'closed') {
            updates.closed_by = userId || null;
            updates.closed_at = new Date().toISOString();
        }

        const { error } = await supabase.from('audits').update(updates).eq('id', id);
        if (error) { console.error('updateAuditStatus:', error); return false; }
        return true;
    }

    async updateAuditScores(id: string, scores: {
        overall_maturity: number;
        overall_compliance_pct: number;
        sections_completed: number;
        ai_summary?: string;
        ai_recommendations?: any[];
    }): Promise<boolean> {
        const { error } = await supabase
            .from('audits')
            .update({ ...scores, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) { console.error('updateAuditScores:', error); return false; }
        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    //  PARTICIPANTS
    // ═════════════════════════════════════════════════════════════════

    async addParticipant(participant: Omit<AuditParticipant, 'id'>): Promise<AuditParticipant | null> {
        const { data, error } = await supabase
            .from('audit_participants')
            .insert(participant)
            .select('*')
            .single();
        if (error) { console.error('addParticipant:', error); return null; }
        return data;
    }

    async removeParticipant(id: string): Promise<boolean> {
        const { error } = await supabase.from('audit_participants').delete().eq('id', id);
        return !error;
    }

    // ═════════════════════════════════════════════════════════════════
    //  RESPONSES
    // ═════════════════════════════════════════════════════════════════

    async getResponses(auditId: string): Promise<AuditResponse[]> {
        const { data, error } = await supabase
            .from('audit_responses')
            .select('*')
            .eq('audit_id', auditId);
        if (error) { console.error('getResponses:', error); return []; }
        return data || [];
    }

    async submitResponse(response: Omit<AuditResponse, 'id'>): Promise<AuditResponse | null> {
        // Upsert — update if exists for this audit+question combo
        const { data, error } = await supabase
            .from('audit_responses')
            .upsert(
                { ...response, assessed_at: new Date().toISOString() },
                { onConflict: 'audit_id,question_id' }
            )
            .select('*')
            .single();
        if (error) { console.error('submitResponse:', error); return null; }
        return data;
    }

    async bulkSubmitResponses(responses: Array<Omit<AuditResponse, 'id'>>): Promise<boolean> {
        const withTimestamp = responses.map(r => ({
            ...r, assessed_at: new Date().toISOString()
        }));
        const { error } = await supabase
            .from('audit_responses')
            .upsert(withTimestamp, { onConflict: 'audit_id,question_id' });
        if (error) { console.error('bulkSubmitResponses:', error); return false; }
        return true;
    }

    // ═════════════════════════════════════════════════════════════════
    //  FINDINGS
    // ═════════════════════════════════════════════════════════════════

    async createFinding(finding: Omit<AuditFindingRecord, 'id' | 'raised_at' | 'ca_count' | 'ca_closed' | 'corrective_actions'>): Promise<AuditFindingRecord | null> {
        const { data, error } = await supabase
            .from('audit_findings')
            .insert(finding)
            .select('*')
            .single();
        if (error) { console.error('createFinding:', error); return null; }

        // Update audit finding counts
        await this.refreshAuditFindingCounts(finding.audit_id);
        return data;
    }

    async updateFindingStatus(id: string, status: string): Promise<boolean> {
        const updates: Record<string, any> = { status };
        if (status === 'closed') updates.closed_at = new Date().toISOString();
        const { error } = await supabase.from('audit_findings').update(updates).eq('id', id);
        return !error;
    }

    private async refreshAuditFindingCounts(auditId: string): Promise<void> {
        const { data: findings } = await supabase
            .from('audit_findings')
            .select('status, finding_type, severity')
            .eq('audit_id', auditId);

        if (!findings) return;

        await supabase.from('audits').update({
            total_findings: findings.length,
            open_findings: findings.filter(f => !['verified', 'closed'].includes(f.status)).length,
            critical_findings: findings.filter(f => f.severity === 'critical' || f.finding_type === 'major_nc').length,
            updated_at: new Date().toISOString()
        }).eq('id', auditId);
    }

    // ═════════════════════════════════════════════════════════════════
    //  CORRECTIVE ACTIONS
    // ═════════════════════════════════════════════════════════════════

    /** All corrective actions across audits — standalone rows (no finding) included. */
    async getAllCorrectiveActions(): Promise<AuditCorrectiveAction[]> {
        const { data, error } = await supabase
            .from('audit_corrective_actions')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) { console.error('getAllCAs:', error); return []; }
        return data || [];
    }

    async createCorrectiveAction(ca: Omit<AuditCorrectiveAction, 'id' | 'created_at'>): Promise<AuditCorrectiveAction | null> {
        const { data, error } = await supabase
            .from('audit_corrective_actions')
            .insert(ca)
            .select('*')
            .single();
        if (error) { console.error('createCA:', error); return null; }

        // Update finding CA counts (standalone CAs have no finding)
        if (ca.finding_id) await this.refreshFindingCACounts(ca.finding_id);
        return data;
    }

    /** CA → WO pipeline: record the raised work order on the corrective action. */
    async linkCAToWorkOrder(id: string, woId: string, woNumber: string): Promise<boolean> {
        const { error } = await supabase.from('audit_corrective_actions').update({
            wo_id: woId,
            wo_number: woNumber,
            updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) console.error('linkCAToWorkOrder:', error);
        return !error;
    }

    async updateCAStatus(id: string, status: AuditCAStatus, notes?: string): Promise<boolean> {
        const updates: Record<string, any> = { status, updated_at: new Date().toISOString() };
        if (status === 'completed') {
            updates.completion_date = new Date().toISOString();
            updates.completion_notes = notes || null;
        }
        const { error } = await supabase.from('audit_corrective_actions').update(updates).eq('id', id);
        return !error;
    }

    async verifyCA(id: string, userId: string, notes: string): Promise<boolean> {
        const { error } = await supabase.from('audit_corrective_actions').update({
            status: 'verified',
            verified_by: userId,
            verified_at: new Date().toISOString(),
            verification_notes: notes,
            updated_at: new Date().toISOString()
        }).eq('id', id);
        return !error;
    }

    private async refreshFindingCACounts(findingId: string): Promise<void> {
        const { data: cas } = await supabase
            .from('audit_corrective_actions')
            .select('status')
            .eq('finding_id', findingId);
        if (!cas) return;

        await supabase.from('audit_findings').update({
            ca_count: cas.length,
            ca_closed: cas.filter(c => ['completed', 'verified'].includes(c.status)).length,
        }).eq('id', findingId);
    }

    // ═════════════════════════════════════════════════════════════════
    //  SCORING ENGINE (IAM 0-5 Maturity Scale)
    // ═════════════════════════════════════════════════════════════════

    async calculateMaturity(auditId: string): Promise<{
        overall: number;
        compliance_pct: number;
        sections: SectionScore[];
    } | null> {
        const audit = await this.getAudit(auditId);
        if (!audit || !audit.template) return null;

        const responses = await this.getResponses(auditId);
        const responseMap = new Map(responses.map(r => [r.question_id, r]));

        const sectionScores: SectionScore[] = [];
        let totalWeightedScore = 0;
        let totalWeight = 0;
        let compliantCount = 0;
        let mandatoryCount = 0;
        let answeredSections = 0;

        for (const section of audit.template.sections || []) {
            const questions = section.questions || [];
            if (questions.length === 0) continue;

            let sectionTotal = 0;
            let sectionAnswered = 0;

            for (const q of questions) {
                const resp = responseMap.get(q.id);
                if (resp?.maturity_score != null) {
                    sectionTotal += resp.maturity_score;
                    sectionAnswered++;
                    if (q.is_mandatory) {
                        mandatoryCount++;
                        if (resp.maturity_score >= 3) compliantCount++;
                    }
                } else if (q.is_mandatory) {
                    mandatoryCount++;
                }
            }

            const avgMaturity = sectionAnswered > 0 ? sectionTotal / sectionAnswered : 0;
            const findings = (audit.findings || []).filter(f => f.section_code === section.code);

            sectionScores.push({
                section_id: section.id,
                section_code: section.code,
                section_title: section.title,
                weight: section.weight,
                average_maturity: Math.round(avgMaturity * 10) / 10,
                questions_answered: sectionAnswered,
                total_questions: questions.length,
                compliance_pct: sectionAnswered > 0
                    ? Math.round((questions.filter(q => {
                        const r = responseMap.get(q.id);
                        return r?.maturity_score != null && r.maturity_score >= 3;
                    }).length / sectionAnswered) * 100)
                    : 0,
                findings_count: findings.length,
            });

            if (sectionAnswered > 0) {
                totalWeightedScore += avgMaturity * section.weight;
                totalWeight += section.weight;
                answeredSections++;
            }
        }

        const overall = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 10) / 10 : 0;
        const compliance_pct = mandatoryCount > 0
            ? Math.round((compliantCount / mandatoryCount) * 100)
            : 0;

        // Persist scores
        await this.updateAuditScores(auditId, {
            overall_maturity: overall,
            overall_compliance_pct: compliance_pct,
            sections_completed: answeredSections,
        });

        return { overall, compliance_pct, sections: sectionScores };
    }

    // ═════════════════════════════════════════════════════════════════
    //  MODULE SUMMARY (Dashboard KPIs)
    // ═════════════════════════════════════════════════════════════════

    async getSummary(): Promise<AuditModuleSummary> {
        const { data: audits } = await supabase
            .from('audits')
            .select('status, overall_maturity, total_findings, open_findings, critical_findings');

        const { data: cas } = await supabase
            .from('audit_corrective_actions')
            .select('status, due_date');

        const list = audits || [];
        const caList = cas || [];
        const now = new Date();

        const closedCAs = caList.filter(c => ['completed', 'verified'].includes(c.status)).length;
        const overdueCAs = caList.filter(c =>
            ['open', 'in_progress'].includes(c.status) && c.due_date && new Date(c.due_date) < now
        ).length;

        const maturities = list.filter(a => a.overall_maturity != null).map(a => a.overall_maturity as number);

        return {
            total_audits: list.length,
            planned: list.filter(a => a.status === 'planned').length,
            in_progress: list.filter(a => a.status === 'in_progress').length,
            completed: list.filter(a => a.status === 'completed' || a.status === 'closed').length,
            total_findings: list.reduce((s, a) => s + (a.total_findings || 0), 0),
            open_findings: list.reduce((s, a) => s + (a.open_findings || 0), 0),
            critical_findings: list.reduce((s, a) => s + (a.critical_findings || 0), 0),
            overdue_cas: overdueCAs,
            ca_closure_rate_pct: caList.length > 0 ? Math.round((closedCAs / caList.length) * 100) : 100,
            avg_maturity: maturities.length > 0
                ? Math.round((maturities.reduce((a, b) => a + b, 0) / maturities.length) * 10) / 10
                : null,
        };
    }
    // ═════════════════════════════════════════════════════════════════
    //  RELANTERN AI — Gap Analysis & Service Proposal Engine
    // ═════════════════════════════════════════════════════════════════

    /**
     * Generates structured AI recommendations from audit assessment data.
     * This is the strategic sales engine: gaps become service proposals.
     */
    async generateAIAnalysis(auditId: string, sectionScores: SectionScore[]): Promise<{
        ai_summary: string;
        ai_recommendations: AuditAIRecommendation[];
    }> {
        const audit = await this.getAudit(auditId);
        if (!audit) return { ai_summary: '', ai_recommendations: [] };

        const templateName = audit.template?.name || 'Assessment';
        const industry = audit.industry || 'General';
        const overallScore = audit.overall_maturity ?? 0;

        // Build recommendations from section scores
        const recommendations: AuditAIRecommendation[] = [];

        for (const section of sectionScores) {
            if (section.average_maturity >= 4.0) continue; // Skip high-performing sections

            const gap = this.identifyGap(section);
            const recommendation = this.generateRecommendation(section, industry);
            const service = this.mapToServiceOffering(section, gap);
            const priority = this.calculatePriority(section);

            recommendations.push({
                gap,
                clause: `${section.section_code} — ${section.section_title}`,
                current_score: section.average_maturity,
                target_score: Math.min(5, Math.ceil(section.average_maturity) + 1),
                recommendation,
                service_offering: service,
                priority,
            });
        }

        // Sort by priority (critical first)
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        // Generate executive summary
        const criticalGaps = recommendations.filter(r => r.priority === 'critical' || r.priority === 'high');
        const avgCurrent = sectionScores.reduce((s, sc) => s + sc.average_maturity, 0) / (sectionScores.length || 1);
        const level = MATURITY_LEVELS[Math.min(Math.round(overallScore), 5)];

        const ai_summary = [
            `RELANTERN AI EXECUTIVE ASSESSMENT SUMMARY`,
            `═══════════════════════════════════════════`,
            ``,
            `Standard: ${templateName}`,
            `Industry: ${industry}`,
            `Overall Maturity: ${overallScore.toFixed(1)} / 5.0 (${level?.label || 'N/A'})`,
            `Compliance Rate: ${audit.overall_compliance_pct ?? 0}%`,
            `Sections Assessed: ${sectionScores.length}`,
            ``,
            `KEY FINDINGS:`,
            `• ${criticalGaps.length} critical/high-priority gaps identified`,
            `• ${recommendations.length} total improvement opportunities`,
            `• Strongest area: ${this.getStrongest(sectionScores)}`,
            `• Weakest area: ${this.getWeakest(sectionScores)}`,
            ``,
            criticalGaps.length > 0
                ? `IMMEDIATE ACTIONS REQUIRED:\n${criticalGaps.slice(0, 3).map((g, i) =>
                    `${i + 1}. [${g.priority.toUpperCase()}] ${g.gap}\n   → ${g.recommendation.substring(0, 120)}...`
                ).join('\n')}`
                : `No critical gaps identified. Focus on continuous improvement towards Level 4+ maturity.`,
            ``,
            `MATURITY TRAJECTORY:`,
            `Current position places the organization at IAM Level ${Math.round(overallScore)} (${level?.label}).`,
            avgCurrent < 3
                ? `Significant foundational work is required before the organization can be considered "Competent" (Level 3) under ${templateName}.`
                : avgCurrent < 4
                    ? `The organization demonstrates competency but has not yet reached optimization. Target Level 4 "Professional" within 12-18 months.`
                    : `The organization is performing at or near excellence. Focus on sustaining performance and leveraging predictive/AI-driven capabilities.`,
            ``,
            `This analysis was generated by Relantern AI — ERS Enterprise Reliability System.`,
            `Report is based on ${sectionScores.reduce((s, sc) => s + sc.questions_answered, 0)} assessed criteria points.`,
        ].join('\n');

        // Persist to database
        await this.updateAuditScores(auditId, {
            overall_maturity: overallScore,
            overall_compliance_pct: audit.overall_compliance_pct ?? 0,
            sections_completed: sectionScores.filter(s => s.questions_answered > 0).length,
            ai_summary,
            ai_recommendations: recommendations,
        });

        return { ai_summary, ai_recommendations: recommendations };
    }

    /**
     * Builds a structured context string for the Relantern AI panel
     */
    buildAuditContextForAI(audit: AuditRecord, sectionScores: SectionScore[]): string {
        const lines = [
            `AUDIT CONTEXT FOR RELANTERN AI`,
            `Audit: ${audit.audit_number}`,
            `Standard: ${audit.template?.name || audit.scope}`,
            `Domain: ${audit.audit_domain}`,
            `Industry: ${audit.industry}`,
            `Status: ${audit.status}`,
            `Overall Maturity: ${audit.overall_maturity?.toFixed(1) ?? 'Not scored'}`,
            `Compliance: ${audit.overall_compliance_pct ?? 0}%`,
            `Findings: ${audit.total_findings} total, ${audit.open_findings} open, ${audit.critical_findings} critical`,
            ``,
            `SECTION SCORES:`,
        ];

        for (const s of sectionScores) {
            const level = MATURITY_LEVELS[Math.min(Math.round(s.average_maturity), 5)];
            lines.push(`• ${s.section_code} ${s.section_title}: ${s.average_maturity.toFixed(1)}/5 (${level?.label}) — ${s.compliance_pct}% compliant, ${s.findings_count} findings`);
        }

        if (audit.participants && audit.participants.length > 0) {
            lines.push('', 'AUDIT TEAM:');
            for (const p of audit.participants) {
                lines.push(`• ${p.full_name} (${p.participant_role}) — ${p.company || ''}`);
            }
        }

        return lines.join('\n');
    }

    // ── Private helpers for AI recommendations ──

    private identifyGap(section: SectionScore): string {
        if (section.average_maturity < 1) return `No evidence of ${section.section_title} requirements`;
        if (section.average_maturity < 2) return `${section.section_title} — intent recognized but no systematic approach`;
        if (section.average_maturity < 3) return `${section.section_title} — developing but not yet competent`;
        return `${section.section_title} — competent but not yet optimized`;
    }

    private generateRecommendation(section: SectionScore, industry: string): string {
        const recs: Record<string, string[]> = {
            'Context of the Organization': [
                `Conduct stakeholder analysis to define asset management expectations for ${industry} operations.`,
                `Document external/internal issues impacting asset performance per ISO 55001 §4.1.`,
                `Map regulatory landscape and compliance obligations specific to ${industry} assets.`,
            ],
            'Leadership': [
                `Establish formal Asset Management Policy signed by senior leadership.`,
                `Define roles and responsibilities for asset management across all organizational levels.`,
                `Implement management review cycle with KPI-driven agenda (MTBF, MTTR, RONA).`,
            ],
            'Planning': [
                `Develop Strategic Asset Management Plan (SAMP) aligned with organizational objectives.`,
                `Implement risk-based prioritization using RPN methodology for all ${industry} assets.`,
                `Define asset management objectives with measurable targets and timelines.`,
            ],
            'Support': [
                `Establish competency framework for maintenance and reliability personnel.`,
                `Implement CMMS/EAM system for centralized asset data management.`,
                `Develop communication plan for asset management across all stakeholder groups.`,
            ],
            'Operation': [
                `Implement PM/PdM strategy based on RCM analysis for critical ${industry} equipment.`,
                `Standardize work order lifecycle management with failure coding (ISO 14224).`,
                `Establish management of change (MOC) process for asset modifications.`,
            ],
            'Performance Evaluation': [
                `Define and track leading/lagging KPIs: OEE, PM Compliance, Backlog, MTBF, MTTR.`,
                `Implement internal audit program for asset management system effectiveness.`,
                `Establish condition monitoring program for critical rotating equipment.`,
            ],
            'Improvement': [
                `Implement formal Root Cause Analysis (RCA) process for all critical failures.`,
                `Establish Bad Actor elimination program (Pareto-based, top 5 monthly).`,
                `Create defect elimination workflow integrated with CMMS work order system.`,
            ],
        };

        const key = Object.keys(recs).find(k => section.section_title.toLowerCase().includes(k.toLowerCase()));
        if (key) {
            return recs[key][Math.floor(Math.random() * recs[key].length)];
        }
        return `Develop structured improvement plan for ${section.section_title} targeting IAM Level ${Math.ceil(section.average_maturity) + 1} maturity within 6–12 months. Align with ${industry} best practices and regulatory requirements.`;
    }

    private mapToServiceOffering(section: SectionScore, gap: string): string {
        if (section.average_maturity < 1.5) return 'Asset Management Strategy Development & Implementation';
        if (section.average_maturity < 2.5) return 'EAM System Configuration & Data Migration';
        if (section.average_maturity < 3.5) return 'Reliability Engineering & PM Optimization';
        return 'Advanced Analytics & Predictive Maintenance Integration';
    }

    private calculatePriority(section: SectionScore): 'critical' | 'high' | 'medium' | 'low' {
        if (section.average_maturity < 1.0 || section.findings_count >= 3) return 'critical';
        if (section.average_maturity < 2.0 || section.findings_count >= 2) return 'high';
        if (section.average_maturity < 3.0) return 'medium';
        return 'low';
    }

    private getStrongest(scores: SectionScore[]): string {
        if (scores.length === 0) return 'N/A';
        const best = scores.reduce((a, b) => a.average_maturity > b.average_maturity ? a : b);
        return `${best.section_code} ${best.section_title} (${best.average_maturity.toFixed(1)})`;
    }

    private getWeakest(scores: SectionScore[]): string {
        if (scores.length === 0) return 'N/A';
        const worst = scores.reduce((a, b) => a.average_maturity < b.average_maturity ? a : b);
        return `${worst.section_code} ${worst.section_title} (${worst.average_maturity.toFixed(1)})`;
    }
}
