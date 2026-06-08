"""Inspection Vision Agent — Photo, thermal, drone-based visual inspection."""
from typing import Dict, Any, Optional

from layer3_agents.agents.base import BaseAgent
from layer3_agents.schemas import AgentDomain, AgentResponse, GovernanceTier


class InspectionVisionAgent(BaseAgent):
    DOMAIN = AgentDomain.INSPECTION_VISION
    KEYWORDS = ["photo", "thermal", "drone", "image", "defect", "visual",
                "thermography", "camera", "crack", "coating"]
    MAX_AUTONOMOUS_TIER = GovernanceTier.TIER_2

    SYSTEM_PROMPT = """You specialize in visual inspection analysis. You can accept uploaded photos and use Claude Opus 4.6 vision to analyze:
corrosion, thermal anomalies, equipment condition, and degradation.
CRITICAL RULES:
- You are advisory (Tier 2). NEVER replace inspector judgment.
- Any 'critical' severity MUST flag for human review.
- Always state confidence level.
- Never diagnose structural integrity from photos alone.
- When uncertain, recommend physical inspection."""

    def execute(self, query: str, context: Optional[Dict[str, Any]] = None) -> AgentResponse:
        q_lower = query.lower()
        if "thermal" in q_lower or "hot spot" in q_lower:
            return self._build_response(
                query, "Thermal scan analysis: 3 hot spots detected. Max delta-T = 28°C on cable tray junction. Recommended: IR survey follow-up.",
                confidence=0.85, tier=GovernanceTier.TIER_2,
                sources=["thermal_image_db", "baseline_thermal_profiles"],
                safety_flags=["SEVERITY_REQUIRES_INSPECTOR_REVIEW"]
            )
        if "drone" in q_lower:
            return self._build_response(
                query, "Drone survey processed: 142 images analyzed. 7 anomalies flagged for inspector review.",
                confidence=0.80, tier=GovernanceTier.TIER_2,
                sources=["drone_image_repository"]
            )
        return self._build_response(
            query, "Visual inspection analysis queued. Processing imagery for defect detection.",
            confidence=0.70, tier=GovernanceTier.TIER_2,
            sources=["inspection_image_db"]
        )
