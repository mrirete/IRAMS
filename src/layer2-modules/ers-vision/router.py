"""
ERS Vision — FastAPI Router
════════════════════════════
4 endpoints:
  POST /vision/analyze        — Upload photo + analysis type
  GET  /vision/asset/{id}/history — Photo timeline + trend
  POST /vision/compare        — Two images, detect changes
  GET  /vision/drone-survey/{id}/report

ALL outputs are Tier 2 (advisory).
'Critical' severity ALWAYS flags for immediate human review.
"""
from typing import Optional, Dict, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from ers_vision.schemas import (
    AnalysisType, VisionAnalysisRequest,
    CorrosionAnalysisInput, CorrosionAnalysisOutput,
    ThermalAnalysisInput, ThermalAnalysisOutput,
    ConditionAnalysisInput, ConditionAnalysisOutput,
    ComparisonInput, ComparisonOutput,
    AssetPhotoHistory, AssetPhotoRecord,
    DroneSurveyInput, DroneSurveyOutput,
)
from ers_vision.corrosion.engine import CorrosionDetectionEngine
from ers_vision.thermal.engine import ThermalAnalysisEngine
from ers_vision.condition.engine import ConditionAssessmentEngine
from ers_vision.tagging.engine import AutoTaggingEngine
from ers_vision.drone.engine import DroneSurveyEngine
from ers_vision.comparison.engine import HistoricalComparisonEngine


router = APIRouter(prefix="/vision", tags=["ERS Vision"])

# ── Lazy singletons ────────────────────────────────────────
_corrosion: Optional[CorrosionDetectionEngine] = None
_thermal: Optional[ThermalAnalysisEngine] = None
_condition: Optional[ConditionAssessmentEngine] = None
_tagging: Optional[AutoTaggingEngine] = None
_drone: Optional[DroneSurveyEngine] = None
_comparison: Optional[HistoricalComparisonEngine] = None


def _get_corrosion() -> CorrosionDetectionEngine:
    global _corrosion
    if _corrosion is None:
        _corrosion = CorrosionDetectionEngine()
    return _corrosion

def _get_thermal() -> ThermalAnalysisEngine:
    global _thermal
    if _thermal is None:
        _thermal = ThermalAnalysisEngine()
    return _thermal

def _get_condition() -> ConditionAssessmentEngine:
    global _condition
    if _condition is None:
        _condition = ConditionAssessmentEngine()
    return _condition

def _get_tagging() -> AutoTaggingEngine:
    global _tagging
    if _tagging is None:
        _tagging = AutoTaggingEngine()
    return _tagging

def _get_drone() -> DroneSurveyEngine:
    global _drone
    if _drone is None:
        _drone = DroneSurveyEngine()
    return _drone

def _get_comparison() -> HistoricalComparisonEngine:
    global _comparison
    if _comparison is None:
        _comparison = HistoricalComparisonEngine()
    return _comparison


# ══════════════════════════════════════════════════════════════
#  POST /vision/analyze
# ══════════════════════════════════════════════════════════════

@router.post(
    "/analyze",
    summary="Analyze inspection photo",
    response_model=Dict[str, Any],
    status_code=status.HTTP_200_OK,
)
async def analyze_photo(request: VisionAnalysisRequest):
    """
    Upload a photo and select analysis type:
    - corrosion: Detect and classify corrosion
    - thermal: Analyze IR image for anomalies
    - condition: General condition assessment
    - tagging: Auto-tag photo to asset
    - drone: Process single drone image
    - comparison: Compare two images (use /compare endpoint instead)

    ALL results are Tier 2 (advisory). Critical findings auto-flag
    for immediate human review.
    """
    if request.analysis_type == AnalysisType.CORROSION:
        inp = CorrosionAnalysisInput(
            asset_id=request.asset_id,
            image_data=request.image_data,
            image_url=request.image_url,
            photo_metadata=request.photo_metadata,
            equipment_material=request.equipment_material,
            environment=request.environment,
        )
        result = _get_corrosion().analyze(inp)
        return result.model_dump(mode="json")

    elif request.analysis_type == AnalysisType.THERMAL:
        inp = ThermalAnalysisInput(
            asset_id=request.asset_id,
            image_data=request.image_data,
            image_url=request.image_url,
            photo_metadata=request.photo_metadata,
            equipment_type=request.equipment_type,
            ambient_temperature=request.ambient_temperature,
            emissivity=request.emissivity,
        )
        result = _get_thermal().analyze(inp)
        return result.model_dump(mode="json")

    elif request.analysis_type == AnalysisType.CONDITION:
        inp = ConditionAnalysisInput(
            asset_id=request.asset_id,
            image_data=request.image_data,
            image_url=request.image_url,
            photo_metadata=request.photo_metadata,
            equipment_type=request.equipment_type,
        )
        result = _get_condition().analyze(inp)
        return result.model_dump(mode="json")

    elif request.analysis_type == AnalysisType.COMPARISON:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /vision/compare for image comparison",
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Analysis type '{request.analysis_type}' not supported via /analyze. "
                   f"Supported: corrosion, thermal, condition, tagging.",
        )


