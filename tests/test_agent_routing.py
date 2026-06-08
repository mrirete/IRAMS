"""
Tests — Agent Router + Integrity Agent
═══════════════════════════════════════
Tests for keyword-based routing and agent configuration.
"""
import pytest
import sys
import os
from pathlib import Path

# Register layer3-agents for import
AGENTS_DIR = Path(__file__).resolve().parent.parent / "src" / "layer3-agents"
sys.path.insert(0, str(AGENTS_DIR))

from routing.config import AGENT_ROUTES, AgentRoute
from routing.router import AgentRouter


class TestAgentRouter:
    """Tests for keyword-based agent routing."""

    def setup_method(self):
        self.router = AgentRouter()

    # ── Integrity agent routing ────────────────────────────

    def test_routes_inspection_to_integrity(self):
        """'inspection' routes to asset_integrity_auditor."""
        result = self.router.route("What is the inspection status of V-201?")
        assert result == "asset_integrity_auditor"

    def test_routes_thickness_to_integrity(self):
        """'thickness' routes to integrity agent."""
        result = self.router.route("Show me thickness readings for this vessel")
        assert result == "asset_integrity_auditor"

    def test_routes_corrosion_rate_to_integrity(self):
        """'corrosion rate' routes to integrity agent."""
        result = self.router.route("What is the corrosion rate on CML-V201-1?")
        assert result == "asset_integrity_auditor"

    def test_routes_ffs_to_integrity(self):
        """'fitness for service' routes to integrity agent."""
        result = self.router.route("Run a fitness for service assessment")
        assert result == "asset_integrity_auditor"

    def test_routes_damage_mechanism_to_integrity(self):
        """'damage mechanism' routes to integrity agent."""
        result = self.router.route("What damage mechanisms apply to this vessel?")
        assert result == "asset_integrity_auditor"

    def test_routes_iow_to_integrity(self):
        """'iow' routes to integrity agent."""
        result = self.router.route("Check IOW status for temperature")
        assert result == "asset_integrity_auditor"

    def test_routes_api_codes_to_integrity(self):
        """API code references route to integrity agent."""
        for code in ["api 510", "api 570", "api 653", "api 571", "api 579", "api 584"]:
            result = self.router.route(f"What does {code} require for this vessel?")
            assert result == "asset_integrity_auditor", f"Failed for {code}"

    def test_routes_mechanical_integrity_to_integrity(self):
        """'mechanical integrity' routes to integrity agent."""
        result = self.router.route("Review the mechanical integrity program")
        assert result == "asset_integrity_auditor"

    def test_routes_audit_to_integrity(self):
        """'audit' routes to integrity agent."""
        result = self.router.route("Generate an integrity audit for Unit 3")
        assert result == "asset_integrity_auditor"

    def test_routes_regulatory_preparedness_to_integrity(self):
        """'regulatory preparedness' routes to integrity agent."""
        result = self.router.route("What is our regulatory preparedness score?")
        assert result == "asset_integrity_auditor"

    def test_routes_remaining_life_to_integrity(self):
        """'remaining life' routes to integrity agent."""
        result = self.router.route("What is the remaining life of this vessel?")
        assert result == "asset_integrity_auditor"

    # ── Other agent routing ────────────────────────────────

    def test_routes_work_order_to_work_intelligence(self):
        """'work order' routes to work_intelligence."""
        result = self.router.route("Create a new work order for pump maintenance")
        assert result == "work_intelligence"

    def test_routes_prediction_to_predictive(self):
        """'predict' routes to predictive_maintenance."""
        result = self.router.route("Predict remaining useful life of pump P-101")
        assert result == "predictive_maintenance"

    def test_routes_rcm_to_reliability(self):
        """'rcm' routes to reliability_analyst."""
        result = self.router.route("Run an RCM analysis for the compressor")
        assert result == "reliability_analyst"

    def test_routes_fmea_to_reliability(self):
        """'fmea' routes to reliability_analyst."""
        result = self.router.route("Create an FMEA worksheet for this pump")
        assert result == "reliability_analyst"

    def test_routes_emissions_to_sustainability(self):
        """'emissions' routes to sustainability."""
        result = self.router.route("What are our carbon emissions this quarter?")
        assert result == "sustainability"

    def test_routes_loto_to_compliance(self):
        """'loto' routes to compliance_safety."""
        result = self.router.route("Show LOTO procedure for this equipment")
        assert result == "compliance_safety"

    # ── Routing mechanics ──────────────────────────────────

    def test_fallback_on_no_match(self):
        """Unrecognized query → fallback agent."""
        result = self.router.route("Tell me a joke about maintenance")
        assert result == self.router.fallback_agent

    def test_route_with_scores(self):
        """route_with_scores returns scored list."""
        scores = self.router.route_with_scores("Check corrosion rate and inspection status")
        assert len(scores) > 0
        # First result should be integrity agent
        assert scores[0][0] == "asset_integrity_auditor"
        assert scores[0][1] > 0  # positive score

    def test_list_agents(self):
        """list_agents returns all 9 agents."""
        agents = self.router.list_agents()
        assert len(agents) == 9
        names = [a["name"] for a in agents]
        assert "asset_integrity_auditor" in names

    def test_get_agent_info(self):
        """get_agent_info returns route for a specific agent."""
        info = self.router.get_agent_info("asset_integrity_auditor")
        assert info is not None
        assert info.display_name == "Asset Integrity Auditor"
        assert len(info.keywords) > 10

    def test_multi_keyword_scores_higher(self):
        """Query with multiple integrity keywords scores higher."""
        scores_single = self.router.route_with_scores("Check inspection status")
        scores_multi = self.router.route_with_scores(
            "Run FFS assessment and check corrosion rate and damage mechanism"
        )
        # More keywords → higher score
        if scores_single and scores_multi:
            single_score = next(
                (s for n, s, c in scores_single if n == "asset_integrity_auditor"),
                0,
            )
            multi_score = next(
                (s for n, s, c in scores_multi if n == "asset_integrity_auditor"),
                0,
            )
            assert multi_score > single_score


