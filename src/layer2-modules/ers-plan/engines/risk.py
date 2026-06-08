"""
Risk Module Engine
══════════════════
Risk register, 5×5 heat map generation, bow-tie analysis,
and mitigation tracking with residual risk recalculation.
"""
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from ers_plan.schemas import (
    RiskEntry, RiskHeatmap, RiskHeatmapCell,
    BowTieModel, BowTieThreat, BowTieConsequence,
    MitigationAction, MitigationStatus,
    RiskLikelihood, RiskConsequence, RiskCategory
)

# 5×5 risk matrix color coding (likelihood × consequence)
_RISK_COLORS = {
    (1, 1): "green", (1, 2): "green", (1, 3): "yellow", (1, 4): "orange", (1, 5): "red",
    (2, 1): "green", (2, 2): "yellow", (2, 3): "yellow", (2, 4): "orange", (2, 5): "red",
    (3, 1): "yellow", (3, 2): "yellow", (3, 3): "orange", (3, 4): "red", (3, 5): "red",
    (4, 1): "yellow", (4, 2): "orange", (4, 3): "orange", (4, 4): "red", (4, 5): "dark_red",
    (5, 1): "orange", (5, 2): "orange", (5, 3): "red", (5, 4): "dark_red", (5, 5): "dark_red",
}


class RiskEngine:
    """Engine for risk register, heat maps, bow-tie analysis, and mitigations."""

    def __init__(self):
        self._risks: Dict[UUID, RiskEntry] = {}
        self._bowtie: Dict[UUID, BowTieModel] = {}

    # ── Risk Register CRUD ─────────────────────────────────

    def register_risk(self, risk: RiskEntry) -> RiskEntry:
        risk.inherent_risk_score = risk.likelihood.value * risk.consequence.value
        self._risks[risk.risk_id] = risk
        return risk

    def get_risk(self, risk_id: UUID) -> Optional[RiskEntry]:
        return self._risks.get(risk_id)

    def add_mitigation(self, risk_id: UUID, mitigation: MitigationAction) -> RiskEntry:
        risk = self._risks.get(risk_id)
        if not risk:
            raise ValueError(f"Risk {risk_id} not found")
        risk.mitigations.append(mitigation)
        self._recalculate_residual(risk)
        return risk

    def _recalculate_residual(self, risk: RiskEntry):
        """
        Recalculates residual risk based on mitigation effectiveness.
        Total effectiveness reduces likelihood and consequence proportionally.
        """
        completed = [m for m in risk.mitigations if m.status == MitigationStatus.COMPLETED]
        if not completed:
            risk.residual_likelihood = risk.likelihood
            risk.residual_consequence = risk.consequence
            risk.residual_risk_score = risk.inherent_risk_score
            return

        avg_effectiveness = sum(m.effectiveness_percent for m in completed) / len(completed)
        reduction_factor = 1.0 - (avg_effectiveness / 100.0)

        # Reduce likelihood (floor at 1)
        new_lik = max(1, round(risk.likelihood.value * reduction_factor))
        risk.residual_likelihood = RiskLikelihood(new_lik)

        # Consequence generally stays the same (mitigations reduce probability, not impact)
        risk.residual_consequence = risk.consequence
        risk.residual_risk_score = new_lik * risk.consequence.value

    # ── Heat Map ───────────────────────────────────────────

    def generate_heatmap(self, use_residual: bool = False) -> RiskHeatmap:
        """Generates a 5×5 risk heat map from the register."""
        grid: Dict[tuple, List[UUID]] = {}

        for lik in range(1, 6):
            for con in range(1, 6):
                grid[(lik, con)] = []

        for risk in self._risks.values():
            if use_residual and risk.residual_likelihood:
                lik = risk.residual_likelihood.value
                con = risk.residual_consequence.value if risk.residual_consequence else risk.consequence.value
            else:
                lik = risk.likelihood.value
                con = risk.consequence.value
            grid[(lik, con)].append(risk.risk_id)

        cells = []
        for (lik, con), ids in grid.items():
            cells.append(RiskHeatmapCell(
                likelihood=lik,
                consequence=con,
                risk_ids=ids,
                count=len(ids),
                color=_RISK_COLORS.get((lik, con), "green")
            ))

        return RiskHeatmap(cells=cells, total_risks=len(self._risks))

    # ── Bow-Tie Analysis ───────────────────────────────────

    def create_bowtie(
        self,
        risk_id: UUID,
        top_event: str,
        threats: List[BowTieThreat],
        consequences: List[BowTieConsequence]
    ) -> BowTieModel:
        model = BowTieModel(
            risk_id=risk_id,
            top_event=top_event,
            threats=threats,
            consequences=consequences
        )
        self._bowtie[risk_id] = model
        return model

    def get_bowtie(self, risk_id: UUID) -> Optional[BowTieModel]:
        return self._bowtie.get(risk_id)
