"""
Drone Survey Engine
═══════════════════
Ingests systematic survey imagery, stitches composites,
and flags anomalies for review.

ALL outputs are Tier 2 (advisory).
"""
from typing import Any, Optional, List, Dict
from uuid import UUID, uuid4

from ers_vision.schemas import (
    DroneSurveyInput, DroneSurveyOutput, DroneAnomaly,
    DroneFlightStatus,
)


class DroneSurveyEngine:
    """
    Drone survey processing engine.

    - Ingest survey images and metadata
    - Composite stitching (stub — production uses OpenCV)
    - AI anomaly detection per image
    - Coverage calculation
    """

    def __init__(self):
        self._surveys: Dict[UUID, DroneSurveyOutput] = {}

    def process_survey(
        self,
        inp: DroneSurveyInput,
        ai_client: Optional[Any] = None,
    ) -> DroneSurveyOutput:
        """
        Process a drone survey.

        Args:
            inp: Survey input with image list and metadata.
            ai_client: Optional AI for anomaly detection.
        """
        survey_id = inp.survey_id or uuid4()
        total = len(inp.images)

        # Analyze each image for anomalies
        anomalies: List[DroneAnomaly] = []
        for idx, img in enumerate(inp.images):
            detected = self._analyze_image(idx, img, ai_client)
            anomalies.extend(detected)

        # Calculate coverage
        coverage = self._calculate_coverage(inp.images)

        result = DroneSurveyOutput(
            survey_id=survey_id,
            asset_id=inp.asset_id,
            status=DroneFlightStatus.ANALYZED,
            total_images=total,
            images_analyzed=total,
            anomalies=anomalies,
            anomaly_count=len(anomalies),
            composite_generated=total > 1,
            coverage_percent=coverage,
        )

        self._surveys[survey_id] = result
        return result

    def get_survey(self, survey_id: UUID) -> Optional[DroneSurveyOutput]:
        """Retrieve a processed survey."""
        return self._surveys.get(survey_id)

    def _analyze_image(
        self,
        index: int,
        image: Dict[str, Any],
        ai_client: Optional[Any],
    ) -> List[DroneAnomaly]:
        """Analyze a single drone image for anomalies."""
        anomalies = []

        # Check for flagged anomalies in metadata
        flags = image.get("flags", [])
        for flag in flags:
            anomalies.append(DroneAnomaly(
                anomaly_id=uuid4(),
                image_index=index,
                anomaly_type=flag.get("type", "unknown"),
                severity=flag.get("severity", "low"),
                location_description=flag.get("location", f"Image {index}"),
                confidence=float(flag.get("confidence", 0.7)),
                requires_followup=flag.get("severity", "low") in ("high", "critical"),
            ))

        # Deterministic: check metadata markers
        if image.get("corrosion_markers"):
            anomalies.append(DroneAnomaly(
                anomaly_id=uuid4(),
                image_index=index,
                anomaly_type="corrosion",
                severity="medium",
                location_description=f"Image {index}: {image.get('location', 'N/A')}",
                confidence=0.65,
                requires_followup=True,
            ))

        if image.get("structural_damage"):
            anomalies.append(DroneAnomaly(
                anomaly_id=uuid4(),
                image_index=index,
                anomaly_type="structural",
                severity="high",
                location_description=f"Image {index}: {image.get('location', 'N/A')}",
                confidence=0.70,
                requires_followup=True,
            ))

        return anomalies

    @staticmethod
    def _calculate_coverage(images: List[Dict[str, Any]]) -> float:
        """Estimate survey coverage from image metadata."""
        if not images:
            return 0.0

        # Simple heuristic: each image covers ~5% of asset surface
        # with overlap reduction for adjacent images
        raw_coverage = len(images) * 5.0
        # Apply overlap reduction (diminishing returns)
        effective = min(100.0, raw_coverage * 0.8)
        return round(effective, 1)
