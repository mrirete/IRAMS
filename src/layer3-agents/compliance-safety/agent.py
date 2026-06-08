"""
Asset Integrity Auditor Agent — 9th Specialist Agent
═════════════════════════════════════════════════════
System prompt + orchestration for the integrity auditor agent.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from uuid import UUID


# ══════════════════════════════════════════════════════════════
#  SYSTEM PROMPT (per PROMPT A.3 Section B)
# ══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are the Asset Integrity Auditor Agent. You specialize in
mechanical integrity, inspection codes (API 510/570/653), fitness-
for-service (API 579), damage mechanisms (API 571), corrosion
management, integrity operating windows (API 584), and integrity
program auditing per OSHA PSM 1910.119(j).

You have access to all ERS Comply & Integrity data and can:
- Query equipment inspection status and overdue items
- Run Level 1 FFS screening assessments
- Identify applicable damage mechanisms from operating conditions
- Review IOW exceedance history and compliance
- Generate audit scopes and draft findings
- Calculate Regulatory Preparedness Scores
- Query thickness data and corrosion rate trends

CRITICAL RULES:
- NEVER determine equipment is fit for service autonomously
- FFS conclusions ALWAYS require qualified engineer sign-off (Tier 5)
- Damage mechanism suggestions are advisory (Tier 2) until confirmed
- Audit findings are DRAFT until auditor accepts them
- Inspection interval changes require Tier 3 approval
- When uncertain about damage mechanism applicability, recommend
  specialist corrosion engineer review

GOVERNANCE TIERS:
- Tier 1: Informational only (read-only queries)
- Tier 2: Advisory (AI suggestions — requires human confirmation)
- Tier 3: Approval required (inspection interval changes)
- Tier 5: Multi-party approval (FFS, safety-critical decisions)

You MUST append a governance tier to every response indicating what
level of human review is required before action is taken."""


@dataclass
class AgentConfig:
    """Configuration for the Asset Integrity Auditor Agent."""
    name: str = "asset_integrity_auditor"
    display_name: str = "Asset Integrity Auditor"
    description: str = (
        "Specialist agent for mechanical integrity, inspection codes, "
        "fitness-for-service, damage mechanisms, corrosion management, "
        "and integrity program auditing."
    )
    system_prompt: str = SYSTEM_PROMPT
    model: str = "claude-opus-4-6"
    max_tokens: int = 4096
    temperature: float = 0.1  # Low temperature for technical accuracy
    tools: List[str] = field(default_factory=lambda: [
        "query_equipment_status",
        "query_overdue_inspections",
        "calculate_inspection_interval",
        "calculate_corrosion_rates",
        "run_ffs_level_1",
        "run_ffs_level_2",
        "identify_damage_mechanisms",
        "check_iow_status",
        "query_iow_exceedances",
        "calculate_regulatory_preparedness",
        "create_audit",
        "compile_audit_package",
        "generate_audit_findings",
        "detect_cross_audit_patterns",
        "generate_audit_report",
        "query_thickness_data",
        "query_corrosion_trends",
    ])


