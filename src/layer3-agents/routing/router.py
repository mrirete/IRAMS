"""
Agent Router — Keyword-Based Agent Selection
═════════════════════════════════════════════
Routes user queries to the appropriate specialist agent based
on keyword matching with weighted scoring.
"""
import re
from typing import List, Optional, Tuple, Dict

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '..')))

from routing.config import AGENT_ROUTES, AgentRoute


class AgentRouter:
    """
    Routes user queries to the most appropriate specialist agent.

    Scoring:
      1. Count keyword matches per agent
      2. Apply agent priority weight
      3. Select highest-scoring agent
      4. Return fallback if no match
    """

    def __init__(self, routes: Optional[List[AgentRoute]] = None):
        self._routes = routes or AGENT_ROUTES
        self._fallback_agent = "work_intelligence"  # default agent

    def route(self, query: str) -> str:
        """
        Route a query to the best-matching agent.

        Returns:
            Agent name string (e.g. "asset_integrity_auditor")
        """
        result = self.route_with_scores(query)
        return result[0][0] if result else self._fallback_agent

    def route_with_scores(
        self, query: str
    ) -> List[Tuple[str, float, int]]:
        """
        Route with full scoring details.

        Returns:
            List of (agent_name, score, match_count) sorted by score desc.
        """
        query_lower = query.lower()
        scores: List[Tuple[str, float, int]] = []

        for route in self._routes:
            match_count = 0
            for keyword in route.keywords:
                if keyword in query_lower:
                    match_count += 1
                    # Bonus for exact phrase matches
                    if f" {keyword} " in f" {query_lower} ":
                        match_count += 0.5

            if match_count > 0:
                # Score = matches × (1 + priority/10)
                score = match_count * (1 + route.priority / 10.0)
                scores.append((route.agent_name, score, int(match_count)))

        # Sort by score descending
        scores.sort(key=lambda x: -x[1])
        return scores

    def get_agent_info(self, agent_name: str) -> Optional[AgentRoute]:
        """Get route info for a specific agent."""
        for route in self._routes:
            if route.agent_name == agent_name:
                return route
        return None

    def list_agents(self) -> List[Dict[str, str]]:
        """List all registered agents."""
        return [
            {
                "name": r.agent_name,
                "display_name": r.display_name,
                "description": r.description,
            }
            for r in self._routes
        ]

    @property
    def fallback_agent(self) -> str:
        return self._fallback_agent

    @fallback_agent.setter
    def fallback_agent(self, agent_name: str) -> None:
        self._fallback_agent = agent_name