class TestAgentConfig:
    """Tests for the integrity agent system prompt and config."""

    def test_agent_config_defaults(self):
        """Import and validate agent config."""
        sys.path.insert(0, str(AGENTS_DIR))
        # Need to register compliance-safety as importable
        import importlib.util
        agent_path = AGENTS_DIR / "compliance-safety" / "agent.py"
        spec = importlib.util.spec_from_file_location("cs_agent", str(agent_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        config = mod.AgentConfig()
        assert config.name == "asset_integrity_auditor"
        assert config.model == "claude-opus-4-6"
        assert len(config.tools) >= 10

    def test_system_prompt_contains_critical_rules(self):
        """System prompt contains all required safety clauses."""
        import importlib.util
        agent_path = AGENTS_DIR / "compliance-safety" / "agent.py"
        spec = importlib.util.spec_from_file_location("cs_agent2", str(agent_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        prompt = mod.SYSTEM_PROMPT
        assert "NEVER determine equipment is fit for service" in prompt
        assert "Tier 5" in prompt
        assert "Tier 2" in prompt
        assert "Tier 3" in prompt
        assert "API 510" in prompt
        assert "API 579" in prompt
        assert "API 571" in prompt
        assert "API 584" in prompt
        assert "OSHA PSM 1910.119(j)" in prompt

    def test_agent_identifies_relevant_tools(self):
        """Agent identifies correct tools for queries."""
        import importlib.util
        agent_path = AGENTS_DIR / "compliance-safety" / "agent.py"
        spec = importlib.util.spec_from_file_location("cs_agent3", str(agent_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        agent = mod.AssetIntegrityAuditorAgent()
        tools = agent._identify_relevant_tools("Run FFS assessment for V-201")
        assert "run_ffs_level_1" in tools

    def test_governance_tier_determination(self):
        """Governance tier correctly assigned."""
        import importlib.util
        agent_path = AGENTS_DIR / "compliance-safety" / "agent.py"
        spec = importlib.util.spec_from_file_location("cs_agent4", str(agent_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        agent = mod.AssetIntegrityAuditorAgent()
        assert agent._determine_governance_tier("Is this vessel fit for service?") == 5
        assert agent._determine_governance_tier("What damage mechanisms apply?") == 2
        assert agent._determine_governance_tier("Change interval to 8 years") == 3
        assert agent._determine_governance_tier("Show inspection history") == 1
