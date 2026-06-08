"""
Tests for ERS Analyze — FMEA, RCA, and Criticality
════════════════════════════════════════════════════
Tests for FMEA worksheets, multi-method RCA, and criticality matrix.
"""

import pytest
from uuid import uuid4

from ers_analyze.schemas import (
    CriticalityInput,
    FMEAItemInput,
    FMEAWorksheetCreate,
    FishboneCategory,
    RCAInvestigationCreate,
    RCAMethod,
    RCANodeInput,
    RCANodeType,
)
from ers_analyze.fmea.worksheet import FMEAWorksheetEngine
from ers_analyze.rca.engine import RCAEngine
from ers_analyze.rca.ai_patterns import RCAPatternDetector
from ers_analyze.criticality.matrix import CriticalityMatrix


# ─── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def fmea():
    return FMEAWorksheetEngine()


@pytest.fixture
def rca():
    return RCAEngine()


@pytest.fixture
def pattern_detector():
    return RCAPatternDetector()


@pytest.fixture
def criticality():
    return CriticalityMatrix()


# ═══════════════════════════════════════════════════════════════
#  FMEA TESTS
# ═══════════════════════════════════════════════════════════════

class TestFMEAWorksheet:

    def test_create_worksheet(self, fmea):
        """Should create a worksheet with default status."""
        ws = fmea.create_worksheet(FMEAWorksheetCreate(
            asset_id=uuid4(),
            title="Centrifugal Pump P-101A FMEA",
        ))
        assert ws.title == "Centrifugal Pump P-101A FMEA"
        assert ws.status == "draft"
        assert ws.items == []

    def test_add_item_calculates_rpn(self, fmea):
        """RPN should be computed as S × O × D."""
        ws = fmea.create_worksheet(FMEAWorksheetCreate(
            asset_id=uuid4(), title="Test FMEA",
        ))
        item = fmea.add_item(ws.id, FMEAItemInput(
            component="Bearing DE",
            failure_mode="Seizure",
            severity=8,
            occurrence=3,
            detection=5,
        ))
        assert item.rpn == 8 * 3 * 5  # 120

    def test_rpn_clamped_1_to_10(self, fmea):
        """RPN calculation should clamp inputs to 1-10."""
        rpn = fmea.calculate_rpn(0, 11, 5)
        assert rpn == 1 * 10 * 5  # clamped

    def test_risk_categorization(self, fmea):
        """Risk categories: high ≥ 200, medium ≥ 100, low < 100."""
        assert fmea.categorize_risk(250) == "high"
        assert fmea.categorize_risk(200) == "high"
        assert fmea.categorize_risk(150) == "medium"
        assert fmea.categorize_risk(100) == "medium"
        assert fmea.categorize_risk(50) == "low"

    def test_summary_statistics(self, fmea):
        """Worksheet should track max, avg RPN and high-risk count."""
        ws = fmea.create_worksheet(FMEAWorksheetCreate(
            asset_id=uuid4(), title="Test",
        ))
        fmea.add_item(ws.id, FMEAItemInput(
            component="A", failure_mode="FM1",
            severity=10, occurrence=8, detection=5,  # RPN=400
        ))
        fmea.add_item(ws.id, FMEAItemInput(
            component="B", failure_mode="FM2",
            severity=3, occurrence=2, detection=2,  # RPN=12
        ))

        ws = fmea.get_worksheet(ws.id)
        assert ws.max_rpn == 400
        assert ws.high_risk_count == 1
        assert ws.avg_rpn == (400 + 12) / 2

    def test_suggest_failure_modes_bearings(self, fmea):
        """Should suggest bearing-specific failure modes."""
        suggestions = fmea.suggest_failure_modes_for_component("bearing", "pump")
        assert len(suggestions) > 0
        modes = [s.failure_mode.lower() for s in suggestions]
        assert any("seizure" in m for m in modes)

    def test_suggest_generic_fallback(self, fmea):
        """Should return generic suggestions for unknown components."""
        suggestions = fmea.suggest_failure_modes_for_component("widget_xyz", "generic")
        assert len(suggestions) > 0


# ═══════════════════════════════════════════════════════════════
#  RCA TESTS
# ═══════════════════════════════════════════════════════════════