# ══════════════════════════════════════════════════════════════
#  GET /vision/asset/{id}/history
# ══════════════════════════════════════════════════════════════

# In-memory photo store (production → DB)
_photo_store: Dict[UUID, list] = {}


@router.get(
    "/asset/{asset_id}/history",
    summary="Get photo history for asset",
    response_model=AssetPhotoHistory,
)
async def get_asset_photo_history(asset_id: UUID):
    """
    Retrieve the photo timeline and trend summary for an asset.
    Returns all inspection photos in chronological order with
    analysis summaries.
    """
    records = _photo_store.get(asset_id, [])
    sorted_records = sorted(records, key=lambda r: r.get("captured_at", ""))

    photos = []
    for rec in sorted_records:
        photos.append(AssetPhotoRecord(
            photo_id=rec.get("photo_id", uuid4()),
            asset_id=asset_id,
            captured_at=rec.get("captured_at"),
            analysis_type=AnalysisType(rec.get("analysis_type", "condition")),
            analysis_summary=rec.get("analysis_summary"),
            severity=rec.get("severity"),
            thumbnail_url=rec.get("thumbnail_url"),
        ))

    trend = "No trend data available" if len(photos) < 2 else "Trend analysis requires 2+ images"

    return AssetPhotoHistory(
        asset_id=asset_id,
        total_photos=len(photos),
        photos=photos,
        trend_summary=trend,
    )


# ══════════════════════════════════════════════════════════════
#  POST /vision/compare
# ══════════════════════════════════════════════════════════════

@router.post(
    "/compare",
    summary="Compare two inspection images",
    response_model=ComparisonOutput,
)
async def compare_images(request: ComparisonInput):
    """
    Compare baseline and current inspection images.
    Quantifies degradation progression and generates
    RBI calibration data for ERS Comply integration.

    Tier 2 — All degradation assessments require engineering validation.
    """
    result = _get_comparison().compare(request)
    return result


# ══════════════════════════════════════════════════════════════
#  GET /vision/drone-survey/{id}/report
# ══════════════════════════════════════════════════════════════

@router.get(
    "/drone-survey/{survey_id}/report",
    summary="Get drone survey report",
    response_model=DroneSurveyOutput,
)
async def get_drone_survey_report(survey_id: UUID):
    """
    Retrieve the processed drone survey report including:
    - Image analysis results
    - Anomaly detections
    - Coverage metrics
    - Composite generation status

    Tier 2 — All flagged anomalies require ground-level verification.
    """
    engine = _get_drone()
    result = engine.get_survey(survey_id)

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Survey {survey_id} not found. Process the survey first.",
        )
    return result


# ══════════════════════════════════════════════════════════════
#  POST /vision/drone-survey (extra: process survey)
# ══════════════════════════════════════════════════════════════

@router.post(
    "/drone-survey",
    summary="Process drone survey",
    response_model=DroneSurveyOutput,
    status_code=status.HTTP_201_CREATED,
)
async def process_drone_survey(request: DroneSurveyInput):
    """
    Submit drone survey images for processing.
    Returns analysis results with anomaly flagging.
    Use GET /vision/drone-survey/{id}/report to retrieve later.
    """
    result = _get_drone().process_survey(request)
    return result
