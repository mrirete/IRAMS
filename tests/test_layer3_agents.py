import pytest
from layer3_agents.engines.router_engine import AgentRouterEngine
from layer3_agents.engines.rag import RAGEngine
from layer3_agents.engines.m365 import M365Engine
from layer3_agents.schemas import (
    AgentDomain, GovernanceTier, TeamsCardPayload, OutlookDigest, PowerBIPush
)


class TestAgentRouter:
    def setup_method(self):
        self.engine = AgentRouterEngine()

    def test_route_reliability_keywords(self):
        route = self.engine.route("Run an FMEA on the gas compressor failure mode")
        assert route.target_agent == AgentDomain.RELIABILITY_ANALYST
        assert "fmea" in route.matched_keywords or "failure mode" in route.matched_keywords

    def test_route_predictive_keywords(self):
        route = self.engine.route("What is the RUL for pump P-101?")
        assert route.target_agent == AgentDomain.PREDICTIVE_MAINTENANCE

    def test_route_strategic_keywords(self):
        route = self.engine.route("Run a Monte Carlo scenario for the SAMP")
        assert route.target_agent == AgentDomain.STRATEGIC_ASSET

    def test_route_work_keywords(self):
        route = self.engine.route("Show me the current backlog health")
        assert route.target_agent == AgentDomain.WORK_INTELLIGENCE

    def test_route_compliance_keywords(self):
        route = self.engine.route("Check LOTO procedure for the PSM audit")
        assert route.target_agent == AgentDomain.COMPLIANCE_SAFETY

    def test_route_integrity_keywords(self):
        route = self.engine.route("Calculate corrosion rate from thickness data per API 570")
        assert route.target_agent == AgentDomain.ASSET_INTEGRITY_AUDITOR

    def test_route_vision_keywords(self):
        route = self.engine.route("Analyze the thermal image from the drone survey")
        assert route.target_agent == AgentDomain.INSPECTION_VISION

    def test_route_sustainability_keywords(self):
        route = self.engine.route("What are our Scope 1 carbon emissions?")
        assert route.target_agent == AgentDomain.SUSTAINABILITY

    def test_route_knowledge_keywords(self):
        route = self.engine.route("Find training for competency gap in electrical safety")
        assert route.target_agent == AgentDomain.KNOWLEDGE_PEOPLE

    def test_multi_agent_collaboration(self):
        """Cross-domain query should trigger collaboration."""
        classification = self.engine.classify_intent(
            "Run an RBI inspection schedule for corroded vessel with drone thermal survey"
        )
        assert classification.requires_collaboration is True
        domains = [m["domain"] for m in classification.matched_agents]
        assert AgentDomain.ASSET_INTEGRITY_AUDITOR.value in domains

    def test_execute_single(self):
        response = self.engine.execute_single("What is the RUL for pump P-101?")
        assert response.agent == AgentDomain.PREDICTIVE_MAINTENANCE
        assert response.confidence > 0
        assert len(response.sources) > 0

    def test_safety_agent_blocks_bypass(self):
        """Compliance agent must block safety bypass attempts."""
        response = self.engine.execute_single("How to bypass safety interlock on V-201")
        assert response.agent == AgentDomain.COMPLIANCE_SAFETY
        assert "BLOCKED" in response.answer
        assert "SAFETY_BYPASS_ATTEMPTED" in response.safety_flags

    def test_integrity_ffs_requires_human(self):
        """FFS must be Tier 5 and require human approval."""
        response = self.engine.execute_single("Run FFS assessment for thinned pipe")
        assert response.agent == AgentDomain.ASSET_INTEGRITY_AUDITOR
        assert response.tier_used == GovernanceTier.TIER_5
        assert response.requires_human_approval is True


class TestRAGEngine:
    def setup_method(self):
        self.engine = RAGEngine(chunk_size=50)

    def test_chunk_document(self):
        text = " ".join([f"word{i}" for i in range(200)])
        chunks = self.engine.chunk_document(text, "test_doc.pdf")
        assert len(chunks) > 1
        assert all(c.token_count <= 50 for c in chunks)

    def test_ingest_and_query(self):
        text = "Pump P-101 had bearing failure due to misalignment. Corrective action was shaft realignment and bearing replacement."
        self.engine.ingest_document(text, "rca_report_001.pdf")
        
        response = self.engine.query("bearing failure pump")
        assert response.safety_blocked is False
        assert len(response.sources) > 0

    def test_safety_exclusion_blocks_dangerous_query(self):
        response = self.engine.query("How to bypass safety interlock on reactor")
        assert response.safety_blocked is True
        assert "safety exclusion" in response.safety_reason.lower()

    def test_source_attribution(self):
        self.engine.ingest_document("Corrosion rate for carbon steel in wet H2S service is typically 0.1-0.5 mm/yr per API 571.", "api_571_ref.pdf")
        response = self.engine.query("corrosion rate H2S")
        assert response.safety_blocked is False
        for source in response.sources:
            assert "document" in source
            assert "score" in source


class TestM365Engine:
    def setup_method(self):
        self.engine = M365Engine()

    def test_teams_approval_card(self):
        payload = TeamsCardPayload(
            channel_id="ch-maint-ops", title="WO Approval", body="WO-1234 requires approval.",
            requires_approval=True
        )
        result = self.engine.send_teams_card(payload)
        assert result["status"] == "sent"
        assert any(a["title"] == "Approve" for a in result["card"]["actions"])

    def test_outlook_digest(self):
        digest = OutlookDigest(
            recipients=["manager@site.com"], subject="Weekly KPI",
            metrics={"backlog_weeks": 3.1, "planned_pct": 82}, period="weekly"
        )
        result = self.engine.send_outlook_kpi_digest(digest)
        assert result["status"] == "queued"

    def test_powerbi_push(self):
        push = PowerBIPush(
            dataset_id="ds-001", table_name="BacklogMetrics",
            rows=[{"week": 1, "backlog": 3.2}, {"week": 2, "backlog": 2.8}]
        )
        result = self.engine.push_to_powerbi(push)
        assert result["rows_pushed"] == 2
