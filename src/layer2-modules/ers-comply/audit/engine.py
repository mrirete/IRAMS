"""
Asset Integrity Audit Engine
═════════════════════════════
Data package compilation, AI finding generation (Opus 4.6),
cross-audit pattern detection, and report generation.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from uuid import UUID, uuid4

import sys
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.audit.schemas import (
    AuditScopeInput, AuditScopeType,
    EquipmentDataPackage, AuditDataPackage,
    AIFinding, AIFindingsOutput, FindingSeverity,
    AuditPattern, PatternAnalysisOutput, PatternSeverity,
    AuditReport, AuditReportSection,
)


# ── AI Prompt Template ────────────────────────────────────

AI_AUDIT_PROMPT = """You are a senior asset integrity auditor performing a compliance review.

Review this equipment integrity data. Identify gaps against {governing_codes} as applicable.

Categorize each finding as one of:
- observation: Minor note, no immediate action required
- recommendation: Suggested improvement for better compliance
- non_conformance: Violation of code requirement, corrective action needed
- critical: Immediate safety concern, requires urgent action

For each finding, include:
1. finding description (what was found)
2. standard reference (specific code section, e.g. "API 510 §6.4.2")
3. evidence (the specific data that triggered the finding)
4. recommended corrective action

Equipment Data:
{equipment_data}

Return ONLY a valid JSON array of findings, each with keys:
"equipment_id", "equipment_name", "severity", "description",
"standard_reference", "evidence", "recommended_action", "confidence"

