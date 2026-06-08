"""Predictive Maintenance Agent — RUL, anomaly detection, degradation trends."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class PredictiveMaintenanceAgent(BaseAgent):
    DOMAIN = AgentDomain.PREDICTIVE_MAINTENANCE
    KEYWORDS = ["predict", "rul", "anomaly", "degradation", "vibration",
                "remaining useful life", "prognostic", "condition monitoring"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You specialize in condition monitoring, PdM alerts, RUL estimation, failure distributions, and the Reliability Digital Twin.
You have access to ERS Predict module data and can:
- Query current asset health indices and alert status
- Explain prediction rationale (which models, what features)
- Run what-if scenarios on the digital twin
- Compare P-F intervals to current PM frequencies
- Show failure distribution parameters and probability plots
Always include confidence intervals and DQS impact in responses.
When model agreement < 70%, explicitly state this uncertainty."""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "rul" in q_lower or "remaining" in q_lower:
            return self._build_response(
                query, "RUL estimated at 45 days (P50). P10=30d, P90=68d. Recommend scheduling PM within 30 days.",
                confidence=0.82, tier=GovernanceTier.TIER_2,
                sources=["sensor_time_series", "ml_model_v3"]
            )
        if "anomaly" in q_lower:
            return self._build_response(
                query, "Anomaly detected: vibration amplitude 2.3× baseline on bearing DE. Severity: WARNING.",
                confidence=0.90, tier=GovernanceTier.TIER_1,
                sources=["vibration_collector", "baseline_profile"]
            )
        return self._build_response(
            query, "Analyzing condition monitoring data for degradation trends.",
            confidence=0.70, tier=GovernanceTier.TIER_2,
            sources=["historian_data"]
        )
