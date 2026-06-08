"""
Base Agent — Abstract Base Class
════════════════════════════════
All 9 specialist agents extend this class.
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class BaseAgent(ABC):
    """Abstract base class for all ERS specialist agents."""

    DOMAIN: AgentDomain
    KEYWORDS: List[str] = []
    SYSTEM_PROMPT: str = ""
    MAX_AUTONOMOUS_TIER: GovernanceTier = GovernanceTier.TIER_2

    @abstractmethod
    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        """Process a routed query and return a structured response."""
        ...

    def _build_response(
        self,
        query: str,
        answer: str,
        confidence: float,
        tier: GovernanceTier,
        sources: Optional[List[str]] = None,
        safety_flags: Optional[List[str]] = None
    ) -> AgentResponse:
        requires_human = tier.value > self.MAX_AUTONOMOUS_TIER.value
        return AgentResponse(
            agent=self.DOMAIN,
            query=query,
            answer=answer,
            confidence=confidence,
            tier_used=tier,
            sources=sources or [],
            requires_human_approval=requires_human,
            safety_flags=safety_flags or []
        )