CRITICAL: You are generating DRAFT findings only. A qualified auditor
MUST review and accept each finding. Do NOT make fitness-for-service
determinations."""


class AuditEngine:
    """
    Asset Integrity Audit Engine.

    - compile_data_package: Collect all relevant data per equipment
    - generate_ai_findings: Send to Opus 4.6 for finding generation (Tier 2)
    - detect_cross_audit_patterns: Analyze findings across 3+ audits
    - generate_report: Auto-populate audit report template
    """

    def __init__(self):
        # In-memory store for audits and findings (production → DB)
        self._audits: Dict[UUID, AuditDataPackage] = {}
        self._findings: Dict[UUID, List[AIFinding]] = {}  # audit_id → findings
        self._reports: Dict[UUID, AuditReport] = {}

    # ─── A) Data Package Compilation ──────────────────────

    def compile_data_package(
        self,
        scope: AuditScopeInput,
        equipment_data: List[Dict[str, Any]],
    ) -> AuditDataPackage:
        """
        Compile a data package for the audit scope.

        Args:
            scope: Definition of audit scope (unit / equipment_type / custom list)
            equipment_data: Raw equipment records with associated integrity data.
                Each dict should contain keys like:
                - id, name, asset_class, governing_code
                - inspection_dates, thickness_readings, corrosion_rates
                - damage_mechanisms, ffs_assessments, iow_exceedances
        """
        audit_id = uuid4()
        packages: List[EquipmentDataPackage] = []
        overdue_count = 0
        critical_preview = 0

        for equip in equipment_data:
            pkg = self._build_equipment_package(equip)
            packages.append(pkg)

            if pkg.inspection_overdue:
                overdue_count += 1
            if pkg.has_failed_ffs or pkg.critical_iow_breaches > 0:
                critical_preview += 1

        data_package = AuditDataPackage(
            audit_id=audit_id,
            scope=scope,
            equipment_packages=packages,
            total_equipment=len(packages),
            equipment_overdue=overdue_count,
            critical_findings_preview=critical_preview,
        )

        self._audits[audit_id] = data_package
        return data_package

    def _build_equipment_package(
        self, equip: Dict[str, Any]
    ) -> EquipmentDataPackage:
        """Build an EquipmentDataPackage from raw equipment data."""
        now = datetime.utcnow()

        # Determine overdue status
        next_due = equip.get("next_inspection_due")
        overdue = False
        if next_due:
            if isinstance(next_due, str):
                try:
                    next_due = datetime.fromisoformat(next_due)
                except ValueError:
                    next_due = None
            if next_due and next_due < now:
                overdue = True

        # Extract corrosion data
        corrosion_rates = equip.get("corrosion_rates", [])
        max_rate = 0.0
        accel = False
        for cr in corrosion_rates:
            rate = cr.get("max_observed_rate", 0.0)
            if rate > max_rate:
                max_rate = rate
            if cr.get("acceleration_flag", False):
                accel = True

        # FFS status
        ffs_list = equip.get("ffs_assessments", [])
        has_failed = any(
            f.get("status") in ("failed", "remediation_required")
            for f in ffs_list
        )

        # IOW breaches
        iow_list = equip.get("iow_exceedances", [])
        critical_breaches = sum(
            1 for e in iow_list if e.get("iow_type") == "critical"
        )

        return EquipmentDataPackage(
            equipment_id=equip.get("id", uuid4()),
            equipment_name=equip.get("name", "Unknown"),
            equipment_class=equip.get("asset_class", "Unknown"),
            governing_code=equip.get("governing_code"),
            last_internal_inspection=equip.get("last_internal_inspection"),
            last_external_inspection=equip.get("last_external"),
            next_inspection_due=next_due,
            inspection_overdue=overdue,
            cml_count=equip.get("cml_count", 0),
            latest_readings=equip.get("thickness_readings", []),
            corrosion_rates=corrosion_rates,
            max_corrosion_rate=max_rate,
            acceleration_detected=accel,
            active_damage_mechanisms=equip.get("damage_mechanisms", []),
            ffs_assessments=ffs_list,
            has_failed_ffs=has_failed,
            iow_exceedances=iow_list,
            critical_iow_breaches=critical_breaches,
            material_spec=equip.get("material_spec"),
            design_pressure=equip.get("design_pressure"),
            design_temperature=equip.get("design_temperature"),
            nominal_thickness=equip.get("nominal_thickness"),
            retirement_thickness=equip.get("retirement_thickness"),
        )

    # ─── B) AI Finding Generation ─────────────────────────

    def generate_ai_findings(
        self,
        audit_id: UUID,
        data_package: Optional[AuditDataPackage] = None,
        ai_client: Optional[Any] = None,
    ) -> AIFindingsOutput:
        """
        Generate AI findings using Opus 4.6.

        If no ai_client is provided, falls back to deterministic
        rule-based finding generation for testing/offline use.

        All findings are DRAFT (Tier 2) — auditor must review.
        """
        if data_package is None:
            data_package = self._audits.get(audit_id)
        if data_package is None:
            return AIFindingsOutput(
                audit_id=audit_id,
                findings=[],
                total_findings=0,
                by_severity={},
            )

        all_findings: List[AIFinding] = []

        if ai_client is not None:
            # Production path: call Opus 4.6
            all_findings = self._call_ai(ai_client, data_package)
        else:
            # Deterministic fallback for testing
            all_findings = self._generate_deterministic_findings(data_package)

        # Assign finding IDs
        for f in all_findings:
            if f.finding_id is None:
                f.finding_id = uuid4()

        # Count by severity
        severity_counts: Dict[str, int] = {}
        for f in all_findings:
            k = f.severity.value
            severity_counts[k] = severity_counts.get(k, 0) + 1

        self._findings[audit_id] = all_findings

        return AIFindingsOutput(
            audit_id=audit_id,
            findings=all_findings,
            total_findings=len(all_findings),
            by_severity=severity_counts,
        )

    def _call_ai(
        self, ai_client: Any, data_package: AuditDataPackage
    ) -> List[AIFinding]:
        """Call Opus 4.6 for AI finding generation."""
        # Collect governing codes from equipment
        codes = set()
        for pkg in data_package.equipment_packages:
            if pkg.governing_code:
                codes.add(pkg.governing_code.upper().replace("_", " "))

        governing_codes = ", ".join(codes) if codes else "API 510/570/653"

        # Serialize equipment data (limit to essential fields)
        equip_summaries = []
        for pkg in data_package.equipment_packages:
            summary = {
                "equipment_id": str(pkg.equipment_id),
                "name": pkg.equipment_name,
                "class": pkg.equipment_class,
                "governing_code": pkg.governing_code,
                "inspection_overdue": pkg.inspection_overdue,
                "next_due": str(pkg.next_inspection_due) if pkg.next_inspection_due else None,
                "max_corrosion_rate": pkg.max_corrosion_rate,
                "acceleration_detected": pkg.acceleration_detected,
                "has_failed_ffs": pkg.has_failed_ffs,
                "critical_iow_breaches": pkg.critical_iow_breaches,
                "active_damage_mechanisms": [
                    dm.get("name", "unknown") for dm in pkg.active_damage_mechanisms
                ],
                "latest_readings_count": len(pkg.latest_readings),
                "material": pkg.material_spec,
                "design_pressure": pkg.design_pressure,
                "design_temperature": pkg.design_temperature,
            }
            equip_summaries.append(summary)

        prompt = AI_AUDIT_PROMPT.format(
            governing_codes=governing_codes,
            equipment_data=json.dumps(equip_summaries, indent=2, default=str),
        )

        # Call AI client (expects an interface with .complete() or .messages.create())
        try:
            response = ai_client.messages.create(
                model="claude-opus-4-6",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            # Parse response
            content = response.content[0].text
            findings_data = json.loads(content)
            return self._parse_ai_findings(findings_data, data_package)
        except Exception as e:
            # Fallback to deterministic on AI failure
            return self._generate_deterministic_findings(data_package)

    def _parse_ai_findings(
        self, findings_data: List[Dict], data_package: AuditDataPackage
    ) -> List[AIFinding]:
        """Parse AI response into AIFinding objects."""
        findings = []
        for fd in findings_data:
            try:
                findings.append(AIFinding(
                    equipment_id=UUID(fd.get("equipment_id", str(uuid4()))),
                    equipment_name=fd.get("equipment_name", "Unknown"),
                    severity=FindingSeverity(fd.get("severity", "observation")),
                    description=fd.get("description", ""),
                    standard_reference=fd.get("standard_reference", ""),
                    evidence=fd.get("evidence", ""),
                    recommended_action=fd.get("recommended_action", ""),
                    ai_confidence=float(fd.get("confidence", 0.7)),
                ))
            except (ValueError, KeyError):
                continue
        return findings

    def _generate_deterministic_findings(
        self, data_package: AuditDataPackage
    ) -> List[AIFinding]:
        """
        Deterministic finding generation (no AI required).
        Checks common compliance gaps.
        """
        findings: List[AIFinding] = []

        for pkg in data_package.equipment_packages:
            code = (pkg.governing_code or "api_510").upper().replace("_", " ")

            # 1. Overdue inspections
            if pkg.inspection_overdue:
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.NON_CONFORMANCE,
                    description=(
                        f"Inspection overdue for {pkg.equipment_name}. "
                        f"Next inspection was due "
                        f"{pkg.next_inspection_due.strftime('%Y-%m-%d') if pkg.next_inspection_due else 'N/A'}."
                    ),
                    standard_reference=f"{code} §6.4 — Inspection interval requirements",
                    evidence=f"Next inspection due date: {pkg.next_inspection_due}",
                    recommended_action="Schedule inspection immediately. Evaluate risk of continued operation.",
                    ai_confidence=0.95,
                ))

            # 2. Accelerating corrosion
            if pkg.acceleration_detected:
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.RECOMMENDATION,
                    description=(
                        f"Accelerating corrosion detected on {pkg.equipment_name}. "
                        f"Short-term rate exceeds 2× long-term rate."
                    ),
                    standard_reference=f"{code} §6.5 — Corrosion rate evaluation",
                    evidence=f"Max corrosion rate: {pkg.max_corrosion_rate:.4f} in/yr, acceleration flagged",
                    recommended_action=(
                        "Increase monitoring frequency. Investigate for active damage mechanism. "
                        "Consider materials engineering review."
                    ),
                    ai_confidence=0.90,
                ))

            # 3. Failed FFS assessments
            if pkg.has_failed_ffs:
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.CRITICAL,
                    description=(
                        f"Equipment {pkg.equipment_name} has a failed FFS assessment. "
                        f"Equipment may not be fit for continued service."
                    ),
                    standard_reference="API 579-1 — Fitness-For-Service assessment failure",
                    evidence="FFS assessment status: FAILED",
                    recommended_action=(
                        "Immediately engage qualified API 579 practitioner. "
                        "Evaluate repair, re-rate, or retirement options. "
                        "Do NOT return to service without engineering approval (Tier 5)."
                    ),
                    ai_confidence=0.95,
                ))

            # 4. Critical IOW breaches
            if pkg.critical_iow_breaches > 0:
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.NON_CONFORMANCE,
                    description=(
                        f"{pkg.critical_iow_breaches} critical IOW breach(es) "
                        f"recorded for {pkg.equipment_name}."
                    ),
                    standard_reference="API 584 — IOW management requirements",
                    evidence=f"Critical IOW breaches: {pkg.critical_iow_breaches}",
                    recommended_action=(
                        "Review IOW exceedance history. Verify corrective actions taken. "
                        "Assess impact on damage mechanism progression."
                    ),
                    ai_confidence=0.88,
                ))

            # 5. No thickness readings
            if pkg.cml_count == 0 and len(pkg.latest_readings) == 0:
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.RECOMMENDATION,
                    description=(
                        f"No thickness data available for {pkg.equipment_name}. "
                        f"Cannot determine corrosion rate or remaining life."
                    ),
                    standard_reference=f"{code} §6.3 — Thickness measurement requirements",
                    evidence="CML count: 0, thickness readings: 0",
                    recommended_action=(
                        "Establish CML locations per code requirements. "
                        "Perform baseline thickness survey."
                    ),
                    ai_confidence=0.92,
                ))

            # 6. High corrosion rate
            if pkg.max_corrosion_rate > 0.020:  # >20 mpy
                findings.append(AIFinding(
                    equipment_id=pkg.equipment_id,
                    equipment_name=pkg.equipment_name,
                    severity=FindingSeverity.RECOMMENDATION,
                    description=(
                        f"High corrosion rate ({pkg.max_corrosion_rate:.4f} in/yr) "
                        f"on {pkg.equipment_name}."
                    ),
                    standard_reference=f"{code} §6.5 — Corrosion rate evaluation",
                    evidence=f"Max observed rate: {pkg.max_corrosion_rate:.4f} in/yr",
                    recommended_action=(
                        "Review damage mechanisms. Consider increased monitoring frequency, "
                        "material upgrade, or process changes to reduce corrosion."
                    ),
                    ai_confidence=0.85,
                ))

        return findings

    # ─── C) Cross-Audit Pattern Detection ─────────────────

    def detect_cross_audit_patterns(
        self,
        audit_ids: List[UUID],
    ) -> PatternAnalysisOutput:
        """
        Analyze findings across 3+ audits for systemic patterns.
        A pattern is systemic when >30% of audits have the same finding.
        """
        if len(audit_ids) < 3:
            return PatternAnalysisOutput(
                audits_analyzed=len(audit_ids),
                patterns=[],
                recommendations=[
                    "At least 3 audits required for pattern detection. "
                    f"Currently have {len(audit_ids)}."
                ],
            )

        # Collect all findings across audits
        all_findings: List[Tuple[UUID, AIFinding]] = []
        for aid in audit_ids:
            findings = self._findings.get(aid, [])
            for f in findings:
                all_findings.append((aid, f))

        if not all_findings:
            return PatternAnalysisOutput(
                audits_analyzed=len(audit_ids),
                patterns=[],
                recommendations=["No findings found across the specified audits."],
            )

        # Group findings by description pattern (normalized)
        pattern_groups: Dict[str, List[Tuple[UUID, AIFinding]]] = defaultdict(list)
        for audit_id, finding in all_findings:
            # Normalize: use severity + first 50 chars of description
            key = f"{finding.severity.value}::{finding.description[:50].lower().strip()}"
            pattern_groups[key].append((audit_id, finding))

        total_audits = len(audit_ids)
        patterns: List[AuditPattern] = []

        for key, group in pattern_groups.items():
            # Count distinct audits this pattern appears in
            distinct_audits = len(set(aid for aid, _ in group))
            recurrence_rate = distinct_audits / total_audits

            if recurrence_rate >= 0.1:  # At least 10% to be notable
                affected_equip = list(set(f.equipment_id for _, f in group))
                sample_finding = group[0][1]

                if recurrence_rate > 0.3:
                    severity = PatternSeverity.SYSTEMIC
                elif recurrence_rate > 0.1:
                    severity = PatternSeverity.RECURRING
                else:
                    severity = PatternSeverity.ISOLATED

                patterns.append(AuditPattern(
                    pattern_description=sample_finding.description[:200],
                    finding_severity=sample_finding.severity,
                    recurrence_rate=round(recurrence_rate, 2),
                    pattern_severity=severity,
                    affected_equipment_count=len(affected_equip),
                    affected_equipment_ids=affected_equip,
                    first_seen_audit_id=group[0][0],
                    occurrences=len(group),
                    total_audits_checked=total_audits,
                    recommended_action=self._pattern_recommendation(
                        severity, sample_finding
                    ),
                ))

        # Sort by recurrence rate (highest first)
        patterns.sort(key=lambda p: -p.recurrence_rate)

        systemic = sum(1 for p in patterns if p.pattern_severity == PatternSeverity.SYSTEMIC)
        recurring = sum(1 for p in patterns if p.pattern_severity == PatternSeverity.RECURRING)

        recommendations = []
        if systemic > 0:
            recommendations.append(
                f"{systemic} systemic pattern(s) detected (>30% recurrence). "
                f"Root cause analysis recommended."
            )
        if recurring > 0:
            recommendations.append(
                f"{recurring} recurring pattern(s) detected (10-30% recurrence). "
                f"Monitor for escalation."
            )

        return PatternAnalysisOutput(
            audits_analyzed=total_audits,
            patterns=patterns,
            systemic_count=systemic,
            recurring_count=recurring,
            recommendations=recommendations,
        )

    @staticmethod
    def _pattern_recommendation(
        severity: PatternSeverity, finding: AIFinding
    ) -> str:
        """Generate recommendation for a detected pattern."""
        if severity == PatternSeverity.SYSTEMIC:
            return (
                f"SYSTEMIC ISSUE: '{finding.description[:80]}...' "
                f"appears in >30% of audits. Initiate defect elimination program. "
                f"Perform root cause analysis across affected equipment."
            )
        elif severity == PatternSeverity.RECURRING:
            return (
                f"RECURRING: '{finding.description[:80]}...' "
                f"appears in 10-30% of audits. Monitor trend and validate "
                f"corrective actions are effective."
            )
        return "Continue normal monitoring."

    # ─── D) Report Generation ─────────────────────────────

    def generate_report(
        self,
        audit_id: UUID,
        data_package: Optional[AuditDataPackage] = None,
        findings: Optional[List[AIFinding]] = None,
        pattern_analysis: Optional[PatternAnalysisOutput] = None,
        previous_audit_findings_count: Optional[int] = None,
    ) -> AuditReport:
        """
        Generate a complete audit report.
        Auto-populates template with findings, stats, corrective
        action plan, and trending vs previous audits.
        """
        if data_package is None:
            data_package = self._audits.get(audit_id)
        if findings is None:
            findings = self._findings.get(audit_id, [])

        # Accept only auditor-accepted findings (or all if not yet reviewed)
        accepted = [
            f for f in findings
            if f.auditor_accepted is True or f.auditor_accepted is None
        ]

        # Count by severity
        severity_counts: Dict[str, int] = {}
        for f in accepted:
            k = f.severity.value
            severity_counts[k] = severity_counts.get(k, 0) + 1

        # Build sections
        sections: List[AuditReportSection] = []

        # Section 1: Scope
        scope_desc = "Not specified"
        if data_package:
            scope_desc = (
                f"Scope type: {data_package.scope.scope_type.value}, "
                f"Equipment count: {data_package.total_equipment}, "
                f"Overdue: {data_package.equipment_overdue}"
            )
            if data_package.scope.scope_description:
                scope_desc = data_package.scope.scope_description + f" ({scope_desc})"

        sections.append(AuditReportSection(
            title="Audit Scope",
            content=scope_desc,
        ))

        # Section 2: Equipment Status Summary
        if data_package:
            equip_summary = self._build_equipment_summary(data_package)
            sections.append(AuditReportSection(
                title="Equipment Status Summary",
                content=equip_summary,
            ))

        # Section 3: Findings Summary
        sections.append(AuditReportSection(
            title="Findings Summary",
            content=self._build_findings_summary(accepted, severity_counts),
            data=severity_counts,
        ))

        # Section 4: Corrective Action Plan
        corrective_actions = self._build_corrective_actions(accepted)
        sections.append(AuditReportSection(
            title="Corrective Action Plan",
            content=f"{len(corrective_actions)} corrective action(s) identified.",
            data={"actions": corrective_actions},
        ))

        # Trending
        trend = None
        if previous_audit_findings_count is not None:
            current = len(accepted)
            delta = current - previous_audit_findings_count
            trend = {
                "previous_findings": previous_audit_findings_count,
                "current_findings": current,
                "delta": delta,
                "trend": "improving" if delta < 0 else ("worsening" if delta > 0 else "stable"),
            }
            sections.append(AuditReportSection(
                title="Trend Analysis",
                content=(
                    f"Previous audit: {previous_audit_findings_count} findings. "
                    f"Current: {current}. Trend: {trend['trend']}."
                ),
                data=trend,
            ))

        # Executive summary
        exec_summary = self._build_executive_summary(
            data_package, accepted, severity_counts, trend
        )

        # Systemic patterns
        systemic_patterns = []
        if pattern_analysis:
            systemic_patterns = [
                p for p in pattern_analysis.patterns
                if p.pattern_severity == PatternSeverity.SYSTEMIC
            ]

        report = AuditReport(
            audit_id=audit_id,
            title=f"Asset Integrity Audit Report — {datetime.utcnow().strftime('%Y-%m-%d')}",
            audit_type=data_package.scope.audit_type if data_package else "routine",
            scope_description=scope_desc,
            auditor_name=data_package.scope.auditor_name if data_package else None,
            total_equipment_audited=data_package.total_equipment if data_package else 0,
            total_findings=len(accepted),
            findings_by_severity=severity_counts,
            executive_summary=exec_summary,
            sections=sections,
            findings=accepted,
            corrective_actions=corrective_actions,
            trend_vs_previous=trend,
            systemic_patterns=systemic_patterns,
        )

        self._reports[audit_id] = report
        return report

    # ─── Helper Methods ───────────────────────────────────

    @staticmethod
    def _build_equipment_summary(data_package: AuditDataPackage) -> str:
        """Build equipment status summary text."""
        total = data_package.total_equipment
        overdue = data_package.equipment_overdue
        critical = data_package.critical_findings_preview
        return (
            f"Total equipment audited: {total}\n"
            f"Inspections overdue: {overdue} ({(overdue/total*100) if total > 0 else 0:.0f}%)\n"
            f"Equipment with critical issues: {critical}"
        )

    @staticmethod
    def _build_findings_summary(
        findings: List[AIFinding], severity_counts: Dict[str, int]
    ) -> str:
        """Build findings summary text."""
        lines = [f"Total findings: {len(findings)}"]
        for sev in ["critical", "non_conformance", "recommendation", "observation"]:
            count = severity_counts.get(sev, 0)
            if count > 0:
                lines.append(f"  {sev.replace('_', ' ').title()}: {count}")
        return "\n".join(lines)

    @staticmethod
    def _build_corrective_actions(findings: List[AIFinding]) -> List[Dict[str, Any]]:
        """Extract corrective actions from findings."""
        actions = []
        priority_map = {
            FindingSeverity.CRITICAL: "immediate",
            FindingSeverity.NON_CONFORMANCE: "high",
            FindingSeverity.RECOMMENDATION: "medium",
            FindingSeverity.OBSERVATION: "low",
        }
        for f in findings:
            if f.severity in (FindingSeverity.CRITICAL, FindingSeverity.NON_CONFORMANCE,
                              FindingSeverity.RECOMMENDATION):
                actions.append({
                    "finding_description": f.description[:100],
                    "equipment_id": str(f.equipment_id),
                    "equipment_name": f.equipment_name,
                    "priority": priority_map.get(f.severity, "medium"),
                    "action": f.recommended_action,
                    "standard_reference": f.standard_reference,
                    "status": "open",
                })
        return actions

    @staticmethod
    def _build_executive_summary(
        data_package: Optional[AuditDataPackage],
        findings: List[AIFinding],
        severity_counts: Dict[str, int],
        trend: Optional[Dict],
    ) -> str:
        """Build executive summary."""
        total = data_package.total_equipment if data_package else 0
        criticals = severity_counts.get("critical", 0)
        ncs = severity_counts.get("non_conformance", 0)

        summary = (
            f"This audit reviewed {total} equipment items. "
            f"A total of {len(findings)} finding(s) were identified: "
            f"{criticals} critical, {ncs} non-conformance(s), "
            f"{severity_counts.get('recommendation', 0)} recommendation(s), "
            f"{severity_counts.get('observation', 0)} observation(s)."
        )

        if criticals > 0:
            summary += (
                f"\n\nCRITICAL: {criticals} critical finding(s) require "
                f"immediate attention and Tier 5 engineering review."
            )

        if trend:
            summary += f"\n\nTrend vs previous audit: {trend['trend']}."

        return summary
