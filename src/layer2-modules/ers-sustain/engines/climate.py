"""
Climate Risk Engine
═══════════════════
Evaluates an asset's vulnerability to extreme weather events
(flooding, wildfire, heat, etc.) based on its location and criticality.
"""
from typing import List
from uuid import UUID

from ers_sustain.schemas import (
    ClimateVulnerabilityAssessment, ClimateRiskFactor
)


class ClimateRiskEngine:
    """Engine for generating climate risk overlays for assets."""

    def assess_risk(
        self,
        asset_id: UUID,
        criticality: str,
        detected_risks: List[ClimateRiskFactor],
        elevation_meters: float = 10.0,
        temp_max_historical_c: float = 35.0
    ) -> ClimateVulnerabilityAssessment:
        """
        Heuristic-driven baseline assessment of climate risk exposure.
        In production, this integrates with external NOAA/IPCC climate datasets.
        """
        score = 0.0
        recommendations = []

        # Base penalty for criticality
        criticality_weight = {"A": 1.5, "B": 1.1, "C": 0.8}.get(criticality.upper(), 1.0)

        for risk in detected_risks:
            if risk == ClimateRiskFactor.FLOODING:
                if elevation_meters < 5.0:
                    score += 40.0
                    recommendations.append("Install flood barriers or elevate sensitive electrical components.")
                else:
                    score += 15.0
                    
            elif risk == ClimateRiskFactor.EXTREME_HEAT:
                if temp_max_historical_c > 45.0:
                    score += 35.0
                    recommendations.append("Upgrade HVAC/cooling capacity; review thermal operating limits.")
                else:
                    score += 20.0
                    recommendations.append("Monitor ambient efficiency drops during summer months.")
                    
            elif risk == ClimateRiskFactor.HURRICANE_TYPHOON:
                score += 30.0
                recommendations.append("Reinforce structural anchors; review wind-load certifications.")
                
            elif risk == ClimateRiskFactor.WILDFIRE:
                score += 25.0
                recommendations.append("Establish 30m defensible space clear of vegetation; audit air filtration.")
                
            elif risk == ClimateRiskFactor.FREEZING:
                score += 25.0
                recommendations.append("Winterize instrumentation lines; ensure heat tracing is operational.")
                
            elif risk == ClimateRiskFactor.WATER_SCARCITY:
                score += 20.0
                recommendations.append("Audit water consumption; implement closed-loop cooling reclamation.")

        # Apply criticality multiplier
        final_score = min(score * criticality_weight, 100.0)

        # Ensure we always have some output if risks were detected
        if detected_risks and not recommendations:
            recommendations.append("Conduct comprehensive local climate resilience audit.")

        return ClimateVulnerabilityAssessment(
            asset_id=asset_id,
            criticality=criticality,
            risk_factors=detected_risks,
            vulnerability_score=round(final_score, 1),
            mitigation_recommendations=recommendations
        )
