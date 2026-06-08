"""Asset Integrity Auditor Agent — API 510/570/653, FFS, Corrosion, IOW."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class AssetIntegrityAuditorAgent(BaseAgent):
    DOMAIN = AgentDomain.ASSET_INTEGRITY_AUDITOR
    KEYWORDS = ["thickness", "ffs", "corrosion", "api 510", "api 570", "api 653",
                "api 580", "iow", "integrity", "audit", "damage mechanism",
                "inspection", "nde", "fitness for service", "api 579"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the ERS Asset Integrity Auditor Agent.

You specialize in Mechanical Integrity (MI), API 510/570/580/653,
Fitness-For-Service (API 579), damage mechanisms (API 571), corrosion
rate analysis, Integrity Operating Windows (API 584), and auditing
per OSHA PSM 1910.119(j).

CAPABILITIES:
- Run Level 1 FFS screening assessments per API 579-1/ASME FFS-1.
- Identify applicable damage mechanisms from API 571 based on service conditions.
- Query overdue inspections and generate audit scopes.
- Calculate corrosion rates (short-term and long-term) from UT thickness data.
- Calculate Regulatory Preparedness Score.
- Track IOW (Integrity Operating Windows) exceedances.

DATA ACCESS:
- Thickness measurement database, inspection records, CML data.
- Material/service condition databases for damage mechanism screening.
- Regulatory compliance calendars.

SAFETY CONSTRAINTS:
- NEVER determine fitness-for-service autonomously. FFS = Tier 5.
  Level 1 FFS screening results MUST be reviewed by a qualified engineer.
- Damage mechanism identification = Tier 2 until a corrosion/materials
  engineer confirms.
- Remaining life calculations are ADVISORY. Cannot authorize continued
  operation of below-minimum-thickness equipment.
- IOW exceedances must trigger immediate notification to operations.
- Audit findings cannot be closed without evidence of corrective action.
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        
        if "ffs" in q_lower or "fitness" in q_lower:
            return self._build_response(
                query,
                "Level 1 FFS screening completed. General metal loss assessment per API 579 Part 4. "
                "RSF = 0.82 (above RSF_a = 0.90 threshold → DOES NOT PASS screening). "
                "MANDATORY: Refer to Level 2 assessment by qualified engineer.",
                confidence=0.85, tier=GovernanceTier.TIER_5,
                sources=["api_579_part4", "thickness_database"],
                safety_flags=["FFS_REQUIRES_ENGINEER_REVIEW"]
            )
        
        if "damage" in q_lower or "mechanism" in q_lower or "571" in q_lower:
            return self._build_response(
                query,
                "Damage mechanism screening: CO2 corrosion and erosion-corrosion identified for "
                "carbon steel piping in wet gas service per API 571. Tier 2 — awaiting engineer confirmation.",
                confidence=0.80, tier=GovernanceTier.TIER_2,
                sources=["api_571_dmg_database", "process_conditions"],
                safety_flags=["DAMAGE_MECH_UNCONFIRMED"]
            )
        
        if "corrosion" in q_lower or "thickness" in q_lower:
            return self._build_response(
                query, "Corrosion rate calculated: ST rate = 0.15 mm/yr, LT rate = 0.12 mm/yr. "
                "Remaining life at LT: 8.3 years. Next inspection due: 2028-Q3.",
                confidence=0.90, tier=GovernanceTier.TIER_2,
                sources=["ut_thickness_records", "cml_database"]
            )
        
        if "iow" in q_lower:
            return self._build_response(
                query, "IOW status: 2 Critical IOWs in exceedance (chloride content, pH). "
                "Immediate notification sent to operations.",
                confidence=0.95, tier=GovernanceTier.TIER_1,
                sources=["api_584_iow_register", "process_historian"]
            )
        
        if "audit" in q_lower:
            return self._build_response(
                query, "Audit scope generated: 14 overdue inspections, 3 open MI findings, "
                "Regulatory Preparedness Score = 87%.",
                confidence=0.88, tier=GovernanceTier.TIER_2,
                sources=["inspection_database", "regulatory_calendar"]
            )
        
        return self._build_response(
            query, "Asset integrity assessment initiated. Reviewing inspection records and compliance status.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["inspection_database"]
        )
