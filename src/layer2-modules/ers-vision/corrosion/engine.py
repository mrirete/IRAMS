"""
Corrosion Detection Engine
══════════════════════════
Analyzes field photos for corrosion using Claude Opus 4.6 vision
with deterministic fallback for offline/testing use.

ALL outputs are Tier 2 (advisory). 'Critical' severity always
flags for immediate human inspection review.
"""
import json
import base64
from typing import Any, Optional, List
from uuid import uuid4

from ers_vision.schemas import (
    CorrosionAnalysisInput, CorrosionAnalysisOutput, CorrosionDetection,
    CorrosionType, CorrosionSeverity, RecommendedAction,
)


AI_CORROSION_PROMPT = """Analyze this equipment photograph for corrosion. Classify:
- Type: general/pitting/crevice/galvanic/scc/erosion/none
- Severity: surface/moderate/severe/critical
- Estimated affected area percentage (0-100)
- Recommended action: monitor/clean/repair/replace/urgent_inspect
- Confidence: 0.0-1.0

Consider the equipment material ({material}) and environment ({environment}).

Return ONLY a valid JSON array of detected corrosion areas, each with keys:
"type", "severity", "affected_area_percent", "action", "confidence",
"location_description", "notes"

If no corrosion is detected, return: [{{"type":"none","severity":"surface","affected_area_percent":0,"action":"monitor","confidence":0.95,"location_description":"No corrosion detected","notes":""}}]"""


# Severity → action mapping
_SEVERITY_ACTION_MAP = {
    CorrosionSeverity.SURFACE: RecommendedAction.MONITOR,
    CorrosionSeverity.MODERATE: RecommendedAction.CLEAN,
    CorrosionSeverity.SEVERE: RecommendedAction.REPAIR,
    CorrosionSeverity.CRITICAL: RecommendedAction.URGENT_INSPECT,
}

# Severity ordering
_SEVERITY_ORDER = {
    CorrosionSeverity.SURFACE: 0,
    CorrosionSeverity.MODERATE: 1,
    CorrosionSeverity.SEVERE: 2,
    CorrosionSeverity.CRITICAL: 3,
}


class CorrosionDetectionEngine:
    """
    Corrosion detection from field photographs.

    Uses Claude Opus 4.6 vision for AI analysis, with a deterministic
    fallback for testing/offline use based on image metadata heuristics.
    """

    def analyze(
        self,
        inp: CorrosionAnalysisInput,
        ai_client: Optional[Any] = None,
    ) -> CorrosionAnalysisOutput:
        """
        Analyze a photo for corrosion.

        Args:
            inp: Analysis input with image data and context.
            ai_client: Optional AI client for Opus 4.6 vision.
                       Falls back to deterministic if None.
        """
        if ai_client is not None and inp.image_data:
            detections = self._call_ai(ai_client, inp)
        else:
            detections = self._deterministic_analysis(inp)

        # Determine overall severity and action
        if not detections:
            detections = [CorrosionDetection(
                corrosion_type=CorrosionType.NONE,
                severity=CorrosionSeverity.SURFACE,
                affected_area_percent=0.0,
                recommended_action=RecommendedAction.MONITOR,
                confidence=0.9,
            )]

        overall_sev = max(
            (d.severity for d in detections),
            key=lambda s: _SEVERITY_ORDER.get(s, 0),
        )
        overall_act = _SEVERITY_ACTION_MAP.get(overall_sev, RecommendedAction.MONITOR)
        immediate_review = overall_sev == CorrosionSeverity.CRITICAL

        return CorrosionAnalysisOutput(
            asset_id=inp.asset_id,
            detections=detections,
            overall_severity=overall_sev,
            overall_action=overall_act,
            requires_immediate_review=immediate_review,
        )

    def _call_ai(
        self, ai_client: Any, inp: CorrosionAnalysisInput
    ) -> List[CorrosionDetection]:
        """Call Opus 4.6 vision for corrosion analysis."""
        prompt = AI_CORROSION_PROMPT.format(
            material=inp.equipment_material or "carbon steel",
            environment=inp.environment or "industrial",
        )

        try:
            response = ai_client.messages.create(
                model="claude-opus-4-6",
                max_tokens=2048,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": inp.image_data,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }],
            )
            content = response.content[0].text
            return self._parse_ai_response(json.loads(content))
        except Exception:
            return self._deterministic_analysis(inp)

    def _parse_ai_response(
        self, data: List[dict]
    ) -> List[CorrosionDetection]:
        """Parse AI JSON response into CorrosionDetection objects."""
        detections = []
        for item in data:
            try:
                detections.append(CorrosionDetection(
                    corrosion_type=CorrosionType(item.get("type", "none")),
                    severity=CorrosionSeverity(item.get("severity", "surface")),
                    affected_area_percent=float(item.get("affected_area_percent", 0)),
                    recommended_action=RecommendedAction(item.get("action", "monitor")),
                    confidence=float(item.get("confidence", 0.5)),
                    location_description=item.get("location_description"),
                    notes=item.get("notes"),
                ))
            except (ValueError, KeyError):
                continue
        return detections

    def _deterministic_analysis(
        self, inp: CorrosionAnalysisInput
    ) -> List[CorrosionDetection]:
        """
        Deterministic fallback when AI is not available.
        Uses heuristics from metadata and context.
        """
        detections: List[CorrosionDetection] = []
        env = (inp.environment or "").lower()
        material = (inp.equipment_material or "carbon steel").lower()

        # Marine / coastal environments → higher corrosion likelihood
        if "marine" in env or "coastal" in env or "offshore" in env:
            detections.append(CorrosionDetection(
                corrosion_type=CorrosionType.GENERAL,
                severity=CorrosionSeverity.MODERATE,
                affected_area_percent=15.0,
                recommended_action=RecommendedAction.CLEAN,
                confidence=0.60,
                location_description="General area — marine environment",
                notes="Marine environments have elevated corrosion risk. Visual confirmation required.",
            ))

        # Dissimilar metals → galvanic
        if "galvanic" in env or "dissimilar" in material:
            detections.append(CorrosionDetection(
                corrosion_type=CorrosionType.GALVANIC,
                severity=CorrosionSeverity.MODERATE,
                affected_area_percent=5.0,
                recommended_action=RecommendedAction.REPAIR,
                confidence=0.55,
                location_description="Joint/connection area",
                notes="Potential galvanic corrosion at dissimilar metal joint.",
            ))

        # Stainless steel → SCC susceptibility
        if "stainless" in material and "chloride" in env:
            detections.append(CorrosionDetection(
                corrosion_type=CorrosionType.SCC,
                severity=CorrosionSeverity.SEVERE,
                affected_area_percent=3.0,
                recommended_action=RecommendedAction.URGENT_INSPECT,
                confidence=0.50,
                location_description="Weld/HAZ area",
                notes="SCC susceptibility in stainless steel with chloride exposure.",
            ))

        # Default: no significant corrosion detected (with low confidence)
        if not detections:
            detections.append(CorrosionDetection(
                corrosion_type=CorrosionType.NONE,
                severity=CorrosionSeverity.SURFACE,
                affected_area_percent=0.0,
                recommended_action=RecommendedAction.MONITOR,
                confidence=0.40,
                location_description="Full field of view",
                notes="Deterministic analysis — low confidence. AI vision analysis recommended.",
            ))

        return detections
