"""
Competency Engine (ISO 55012:2024 aligned)
══════════════════════════════════════════
Analyzes technician skill matrices against requirements.
Tracks expiring certifications and assesses safety/stakeholder impact.
"""
from datetime import datetime, timedelta
from typing import List, Dict
from uuid import UUID

from ers_people.schemas import (
    TechnicianCompetencyProfile, RoleCompetencyRequirement,
    CompetencyGap, StakeholderImpactReport, SkillLevel
)

class CompetencyEngine:
    """ISO 55012:2024 clause 4.2 Competence mapping and tracking."""

    def perform_gap_analysis(
        self,
        profiles: List[TechnicianCompetencyProfile],
        roles: Dict[str, RoleCompetencyRequirement],
        tech_to_role_map: Dict[UUID, str]
    ) -> List[CompetencyGap]:
        """
        Identifies gaps between current technician skills and role requirements.
        Flags critical safety gaps if difference > 1 level (e.g., Novice vs Proficient).
        """
        gaps: List[CompetencyGap] = []

        for profile in profiles:
            role_id = tech_to_role_map.get(profile.technician_id)
            if not role_id:
                continue
                
            reqs = roles.get(role_id)
            if not reqs:
                continue

            for skill, required_level in reqs.required_skills.items():
                current_level = profile.skills.get(skill, SkillLevel.NOVICE)
                
                if current_level < required_level:
                    # Flag as critical safety gap if difference is 2+ levels (e.g. Novice trying to do Proficient work)
                    is_critical = (required_level.value - current_level.value) >= 2
                    
                    gaps.append(CompetencyGap(
                        technician_id=profile.technician_id,
                        skill_required=skill,
                        current_level=current_level,
                        required_level=required_level,
                        is_critical_safety_gap=is_critical
                    ))

        return gaps

    def generate_stakeholder_report(
        self,
        profiles: List[TechnicianCompetencyProfile],
        gaps: List[CompetencyGap]
    ) -> StakeholderImpactReport:
        """
        Generates board-ready competency compliance report reflecting
        ISO 55012 clause 4.2 requirements.
        """
        now = datetime.utcnow()
        horizon = now + timedelta(days=90)
        
        total = len(profiles)
        
        # Count techs with absolutely ZERO gaps
        techs_with_gaps = set(g.technician_id for g in gaps)
        fully_competent_count = total - len(techs_with_gaps)
        fully_competent_pct = (fully_competent_count / total * 100.0) if total > 0 else 0.0

        critical_gaps = sum(1 for g in gaps if g.is_critical_safety_gap)

        # Count 90-day expiring certs
        expiring = 0
        for p in profiles:
            for cert in p.certifications:
                if cert.expiry_date and now <= cert.expiry_date <= horizon:
                    expiring += 1

        # Gap clustering
        gap_cluster = {}
        for g in gaps:
            gap_cluster[g.skill_required] = gap_cluster.get(g.skill_required, 0) + 1

        if fully_competent_pct < 80.0 or critical_gaps > 0:
            rec = "IMMEDIATE ACTION: Training budget intervention required to address critical risk gaps."
        else:
            rec = "COMPLIANT: Training cadence meets ISO 55012 operational thresholds."

        return StakeholderImpactReport(
            total_technicians=total,
            fully_competent_percent=round(fully_competent_pct, 1),
            critical_safety_gaps_count=critical_gaps,
            expiring_certifications_next_90_days=expiring,
            gaps_by_skill=gap_cluster,
            recommendation=rec
        )
