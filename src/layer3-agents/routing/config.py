"""
Agent Router — Routing Rules Configuration
════════════════════════════════════════════
Defines keyword → agent mappings for all ERS specialist agents.
"""
from dataclasses import dataclass, field
from typing import List, Dict, Set


@dataclass
class AgentRoute:
    """Routing rule for a specialist agent."""
    agent_name: str
    display_name: str
    keywords: Set[str] = field(default_factory=set)
    priority: int = 0  # Higher = checked first on ties
    description: str = ""


# ══════════════════════════════════════════════════════════════
#  ROUTING RULES — per PROMPT 5.1 + A.3
# ══════════════════════════════════════════════════════════════

AGENT_ROUTES: List[AgentRoute] = [
    # ── 1) Work Intelligence Agent ─────────────────────────
    AgentRoute(
        agent_name="work_intelligence",
        display_name="Work Intelligence Agent",
        keywords={
            "work order", "work request", "task", "backlog",
            "schedule", "planning", "priority", "assignment",
            "technician", "craft", "labor", "resource",
        },
        priority=5,
        description="Work order management, scheduling, and resource planning.",
    ),

    # ── 2) Predictive Maintenance Agent ────────────────────
    AgentRoute(
        agent_name="predictive_maintenance",
        display_name="Predictive Maintenance Agent",
        keywords={
            "predict", "prediction", "forecast", "remaining useful life",
            "rul", "failure probability", "vibration", "bearing",
            "condition monitoring", "health index", "digital twin",
            "monte carlo", "weibull", "survival", "censored",
        },
        priority=5,
        description="Failure prediction, RUL estimation, and condition monitoring.",
    ),

    # ── 3) Reliability Analyst Agent ───────────────────────
    AgentRoute(
        agent_name="reliability_analyst",
        display_name="Reliability Analyst Agent",
        keywords={
            "rcm", "reliability centered", "fmea", "failure mode",
            "rca", "root cause", "criticality", "bad actor",
            "defect elimination", "mtbf", "mttr", "availability",
            "reliability", "failure analysis",
        },
        priority=5,
        description="RCM, FMEA, RCA, criticality analysis, bad actor identification.",
    ),

    # ── 4) Strategic Asset Agent ───────────────────────────
    AgentRoute(
        agent_name="strategic_asset",
        display_name="Strategic Asset Manager",
        keywords={
            "lifecycle", "capex", "opex", "replacement",
            "depreciation", "asset strategy", "iso 55000",
            "asset management plan", "investment", "roi",
            "total cost of ownership", "tco",
        },
        priority=4,
        description="Asset lifecycle strategy, capital planning, ISO 55000.",
    ),

    # ── 5) Knowledge & People Agent ────────────────────────
    AgentRoute(
        agent_name="knowledge_people",
        display_name="Knowledge & People Agent",
        keywords={
            "training", "certification", "competency", "personnel",
            "succession", "knowledge transfer", "documentation",
            "procedure", "sop",
        },
        priority=3,
        description="Personnel competency, training, and knowledge management.",
    ),

    # ── 6) Sustainability Agent ────────────────────────────
    AgentRoute(
        agent_name="sustainability",
        display_name="Sustainability Agent",
        keywords={
            "emissions", "carbon", "energy", "sustainability",
            "environmental", "waste", "esg", "ghg",
            "carbon footprint", "net zero",
        },
        priority=3,
        description="Emissions tracking, sustainability reporting, ESG.",
    ),

    # ── 7) Inspection Vision Agent ─────────────────────────
    AgentRoute(
        agent_name="inspection_vision",
        display_name="Inspection Vision Agent",
        keywords={
            "image", "photo", "visual inspection", "drone",
            "nde", "ndt", "radiograph", "ultrasonic image",
            "defect detection", "crack detection",
        },
        priority=4,
        description="Computer vision for inspection images, NDE/NDT analysis.",
    ),

    # ── 8) Compliance & Safety Agent ───────────────────────
    AgentRoute(
        agent_name="compliance_safety",
        display_name="Compliance & Safety Agent",
        keywords={
            "loto", "lockout tagout", "permit to work", "ptw",
            "jsa", "job safety", "psm", "moc", "pssr", "pha",
            "safety", "hazard", "isolation",
        },
        priority=4,
        description="LOTO, PSM, PTW, JSA, safety compliance.",
    ),

    # ── 9) Asset Integrity Auditor Agent (PROMPT A.3) ──────
    AgentRoute(
        agent_name="asset_integrity_auditor",
        display_name="Asset Integrity Auditor",
        keywords={
            # Core integrity terms
            "inspection", "thickness", "corrosion rate", "corrosion",
            "ffs", "fitness for service", "fit for service",
            "damage mechanism", "iow", "integrity operating window",
            # API standards
            "api 510", "api 570", "api 653", "api 571",
            "api 579", "api 580", "api 584",
            # Technical terms
            "mechanical integrity", "audit", "integrity audit",
            "regulatory preparedness", "cml", "pressure vessel",
            "piping", "tank", "remaining life",
            "wall loss", "thinning", "rsf",
            "mawp", "retirement thickness",
            # PSM reference
            "1910.119", "psm mechanical integrity",
        },
        priority=8,  # High priority — specific domain
        description=(
            "Mechanical integrity, inspection codes, FFS, damage mechanisms, "
            "corrosion management, IOW monitoring, and integrity auditing."
        ),
    ),
]
