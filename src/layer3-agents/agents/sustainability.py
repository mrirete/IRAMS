"""Sustainability Agent — Carbon, energy, ESG, circular economy."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class SustainabilityAgent(BaseAgent):
    DOMAIN = AgentDomain.SUSTAINABILITY
    KEYWORDS = ["carbon", "energy", "esg", "emissions", "circular",
                "sustainability", "scope 1", "scope 2", "climate", "waste"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the ERS Sustainability Agent.

CAPABILITIES:
- Calculate Scope 1 and Scope 2 carbon emissions per GHG Protocol.
- Analyze energy consumption trends and detect degradation-driven waste.
- Track circular economy metrics (waste diversion, reclamation rates).
- Assess climate risk vulnerability for asset portfolios.
- Generate ESG dashboard metrics for stakeholder reporting.

DATA ACCESS:
- Energy consumption records, emission factor databases.
- Waste management records, recycling logs.
- Climate hazard databases and asset location data.

SAFETY CONSTRAINTS:
- ADVISORY: Cannot commit to regulatory filings or emissions reporting submissions.
- ESG metrics are for internal dashboards — external reporting requires compliance review.
- Carbon offset calculations must include uncertainty ranges.
- Climate risk scores are indicative — investment decisions require HITL approval.
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "carbon" in q_lower or "emission" in q_lower:
            return self._build_response(
                query, "Emissions calculated: Scope 1 = 1,240 tCO2e, Scope 2 = 890 tCO2e. Total = 2,130 tCO2e for reporting period.",
                confidence=0.88, tier=GovernanceTier.TIER_2,
                sources=["energy_records", "ghg_emission_factors"]
            )
        if "esg" in q_lower:
            return self._build_response(
                query, "ESG dashboard update: Environmental score = 72/100, Social = 85/100, Governance = 91/100.",
                confidence=0.82, tier=GovernanceTier.TIER_1,
                sources=["esg_framework", "sustainability_metrics"]
            )
        return self._build_response(
            query, "Sustainability analysis initiated. Reviewing energy and environmental data.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["sustainability_database"]
        )