class TestRCAEngine:

    def test_create_investigation(self, rca):
        """Should create an investigation with root node."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Pump P-101A Seizure",
            method=RCAMethod.FIVE_WHY,
            problem_statement="Pump P-101A seized during normal operation.",
        ))
        assert inv.title == "Pump P-101A Seizure"
        assert inv.method == RCAMethod.FIVE_WHY
        assert len(inv.nodes) == 1  # root node
        assert inv.nodes[0].node_type == RCANodeType.PROBLEM

    def test_five_why_chain(self, rca):
        """5-Why chain should create linked nodes."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Test 5-Why",
            method=RCAMethod.FIVE_WHY,
            problem_statement="Bearing failed prematurely.",
        ))
        causes = [
            "Bearing overheated",
            "Lubrication was inadequate",
            "Oil filter was blocked",
            "Maintenance schedule was not followed",
            "No PM reminder system in place",
        ]
        nodes = rca.build_five_why_chain(inv.id, causes)
        assert len(nodes) == 5
        assert nodes[-1].is_root_cause is True
        assert nodes[-1].node_type == RCANodeType.ROOT_CAUSE

    def test_fishbone_diagram(self, rca):
        """Fishbone should create 6M categories with sub-causes."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Test Fishbone",
            method=RCAMethod.FISHBONE,
            problem_statement="Excessive vibration on pump.",
        ))
        causes_by_cat = {
            FishboneCategory.MACHINE: ["Bearing wear", "Impeller imbalance"],
            FishboneCategory.MAN: ["Incorrect installation"],
            FishboneCategory.METHOD: ["No alignment procedure"],
        }
        result = rca.build_fishbone(inv.id, causes_by_cat)
        assert "machine" in result
        assert len(result["machine"]) == 2
        assert len(result["man"]) == 1

    def test_fta_probability_and_gate(self, rca):
        """AND gate: P(A ∩ B) = P(A) × P(B)."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Test FTA",
            method=RCAMethod.FTA,
            problem_statement="System failure.",
        ))
        root = inv.nodes[0]

        # Create AND gate below top event
        and_gate = rca.add_node(inv.id, RCANodeInput(
            parent_id=root.id,
            node_type=RCANodeType.GATE_AND,
            description="AND gate",
        ))

        # Two basic events: P=0.1 and P=0.2
        rca.add_node(inv.id, RCANodeInput(
            parent_id=and_gate.id,
            node_type=RCANodeType.BASIC_EVENT,
            description="Event A",
            probability=0.1,
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=and_gate.id,
            node_type=RCANodeType.BASIC_EVENT,
            description="Event B",
            probability=0.2,
        ))

        prob = rca.calculate_fta_probability(inv.id)
        # Top event (OR by default) → AND gate → 0.1 × 0.2 = 0.02
        expected = 1.0 - (1.0 - 0.02)  # OR with single child = child value
        assert abs(prob - 0.02) < 0.01

    def test_fta_probability_or_gate(self, rca):
        """OR gate: P(A ∪ B) = 1 - (1-P(A))(1-P(B))."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Test FTA OR",
            method=RCAMethod.FTA,
            problem_statement="System failure.",
        ))
        root = inv.nodes[0]

        or_gate = rca.add_node(inv.id, RCANodeInput(
            parent_id=root.id,
            node_type=RCANodeType.GATE_OR,
            description="OR gate",
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=or_gate.id,
            node_type=RCANodeType.BASIC_EVENT,
            description="Event A",
            probability=0.3,
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=or_gate.id,
            node_type=RCANodeType.BASIC_EVENT,
            description="Event B",
            probability=0.4,
        ))

        prob = rca.calculate_fta_probability(inv.id)
        # OR gate: 1 - (1-0.3)(1-0.4) = 1 - 0.42 = 0.58
        expected = 0.58
        assert abs(prob - expected) < 0.05

    def test_barrier_analysis(self, rca):
        """Barrier analysis should categorize barriers."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Test Barrier",
            method=RCAMethod.BARRIER,
            problem_statement="Hydrocarbon release.",
        ))
        root = inv.nodes[0]

        rca.add_node(inv.id, RCANodeInput(
            parent_id=root.id,
            node_type=RCANodeType.BARRIER_FAILED,
            description="Primary containment seal failed",
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=root.id,
            node_type=RCANodeType.BARRIER_ABSENT,
            description="No secondary containment bund",
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=root.id,
            node_type=RCANodeType.BARRIER_EFFECTIVE,
            description="Gas detection system alarmed",
        ))

        barriers = rca.summarize_barriers(inv.id)
        assert len(barriers["failed"]) == 1
        assert len(barriers["absent"]) == 1
        assert len(barriers["effective"]) == 1


# ═══════════════════════════════════════════════════════════════
#  RCA PATTERN DETECTION TESTS
# ═══════════════════════════════════════════════════════════════

