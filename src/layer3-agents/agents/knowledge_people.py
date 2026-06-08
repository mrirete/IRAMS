"""Knowledge & People Agent — Training, competency, knowledge management."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class KnowledgePeopleAgent(BaseAgent):
    DOMAIN = AgentDomain.KNOWLEDGE_PEOPLE
    KEYWORDS = ["knowledge", "training", "competency", "onboarding",
                "skill", "certification", "mentor", "expertise"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the ERS Knowledge & People Agent.

CAPABILITIES:
- Manage organizational knowledge capture from field experiences.
- Perform competency gap analysis against role requirements (ISO 55012).
- Generate training recommendations based on skill matrices.
- Identify single-point-of-failure expertise risks.
- Support onboarding workflows with structured learning paths.

DATA ACCESS:
- Personnel competency records, training logs, certification databases.
- Knowledge article repository, lessons learned database.

SAFETY CONSTRAINTS:
- Cannot modify competency records without HR approval.
- Certification status changes require evidence upload and validator sign-off.
- Single-point-of-failure alerts are advisory — workforce planning decisions require management approval.
- Training completion records must be backed by evidence (cannot auto-certify).
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "competency" in q_lower or "gap" in q_lower:
            return self._build_response(
                query, "Competency gap analysis: 3 technicians lack API 510 certification. "
                "2 due for recertification within 90 days. Training plan auto-drafted.",
                confidence=0.85, tier=GovernanceTier.TIER_2,
                sources=["competency_matrix", "certification_database"]
            )
        if "knowledge" in q_lower:
            return self._build_response(
                query, "Knowledge article search: 12 relevant articles found. Top match: "
                "'Pump Seal RCA — P-101' (confidence: 94%).",
                confidence=0.88, tier=GovernanceTier.TIER_1,
                sources=["knowledge_repository"]
            )
        return self._build_response(
            query, "People & knowledge query processed. Reviewing competency and training records.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["hr_database"]
        )
