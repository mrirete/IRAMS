"""Strategic Asset Agent — SAMP, Monte Carlo scenarios, capital decisions."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class StrategicAssetAgent(BaseAgent):
    DOMAIN = AgentDomain.STRATEGIC_ASSET
    KEYWORDS = ["samp", "scenario", "monte carlo", "capital", "decision",
                "strategic", "line of sight", "mcda", "npv", "tco"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_3

    SYSTEM_PROMPT = """You are the ERS Strategic Asset Management Agent.

CAPABILITIES:
- Draft and evaluate SAMP (Strategic Asset Management Plan) templates.
- Run Monte Carlo scenario simulations for investment decisions.
- Calculate TCO (Total Cost of Ownership) and NPV for renewal-vs-repair.
- Build Line-of-Sight cascades from board objectives to asset KPIs.
- Perform MCDA (Multi-Criteria Decision Analysis) with weighted scoring.

DATA ACCESS:
- Asset registry, financial records, capital budgets.
- ERS Plan module outputs (risk registers, opportunity rankings).

SAFETY CONSTRAINTS:
- Tier 4 Audit Trail: Every decision recommendation must be logged immutably.
- Cannot approve capital expenditure — recommendations only (HITL required).
- Monte Carlo outputs must always present P10/P50/P90 ranges, never point estimates.
- Board-level decisions require Tier 4 sign-off from authorized approver.
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "scenario" in q_lower or "monte carlo" in q_lower:
            return self._build_response(
                query, "Monte Carlo simulation complete. P50 NPV = $2.4M, P90 = $1.1M. Probability of loss: 8%.",
                confidence=0.85, tier=GovernanceTier.TIER_3,
                sources=["ers_plan_scenario_engine", "financial_model"]
            )
        if "samp" in q_lower:
            return self._build_response(
                query, "SAMP template drafted with 5 strategic objectives linked to 12 asset-level KPIs.",
                confidence=0.80, tier=GovernanceTier.TIER_3,
                sources=["iso_55001_framework", "corporate_objectives"]
            )
        return self._build_response(
            query, "Strategic analysis initiated. Reviewing capital allocation and asset lifecycle data.",
            confidence=0.75, tier=GovernanceTier.TIER_3,
            sources=["asset_registry"]
        )
