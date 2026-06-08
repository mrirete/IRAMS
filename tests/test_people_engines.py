"""
Tests — ERS People v2.0 Engines
═══════════════════════════════
Tests for Knowledge Management, Connected Worker, and Competency.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_people.schemas import (
    RawKnowledgeCapture, MediaFormat, InstructionStep,
    DigitalInspectionForm, InspectionField, ValidationRuleType,
    EscalationLevel, TechnicianCompetencyProfile, RoleCompetencyRequirement,
    SkillLevel, Certification, CompetencyGap
)
from ers_people.engines.knowledge import KnowledgeManagementEngine
from ers_people.engines.connected_worker import ConnectedWorkerEngine
from ers_people.engines.competency import CompetencyEngine

# ══════════════════════════════════════════════════════════════
#  KNOWLEDGE ENGINE
# ══════════════════════════════════════════════════════════════

class TestKnowledgeEngine:
    def setup_method(self):
        self.engine = KnowledgeManagementEngine()

    def test_process_capture_deterministic_fallback(self):
        capture = RawKnowledgeCapture(
            technician_id=uuid4(),
            media_format=MediaFormat.AUDIO_WHISPER,
            raw_content="Replaced bearing. It was noisy."
        )
        article = self.engine.process_capture(capture)
        assert article.tags == ["field_note", "audio_whisper"]
        assert "length: 31" in article.summary

    def test_assess_expert_risk_criticality_A_no_techs(self):
        res = self.engine.assess_expert_risk(
            asset_id=uuid4(),
            criticality="A",
            work_order_history=[]
        )
        assert res.risk_level == "HIGH"
        assert "No internal competency established" in res.recommendation

    def test_assess_expert_risk_criticality_A_one_tech(self):
        asset_id = uuid4()
        wo_history = [
            {"asset_id": asset_id, "status": "COMPLETED", "technician_id": uuid4()}
        ]
        res = self.engine.assess_expert_risk(
            asset_id=asset_id,
            criticality="A",
            work_order_history=wo_history
        )
        assert res.risk_level == "HIGH"
        assert "SINGLE POINT OF FAILURE" in res.recommendation

    def test_semantic_search(self):
        capture = RawKnowledgeCapture(
            technician_id=uuid4(),
            media_format=MediaFormat.STRUCTURED_FORM,
            raw_content="Pump V-200 replacement steps."
        )
        self.engine.process_capture(capture)
        results = self.engine.semantic_search("structured")
        assert len(results) == 1


# ══════════════════════════════════════════════════════════════
#  CONNECTED WORKER ENGINE
# ══════════════════════════════════════════════════════════════

class TestConnectedWorkerEngine:
    def setup_method(self):
        self.engine = ConnectedWorkerEngine()

    def test_publish_instruction(self):
        step = InstructionStep(step_number=1, title="Lockout", content="LOTO pump.")
        inst = self.engine.publish_instruction(
            title="Pump Maintenance",
            steps=[step],
            author_id=uuid4(),
            approver_id=uuid4()
        )
        assert inst.version == 1
        assert len(inst.steps) == 1

    def test_inspection_pass(self):
        form_id = uuid4()
        form = DigitalInspectionForm(
            form_id=form_id, title="Test", asset_class="Pump",
            fields=[
                InspectionField(
                    field_id="f1", label="Temp", field_type="number",
                    validation_type=ValidationRuleType.RANGE,
                    validation_params={"min": 50, "max": 100},
                    escalation_on_fail=EscalationLevel.WARNING
                )
            ]
        )
        self.engine.register_form(form)
        
        res = self.engine.process_inspection(
            form_id=form_id, technician_id=uuid4(), asset_id=uuid4(),
            field_inputs={"f1": 75}
        )
        assert res.overall_status == "PASS"
        assert res.results[0].passed is True

    def test_inspection_fail_escalates_to_work_stoppage(self):
        form_id = uuid4()
        form = DigitalInspectionForm(
            form_id=form_id, title="Test", asset_class="Pump",
            fields=[
                InspectionField(
                    field_id="f1", label="Vibration", field_type="number",
                    validation_type=ValidationRuleType.RANGE,
                    validation_params={"min": 0, "max": 5.0},
                    escalation_on_fail=EscalationLevel.WORK_STOPPAGE
                )
            ]
        )
        self.engine.register_form(form)
        
        res = self.engine.process_inspection(
            form_id=form_id, technician_id=uuid4(), asset_id=uuid4(),
            field_inputs={"f1": 8.0} # 8.0 > 5.0 -> Fail
        )
        assert res.overall_status == "ESCALATED"
        assert res.escalation_triggered == EscalationLevel.WORK_STOPPAGE


# ══════════════════════════════════════════════════════════════
#  COMPETENCY ENGINE (ISO 55012)
# ══════════════════════════════════════════════════════════════

class TestCompetencyEngine:
    def setup_method(self):
        self.engine = CompetencyEngine()

    def test_gap_analysis_critical_safety_gap(self):
        tech_id = uuid4()
        profiles = [
            TechnicianCompetencyProfile(
                technician_id=tech_id,
                certifications=[],
                skills={"electrical": SkillLevel.NOVICE}
            )
        ]
        roles = {
            "senior_electrician": RoleCompetencyRequirement(
                role_id="senior_electrician",
                required_skills={"electrical": SkillLevel.PROFICIENT},
                required_certifications=[]
            )
        }
        res = self.engine.perform_gap_analysis(profiles, roles, {tech_id: "senior_electrician"})
        
        assert len(res) == 1
        assert res[0].is_critical_safety_gap is True # Proficient (3) - Novice (1) = 2 >= 2

    def test_gap_analysis_standard_gap(self):
        tech_id = uuid4()
        profiles = [
            TechnicianCompetencyProfile(
                technician_id=tech_id,
                certifications=[],
                skills={"mechanical": SkillLevel.INTERMEDIATE}
            )
        ]
        roles = {
            "senior_mechanic": RoleCompetencyRequirement(
                role_id="senior_mechanic",
                required_skills={"mechanical": SkillLevel.PROFICIENT},
                required_certifications=[]
            )
        }
        res = self.engine.perform_gap_analysis(profiles, roles, {tech_id: "senior_mechanic"})
        
        assert len(res) == 1
        assert res[0].is_critical_safety_gap is False # Proficient (3) - Intermediate (2) = 1 < 2

    def test_generate_stakeholder_report(self):
        tech_id = uuid4()
        profiles = [
            TechnicianCompetencyProfile(
                technician_id=tech_id,
                certifications=[
                    Certification(
                        cert_id=uuid4(), name="CMRP", issuing_body="SMRP",
                        issued_date=datetime.utcnow() - timedelta(days=500),
                        expiry_date=datetime.utcnow() + timedelta(days=30) # Expiring soon
                    )
                ],
                skills={"electrical": SkillLevel.NOVICE}
            )
        ]
        gaps = [
            CompetencyGap(
                technician_id=tech_id, skill_required="electrical",
                current_level=SkillLevel.NOVICE, required_level=SkillLevel.EXPERT,
                is_critical_safety_gap=True
            )
        ]
        
        report = self.engine.generate_stakeholder_report(profiles, gaps)
        
        assert report.total_technicians == 1
        assert report.fully_competent_percent == 0.0
        assert report.critical_safety_gaps_count == 1
        assert report.expiring_certifications_next_90_days == 1
        assert "IMMEDIATE ACTION" in report.recommendation
