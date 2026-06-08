"""Compliance & Safety Agent — LOTO, PSM, Permit to Work, MOC."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class ComplianceSafetyAgent(BaseAgent):
    DOMAIN = AgentDomain.COMPLIANCE_SAFETY
    KEYWORDS = ["loto", "psm", "permit", "moc", "regulatory", "osha",
                "lockout", "tagout", "compliance", "safety", "ptw"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the ERS Compliance & Safety Agent.

CAPABILITIES:
- Manage LOTO (Lockout/Tagout) verification workflows.
- Track PSM (Process Safety Management) compliance per OSHA 1910.119.
- Process Permit to Work (PTW) requests and approval chains.
- Manage Management of Change (MOC) workflows.
- Calculate Regulatory Preparedness Scores.
- Generate compliance audit readiness reports.

DATA ACCESS:
- Full read access to safety registers, permit logs, and MOC records.
- Read access to regulatory requirement databases.

SAFETY CONSTRAINTS:
- NEVER bypass safety interlocks or recommend removing protective devices.
- Tier 5 for any PSM element changes — mandatory engineering review.
- LOTO verification cannot be completed virtually — physical confirmation required.
- PTW approvals must follow the full chain (Requestor → Issuer → Area Authority).
- MOC: No changes to Safety Instrumented Systems (SIS) without SIL verification.
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        
        # Safety exclusion: never help bypass safety systems
        if "bypass" in q_lower or "disable interlock" in q_lower or "override safety" in q_lower:
            return self._build_response(
                query, "BLOCKED: This request involves bypassing safety systems. This is prohibited.",
                confidence=1.0, tier=GovernanceTier.TIER_5,
                safety_flags=["SAFETY_BYPASS_ATTEMPTED"],
                sources=["osha_1910.119"]
            )
        
        if "loto" in q_lower or "lockout" in q_lower:
            return self._build_response(
                query, "LOTO procedure retrieved. 6 isolation points identified. Physical verification required.",
                confidence=0.90, tier=GovernanceTier.TIER_2,
                sources=["isolation_register", "ptw_database"]
            )
        if "psm" in q_lower:
            return self._build_response(
                query, "PSM compliance score: 94%. 2 overdue elements: PHA review, Emergency Planning drill.",
                confidence=0.88, tier=GovernanceTier.TIER_2,
                sources=["psm_14_element_tracker"]
            )
        return self._build_response(
            query, "Compliance analysis initiated. Reviewing regulatory requirements and audit trails.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["regulatory_database"]
        )
