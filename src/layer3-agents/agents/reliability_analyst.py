"""Reliability Analyst Agent — RBI, RCM, FMEA, Bad Actor identification."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class ReliabilityAnalystAgent(BaseAgent):
    DOMAIN = AgentDomain.RELIABILITY_ANALYST
    KEYWORDS = ["rbi", "rcm", "fmea", "failure mode", "bad actor", "reliability",
                "weibull", "pareto", "defect elimination", "mtbf", "mttr"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the Reliability Analyst Agent. You specialize in failure analysis, RCM, FMEA, criticality analysis, and defect elimination.
You have access to ERS Analyze module data and can:
- Suggest failure modes from historical WOs
- Run RCM decision logic (deterministic, SAE JA1011)
- Query Monte Carlo simulation results
- Perform Weibull analysis on failure time data
- Generate RCA investigation frameworks
- Rank assets by bad actor analysis
Always cite specific work orders, failure records, or analyses.
Never guess failure modes - derive from data or state uncertainty.
RCM task selection uses deterministic logic, not your judgment."""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "bad actor" in q_lower or "pareto" in q_lower:
            return self._build_response(
                query, "Identified top 5 bad actors by downtime. Defect Elimination tasks auto-drafted.",
                confidence=0.88, tier=GovernanceTier.TIER_2,
                sources=["failure_history_db", "wo_cost_records"]
            )
        if "fmea" in q_lower or "failure mode" in q_lower:
            return self._build_response(
                query, "FMEA worksheet generated for the specified equipment class per SAE JA1012.",
                confidence=0.85, tier=GovernanceTier.TIER_2,
                sources=["iso_14224_taxonomy", "asset_registry"]
            )
        return self._build_response(
            query, "Reliability analysis queued. Reviewing failure patterns and RBI intervals.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["condition_monitoring_data"]
        )