class TestRCAPatternDetection:

    def test_detects_recurring_causes(self, rca, pattern_detector):
        """Should detect recurring root causes across investigations."""
        invs = []
        for i in range(3):
            inv = rca.create_investigation(RCAInvestigationCreate(
                asset_id=uuid4(),
                title=f"Investigation {i}",
                method=RCAMethod.FIVE_WHY,
                problem_statement=f"Bearing failure {i}",
            ))
            rca.add_node(inv.id, RCANodeInput(
                parent_id=inv.nodes[0].id,
                node_type=RCANodeType.ROOT_CAUSE,
                description="Lubrication contamination caused bearing failure",
                is_root_cause=True,
            ))
            invs.append(rca.get_investigation(inv.id))

        patterns = pattern_detector.detect_patterns(invs, min_frequency=2)
        assert len(patterns) > 0
        assert any("lubrication" in p.recurring_cause.lower() for p in patterns)

    def test_no_patterns_below_threshold(self, rca, pattern_detector):
        """Should not report patterns below minimum frequency."""
        inv = rca.create_investigation(RCAInvestigationCreate(
            asset_id=uuid4(),
            title="Single incident",
            method=RCAMethod.FIVE_WHY,
            problem_statement="One-off failure",
        ))
        rca.add_node(inv.id, RCANodeInput(
            parent_id=inv.nodes[0].id,
            node_type=RCANodeType.ROOT_CAUSE,
            description="Unique failure mechanism",
            is_root_cause=True,
        ))

        invs = [rca.get_investigation(inv.id)]
        patterns = pattern_detector.detect_patterns(invs, min_frequency=2)
        assert len(patterns) == 0


# ═══════════════════════════════════════════════════════════════
#  CRITICALITY MATRIX TESTS
# ═══════════════════════════════════════════════════════════════

class TestCriticalityMatrix:

    def test_basic_assessment(self, criticality):
        """Basic assessment should compute risk score and rank."""
        result = criticality.assess(CriticalityInput(
            asset_id=uuid4(),
            consequence_safety=3,
            consequence_environmental=2,
            consequence_production=4,
            consequence_reputation=2,
            consequence_financial=3,
            likelihood=3,
        ))
        assert result.max_consequence == 4
        assert result.overall_risk_score == 12  # 4 × 3
        assert result.criticality_rank == "B"  # 12 ≥ 8 but < 15

    def test_criticality_a_high_risk(self, criticality):
        """High risk score should produce Criticality A."""
        result = criticality.assess(CriticalityInput(
            asset_id=uuid4(),
            consequence_safety=5,
            consequence_environmental=3,
            consequence_production=4,
            consequence_reputation=2,
            consequence_financial=3,
            likelihood=4,
        ))
        assert result.criticality_rank == "A"  # 5 × 4 = 20 ≥ 15

    def test_criticality_a_safety_consequence(self, criticality):
        """Safety consequence ≥ 4 → Criticality A regardless of likelihood."""
        result = criticality.assess(CriticalityInput(
            asset_id=uuid4(),
            consequence_safety=4,
            consequence_environmental=1,
            consequence_production=1,
            consequence_reputation=1,
            consequence_financial=1,
            likelihood=1,  # low likelihood
        ))
        assert result.criticality_rank == "A"

    def test_criticality_c_low_risk(self, criticality):
        """Low risk score should produce Criticality C."""
        result = criticality.assess(CriticalityInput(
            asset_id=uuid4(),
            consequence_safety=1,
            consequence_environmental=1,
            consequence_production=2,
            consequence_reputation=1,
            consequence_financial=2,
            likelihood=2,
        ))
        assert result.overall_risk_score == 4  # 2 × 2
        assert result.criticality_rank == "C"

    def test_auto_criticality_a_turbine(self, criticality):
        """Turbines should auto-default to Criticality A."""
        result = criticality.assess(
            CriticalityInput(
                asset_id=uuid4(),
                consequence_safety=1,
                consequence_environmental=1,
                consequence_production=1,
                consequence_reputation=1,
                consequence_financial=1,
                likelihood=1,
            ),
            asset_class="turbine",
        )
        assert result.criticality_rank == "A"

    def test_auto_criticality_a_compressor(self, criticality):
        """Compressors should auto-default to Criticality A."""
        result = criticality.assess(
            CriticalityInput(
                asset_id=uuid4(),
                consequence_safety=1,
                consequence_environmental=1,
                consequence_production=1,
                consequence_reputation=1,
                consequence_financial=1,
                likelihood=1,
            ),
            asset_class="compressor",
        )
        assert result.criticality_rank == "A"

    def test_risk_matrix_cell(self, criticality):
        """Risk matrix cell should be formatted as consequence-likelihood."""
        result = criticality.assess(CriticalityInput(
            asset_id=uuid4(),
            consequence_safety=3,
            consequence_environmental=2,
            consequence_production=4,
            consequence_reputation=2,
            consequence_financial=3,
            likelihood=3,
        ))
        assert result.risk_matrix_cell == "4-3"

    def test_risk_level_descriptions(self, criticality):
        """Risk levels should follow the matrix."""
        assert criticality.get_risk_level(5, 5) == "extreme"
        assert criticality.get_risk_level(4, 3) == "high"
        assert criticality.get_risk_level(3, 2) == "medium"
        assert criticality.get_risk_level(1, 2) == "low"