class AssetIntegrityAuditorAgent:
    """
    Asset Integrity Auditor — 9th Specialist Agent.

    Orchestrates queries to ERS Comply engines and provides
    human-in-the-loop guidance on integrity management.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self._tools_registry: Dict[str, Any] = {}

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def system_prompt(self) -> str:
        return self.config.system_prompt

    def register_tool(self, name: str, handler: Any) -> None:
        """Register a callable tool handler."""
        self._tools_registry[name] = handler

    def get_available_tools(self) -> List[str]:
        """Return list of registered tool names."""
        return list(self._tools_registry.keys())

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Return tool definitions in the format expected by
        Claude tool_use API.
        """
        definitions = []
        for tool_name in self.config.tools:
            handler = self._tools_registry.get(tool_name)
            doc = ""
            if handler and hasattr(handler, "__doc__") and handler.__doc__:
                doc = handler.__doc__.strip()

            definitions.append({
                "name": tool_name,
                "description": doc or f"Tool: {tool_name}",
                "input_schema": self._get_tool_schema(tool_name),
            })
        return definitions

    def build_messages(
        self, user_query: str, context: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, str]]:
        """
        Build message list for AI call.
        Includes system prompt and user context.
        """
        messages = []

        # Add context if provided
        context_str = ""
        if context:
            context_str = f"\n\nCurrent Context:\n{self._format_context(context)}"

        messages.append({
            "role": "user",
            "content": f"{user_query}{context_str}",
        })

        return messages

    async def process_query(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        ai_client: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Process a user query through the agent.

        If no AI client, returns a structured response with
        available tool suggestions.
        """
        # Determine which tools are relevant
        relevant_tools = self._identify_relevant_tools(query)

        if ai_client is not None:
            # Production: call AI with tools
            messages = self.build_messages(query, context)
            try:
                response = ai_client.messages.create(
                    model=self.config.model,
                    max_tokens=self.config.max_tokens,
                    system=self.config.system_prompt,
                    messages=messages,
                    tools=self.get_tool_definitions(),
                )
                return {
                    "agent": self.config.name,
                    "response": response,
                    "tools_available": relevant_tools,
                    "governance_tier": self._determine_governance_tier(query),
                }
            except Exception as e:
                return {
                    "agent": self.config.name,
                    "error": str(e),
                    "tools_available": relevant_tools,
                    "governance_tier": self._determine_governance_tier(query),
                }
        else:
            # Offline mode: return tool suggestions
            return {
                "agent": self.config.name,
                "query": query,
                "suggested_tools": relevant_tools,
                "governance_tier": self._determine_governance_tier(query),
                "message": (
                    "AI client not available. Suggested tools for this query: "
                    + ", ".join(relevant_tools)
                ),
            }

    def _identify_relevant_tools(self, query: str) -> List[str]:
        """Identify which tools are relevant for a query."""
        query_lower = query.lower()
        relevant = []

        tool_keywords = {
            "query_equipment_status": ["equipment", "status", "registry"],
            "query_overdue_inspections": ["overdue", "inspection due", "expired"],
            "calculate_inspection_interval": ["inspection interval", "next inspection", "when inspect"],
            "calculate_corrosion_rates": ["corrosion rate", "thinning", "wall loss"],
            "run_ffs_level_1": ["ffs", "fitness for service", "fit for service", "api 579"],
            "run_ffs_level_2": ["ffs level 2", "ctp", "thickness grid"],
            "identify_damage_mechanisms": ["damage mechanism", "api 571", "what damage", "susceptible"],
            "check_iow_status": ["iow", "operating window", "api 584", "within limits"],
            "query_iow_exceedances": ["exceedance", "breach", "out of range"],
            "calculate_regulatory_preparedness": ["preparedness", "regulatory score", "compliance score"],
            "create_audit": ["create audit", "new audit", "start audit"],
            "compile_audit_package": ["compile", "data package", "audit package"],
            "generate_audit_findings": ["generate findings", "audit findings", "identify gaps"],
            "detect_cross_audit_patterns": ["pattern", "systemic", "recurring", "cross-audit"],
            "generate_audit_report": ["report", "audit report"],
            "query_thickness_data": ["thickness", "readings", "ut data", "cml"],
            "query_corrosion_trends": ["corrosion trend", "rate trend", "historical rate"],
        }

        for tool, keywords in tool_keywords.items():
            if any(kw in query_lower for kw in keywords):
                relevant.append(tool)

        # If no specific match, suggest common tools
        if not relevant:
            relevant = ["query_equipment_status", "calculate_regulatory_preparedness"]

        return relevant

    @staticmethod
    def _determine_governance_tier(query: str) -> int:
        """Determine the appropriate governance tier for a query."""
        query_lower = query.lower()

        # Tier 5: FFS, safety-critical
        if any(kw in query_lower for kw in [
            "fit for service", "ffs", "fitness", "safe to operate",
            "return to service", "shutdown"
        ]):
            return 5

        # Tier 3: Inspection interval changes
        if any(kw in query_lower for kw in [
            "change interval", "extend interval", "modify schedule"
        ]):
            return 3

        # Tier 2: AI suggestions
        if any(kw in query_lower for kw in [
            "damage mechanism", "suggest", "identify", "generate findings",
            "audit findings"
        ]):
            return 2

        # Tier 1: Read-only queries
        return 1

    @staticmethod
    def _format_context(context: Dict[str, Any]) -> str:
        """Format context dict for prompt inclusion."""
        lines = []
        for k, v in context.items():
            lines.append(f"- {k}: {v}")
        return "\n".join(lines)

    @staticmethod
    def _get_tool_schema(tool_name: str) -> Dict[str, Any]:
        """Return JSON schema for a tool's input parameters."""
        # Simplified schemas — production would use Pydantic model schemas
        schemas = {
            "query_equipment_status": {
                "type": "object",
                "properties": {
                    "equipment_id": {"type": "string", "description": "Equipment UUID"}
                },
            },
            "calculate_inspection_interval": {
                "type": "object",
                "properties": {
                    "equipment_id": {"type": "string"},
                    "governing_code": {"type": "string", "enum": ["api_510", "api_570", "api_653"]},
                },
                "required": ["equipment_id"],
            },
            "run_ffs_level_1": {
                "type": "object",
                "properties": {
                    "equipment_id": {"type": "string"},
                    "api_579_part": {"type": "string", "enum": ["part_4", "part_5", "part_6"]},
                },
                "required": ["equipment_id"],
            },
            "identify_damage_mechanisms": {
                "type": "object",
                "properties": {
                    "equipment_id": {"type": "string"},
                    "material_spec": {"type": "string"},
                    "process_fluid": {"type": "string"},
                    "operating_temperature": {"type": "number"},
                },
                "required": ["equipment_id"],
            },
        }
        return schemas.get(tool_name, {"type": "object", "properties": {}})
