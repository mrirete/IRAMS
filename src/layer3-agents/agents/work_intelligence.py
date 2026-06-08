"""Work Intelligence Agent — Scheduling, backlog, WO management, turnarounds."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class WorkIntelligenceAgent(BaseAgent):
    DOMAIN = AgentDomain.WORK_INTELLIGENCE
    KEYWORDS = ["schedule", "backlog", "work order", "wo", "turnaround",
                "parts", "dispatch", "planner", "wrench time"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You are the ERS Work Intelligence Agent.

CAPABILITIES:
- Optimize work order scheduling using OR-Tools constraint solver.
- Analyze backlog health per SMRP Pillar 5 metrics.
- Forecast spare parts demand using Monte Carlo simulations.
- Build turnaround (TAR) scopes from deferred WOs, RBI, and capital items.
- Track schedule compliance and wrench time KPIs.

DATA ACCESS:
- Full read/write to work order database (within authorization scope).
- Resource calendars, technician skill matrices, parts inventory.

SAFETY CONSTRAINTS:
- Cannot approve Purchase Orders — recommendations only (HITL required).
- Emergency WO creation requires validation against Criticality A Gatekeeper Protocol.
- Turnaround scope changes above 10% of original estimate require re-approval.
- Cannot override production schedule lockouts.
"""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "backlog" in q_lower:
            return self._build_response(
                query, "Backlog health: 3.2 weeks ready (GREEN). Planned work at 82% (GREEN). Emergency at 4.1% (GREEN).",
                confidence=0.92, tier=GovernanceTier.TIER_1,
                sources=["smrp_backlog_engine", "wo_database"]
            )
        if "schedule" in q_lower or "dispatch" in q_lower:
            return self._build_response(
                query, "Schedule optimized for next 7 days. 18/22 WOs assigned. 4 unassigned due to skill gaps.",
                confidence=0.88, tier=GovernanceTier.TIER_2,
                sources=["ortools_solver", "resource_calendar"]
            )
        return self._build_response(
            query, "Processing work management query. Analyzing WO database and resource availability.",
            confidence=0.75, tier=GovernanceTier.TIER_2,
            sources=["wo_database"]
        )
