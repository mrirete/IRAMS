// ═══════════════════════════════════════════════════════════════════════
//  AuditReportGenerator — PDF Report Generation (Client-side)
//  Uses jsPDF for executive-grade audit reports
// ═══════════════════════════════════════════════════════════════════════

import type { AuditRecord, SectionScore, AuditAIRecommendation } from '../../types/audit';
import { MATURITY_LEVELS } from '../../types/audit';

// Dynamic import of jsPDF to avoid bundle issues
async function loadJsPDF() {
    const { default: jsPDF } = await import('jspdf');
    return jsPDF;
}

interface ReportData {
    audit: AuditRecord;
    sectionScores: SectionScore[];
}

export class AuditReportGenerator {

    static async generateExecutiveReport(data: ReportData): Promise<void> {
        const jsPDF = await loadJsPDF();
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const { audit, sectionScores } = data;
        const W = 210; // A4 width
        const margin = 20;
        const contentW = W - margin * 2;
        let y = 0;

        // ── Helper functions ──
        const addPage = () => { doc.addPage(); y = margin; };
        const checkPage = (needed: number) => { if (y + needed > 277) addPage(); };

        const drawLine = (yPos: number, color = [200, 200, 210]) => {
            doc.setDrawColor(color[0], color[1], color[2]);
            doc.setLineWidth(0.3);
            doc.line(margin, yPos, W - margin, yPos);
        };

        const setFont = (style: 'bold' | 'normal' | 'italic', size: number, color: number[] = [30, 41, 59]) => {
            doc.setFont('helvetica', style);
            doc.setFontSize(size);
            doc.setTextColor(color[0], color[1], color[2]);
        };

        // ═══════════════════════════════════════════════════════
        //  PAGE 1: Cover Page
        // ═══════════════════════════════════════════════════════
        // Header band
        doc.setFillColor(15, 23, 42); // brand-800
        doc.rect(0, 0, W, 70, 'F');

        // Accent stripe
        doc.setFillColor(6, 182, 212); // accent-cyan
        doc.rect(0, 70, W, 3, 'F');

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.setTextColor(255, 255, 255);
        doc.text('AUDIT REPORT', margin, 35);

        doc.setFontSize(14);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(audit.template?.name || 'Enterprise Audit Assessment', margin, 48);

        doc.setFontSize(11);
        doc.setTextColor(100, 116, 139);
        doc.text(audit.audit_number, margin, 60);

        // Meta block
        y = 85;
        const metaItems = [
            ['Audit Number', audit.audit_number],
            ['Domain', audit.audit_domain === 'AMS' ? 'Asset Management System' : audit.audit_domain === 'AIM' ? 'Asset Integrity Management' : audit.audit_domain === 'PSM' ? 'Process Safety Management' : audit.audit_domain],
            ['Standard', audit.template?.standard_reference || '—'],
            ['Type', audit.audit_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
            ['Status', audit.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
            ['Industry', audit.industry || '—'],
            ['Site', audit.site_name || '—'],
            ['Lead Auditor', audit.lead_auditor_name || 'Relantern AI'],
            ['Assessment Date', audit.start_date ? new Date(audit.start_date).toLocaleDateString() : audit.scheduled_date ? new Date(audit.scheduled_date).toLocaleDateString() : '—'],
            ['Report Generated', new Date().toLocaleDateString()],
        ];

        setFont('bold', 12, [15, 23, 42]);
        doc.text('Assessment Summary', margin, y); y += 8;
        drawLine(y); y += 5;

        for (const [label, value] of metaItems) {
            setFont('normal', 10, [100, 116, 139]);
            doc.text(label, margin, y);
            setFont('bold', 10, [30, 41, 59]);
            doc.text(value, margin + 55, y);
            y += 6;
        }

        // Overall Maturity Score (big number)
        if (audit.overall_maturity != null) {
            y += 10;
            drawLine(y); y += 8;

            doc.setFillColor(240, 249, 255); // light blue bg
            doc.roundedRect(margin, y - 3, contentW, 35, 3, 3, 'F');

            setFont('bold', 11, [100, 116, 139]);
            doc.text('OVERALL MATURITY SCORE (IAM 0–5)', margin + 5, y + 5);

            const level = MATURITY_LEVELS[Math.min(Math.round(audit.overall_maturity), 5)];
            const rgb = hexToRgb(level.color);

            doc.setFontSize(32);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(rgb[0], rgb[1], rgb[2]);
            doc.text(audit.overall_maturity.toFixed(1), margin + 5, y + 25);

            setFont('bold', 14, rgb);
            doc.text(level.label.toUpperCase(), margin + 35, y + 25);

            setFont('normal', 10, [100, 116, 139]);
            doc.text(`${audit.overall_compliance_pct || 0}% Compliance`, margin + contentW - 40, y + 25);

            y += 40;
        }

        // Participants
        if (audit.participants && audit.participants.length > 0) {
            y += 5;
            checkPage(30);
            setFont('bold', 12, [15, 23, 42]);
            doc.text('Audit Team', margin, y); y += 6;
            drawLine(y); y += 5;

            for (const p of audit.participants) {
                checkPage(10);
                setFont('bold', 9, [30, 41, 59]);
                doc.text(`${p.full_name}`, margin, y);
                setFont('normal', 9, [100, 116, 139]);
                doc.text(`(${p.participant_role.replace(/_/g, ' ')}) — ${p.company || ''}  |  ${p.email || ''}`, margin + 45, y);
                if (p.certifications && p.certifications.length > 0) {
                    setFont('italic', 8, [6, 182, 212]);
                    doc.text(p.certifications.join(', '), W - margin - 5, y, { align: 'right' });
                }
                y += 5;
            }
        }

        // ═══════════════════════════════════════════════════════
        //  PAGE 2: Section Scores
        // ═══════════════════════════════════════════════════════
        if (sectionScores.length > 0) {
            addPage();

            setFont('bold', 16, [15, 23, 42]);
            doc.text('Maturity Assessment Results', margin, y); y += 3;
            doc.setFillColor(6, 182, 212);
            doc.rect(margin, y, 40, 1.5, 'F'); y += 10;

            // Table header
            const cols = [margin, margin + 12, margin + 80, margin + 105, margin + 130, margin + 155];
            setFont('bold', 8, [100, 116, 139]);
            doc.text('Code', cols[0], y);
            doc.text('Section', cols[1], y);
            doc.text('Score', cols[2], y);
            doc.text('Level', cols[3], y);
            doc.text('Compliance', cols[4], y);
            doc.text('Findings', cols[5], y);
            y += 2; drawLine(y); y += 5;

            for (const s of sectionScores) {
                checkPage(12);
                const level = MATURITY_LEVELS[Math.min(Math.round(s.average_maturity), 5)];
                const rgb = hexToRgb(level.color);

                setFont('bold', 9, [30, 41, 59]);
                doc.text(s.section_code, cols[0], y);

                setFont('normal', 9, [30, 41, 59]);
                const title = s.section_title.length > 35 ? s.section_title.substring(0, 32) + '...' : s.section_title;
                doc.text(title, cols[1], y);

                // Score with color
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(rgb[0], rgb[1], rgb[2]);
                doc.text(s.average_maturity.toFixed(1), cols[2], y);

                setFont('normal', 8, rgb);
                doc.text(level.label, cols[3], y);

                setFont('normal', 9, [30, 41, 59]);
                doc.text(`${s.compliance_pct}%`, cols[4], y);
                doc.text(`${s.findings_count}`, cols[5], y);

                // Progress bar
                y += 3;
                doc.setFillColor(226, 232, 240);
                doc.roundedRect(cols[1], y, 60, 2, 1, 1, 'F');
                doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                doc.roundedRect(cols[1], y, Math.max(2, (s.average_maturity / 5) * 60), 2, 1, 1, 'F');

                y += 7;
            }

            // Maturity scale legend
            y += 10;
            checkPage(25);
            drawLine(y); y += 6;
            setFont('bold', 10, [15, 23, 42]);
            doc.text('IAM Maturity Scale Reference', margin, y); y += 6;

            for (const level of MATURITY_LEVELS) {
                const rgb = hexToRgb(level.color);
                doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                doc.circle(margin + 3, y - 1.5, 2.5, 'F');
                setFont('bold', 9, rgb);
                doc.text(`${level.value} — ${level.label}`, margin + 9, y);
                setFont('normal', 8, [100, 116, 139]);
                doc.text(level.description, margin + 42, y);
                y += 5;
            }
        }

        // ═══════════════════════════════════════════════════════
        //  PAGE 3: Findings
        // ═══════════════════════════════════════════════════════
        if (audit.findings && audit.findings.length > 0) {
            addPage();

            setFont('bold', 16, [15, 23, 42]);
            doc.text('Audit Findings', margin, y); y += 3;
            doc.setFillColor(249, 115, 22); // orange
            doc.rect(margin, y, 40, 1.5, 'F'); y += 10;

            for (const f of audit.findings) {
                checkPage(25);

                // Severity badge
                const sevColor = f.severity === 'critical' ? [239, 68, 68] : f.severity === 'high' ? [249, 115, 22] : f.severity === 'medium' ? [234, 179, 8] : [34, 197, 94];
                doc.setFillColor(sevColor[0], sevColor[1], sevColor[2]);
                doc.roundedRect(margin, y - 3, 18, 5, 1, 1, 'F');
                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text(f.severity.toUpperCase(), margin + 1, y);

                setFont('bold', 9, [30, 41, 59]);
                doc.text(`${f.finding_number}  —  ${f.finding_type.replace(/_/g, ' ').toUpperCase()}`, margin + 22, y);

                if (f.standard_reference) {
                    setFont('italic', 8, [100, 116, 139]);
                    doc.text(`Ref: ${f.standard_reference}`, W - margin, y, { align: 'right' });
                }
                y += 5;

                setFont('normal', 9, [30, 41, 59]);
                const lines = doc.splitTextToSize(f.description, contentW - 5);
                doc.text(lines, margin + 2, y);
                y += lines.length * 4 + 4;

                drawLine(y, [230, 230, 235]); y += 4;
            }
        }

        // ═══════════════════════════════════════════════════════
        //  PAGE 4: AI Recommendations & Service Proposals
        // ═══════════════════════════════════════════════════════
        if (audit.ai_recommendations && audit.ai_recommendations.length > 0) {
            addPage();

            setFont('bold', 16, [15, 23, 42]);
            doc.text('Relantern AI — Gap Analysis & Recommendations', margin, y); y += 3;
            doc.setFillColor(139, 92, 246); // purple
            doc.rect(margin, y, 60, 1.5, 'F'); y += 10;

            setFont('italic', 9, [100, 116, 139]);
            doc.text('The following recommendations are generated by Relantern AI based on the assessment responses and industry benchmarks.', margin, y);
            y += 8;

            for (const rec of audit.ai_recommendations as AuditAIRecommendation[]) {
                checkPage(30);

                // Priority badge
                const prioColor = rec.priority === 'critical' ? [239, 68, 68] : rec.priority === 'high' ? [249, 115, 22] : rec.priority === 'medium' ? [234, 179, 8] : [34, 197, 94];
                doc.setFillColor(prioColor[0], prioColor[1], prioColor[2]);
                doc.roundedRect(margin, y - 3, 16, 5, 1, 1, 'F');
                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text(rec.priority.toUpperCase(), margin + 1, y);

                setFont('bold', 9, [30, 41, 59]);
                doc.text(rec.gap, margin + 20, y);

                setFont('normal', 8, [100, 116, 139]);
                doc.text(`Clause: ${rec.clause}  |  Current: ${rec.current_score}/5  →  Target: ${rec.target_score}/5`, margin + 20, y + 4);
                y += 10;

                setFont('normal', 9, [30, 41, 59]);
                const recLines = doc.splitTextToSize(rec.recommendation, contentW - 25);
                doc.text(recLines, margin + 5, y);
                y += recLines.length * 4 + 2;

                if (rec.service_offering) {
                    setFont('bold', 8, [6, 182, 212]);
                    doc.text(`💡 Recommended Service: ${rec.service_offering}`, margin + 5, y);
                    y += 6;
                }

                drawLine(y, [230, 230, 235]); y += 5;
            }
        }

        // ═══════════════════════════════════════════════════════
        //  AI Summary (if present)
        // ═══════════════════════════════════════════════════════
        if (audit.ai_summary) {
            checkPage(40);
            y += 5;
            setFont('bold', 12, [139, 92, 246]);
            doc.text('Executive AI Summary', margin, y); y += 6;

            setFont('normal', 9, [30, 41, 59]);
            const summaryLines = doc.splitTextToSize(audit.ai_summary, contentW);
            doc.text(summaryLines, margin, y);
            y += summaryLines.length * 4 + 5;
        }

        // ═══════════════════════════════════════════════════════
        //  Footer on all pages
        // ═══════════════════════════════════════════════════════
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);

            // Footer line
            doc.setDrawColor(200, 200, 210);
            doc.setLineWidth(0.3);
            doc.line(margin, 285, W - margin, 285);

            // Footer text
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(148, 163, 184);
            doc.text('ERS Enterprise Reliability System — Powered by Relantern AI', margin, 290);
            doc.text(`CONFIDENTIAL  |  ${audit.audit_number}  |  Page ${i} of ${pageCount}`, W - margin, 290, { align: 'right' });
        }

        // Save
        const filename = `${audit.audit_number}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);
    }
}

// ── Utility: hex color to RGB array ──
function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [100, 116, 139];
}
