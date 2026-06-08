"""
ERS Vision — Schemas
════════════════════
Enums, I/O models, and photo metadata for all 6 analysis engines.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════
#  ENUMS
# ══════════════════════════════════════════════════════════════

class AnalysisType(str, Enum):
    CORROSION = "corrosion"
    THERMAL = "thermal"
    CONDITION = "condition"
    TAGGING = "tagging"
    DRONE = "drone"
    COMPARISON = "comparison"

class CorrosionType(str, Enum):
    GENERAL = "general"
    PITTING = "pitting"
    CREVICE = "crevice"
    GALVANIC = "galvanic"
    SCC = "scc"
    EROSION = "erosion"
    NONE = "none"

class CorrosionSeverity(str, Enum):
    SURFACE = "surface"
    MODERATE = "moderate"
    SEVERE = "severe"
    CRITICAL = "critical"

class RecommendedAction(str, Enum):
    MONITOR = "monitor"
    CLEAN = "clean"
    REPAIR = "repair"
    REPLACE = "replace"
    URGENT_INSPECT = "urgent_inspect"

class ThermalAnomalyType(str, Enum):
    HOT_SPOT_ELECTRICAL = "hot_spot_electrical"
    BEARING_ANOMALY = "bearing_anomaly"
    REFRACTORY_DEGRADATION = "refractory_degradation"
    INSULATION_FAILURE = "insulation_failure"
    STEAM_TRAP_MALFUNCTION = "steam_trap_malfunction"
    HX_FOULING = "hx_fouling"
    NORMAL = "normal"

class ThermalSeverity(str, Enum):
    NORMAL = "normal"
    CAUTION = "caution"
    WARNING = "warning"
    ALARM = "alarm"
    CRITICAL = "critical"

class ConditionItem(str, Enum):
    OIL_LEAK = "oil_leak"
    BELT_WEAR = "belt_wear"
    COUPLING_WEAR = "coupling_wear"
    SEAL_CONDITION = "seal_condition"
    VIBRATION_DAMAGE = "vibration_damage"
    LUBRICATION = "lubrication"
    HOUSEKEEPING = "housekeeping"

class TaggingMethod(str, Enum):
    BARCODE = "barcode"
    QR_CODE = "qr_code"
    NFC = "nfc"
    GPS = "gps"
    MANUAL = "manual"

class DroneFlightStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PROCESSING = "processing"
    ANALYZED = "analyzed"


# ══════════════════════════════════════════════════════════════
#  PHOTO METADATA
# ══════════════════════════════════════════════════════════════

class PhotoMetadata(BaseModel):
    """Metadata for an inspection photo."""
    photo_id: Optional[UUID] = None
    asset_id: Optional[UUID] = None
    captured_at: datetime = Field(default_factory=datetime.utcnow)
    captured_by: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    camera_model: Optional[str] = None
    resolution: Optional[str] = None  # e.g. "4032x3024"
    file_size_bytes: Optional[int] = None
    file_name: Optional[str] = None
    tagging_method: Optional[TaggingMethod] = None
    notes: Optional[str] = None


# ══════════════════════════════════════════════════════════════
#  1) CORROSION DETECTION
# ══════════════════════════════════════════════════════════════

class CorrosionAnalysisInput(BaseModel):
    """Input for corrosion detection analysis."""
    asset_id: Optional[UUID] = None
    image_data: Optional[str] = None       # base64 encoded
    image_url: Optional[str] = None
    photo_metadata: Optional[PhotoMetadata] = None
    equipment_material: Optional[str] = None
    environment: Optional[str] = None       # "marine", "indoor", etc.

class CorrosionDetection(BaseModel):
    """Single corrosion detection result."""
    corrosion_type: CorrosionType
    severity: CorrosionSeverity
    affected_area_percent: float = 0.0      # 0-100
    recommended_action: RecommendedAction
    confidence: float = 0.0                 # 0-1
    location_description: Optional[str] = None
    notes: Optional[str] = None

class CorrosionAnalysisOutput(BaseModel):
    """Output from corrosion detection analysis."""
    asset_id: Optional[UUID] = None
    analysis_type: AnalysisType = AnalysisType.CORROSION
    detections: List[CorrosionDetection] = []
    overall_severity: CorrosionSeverity = CorrosionSeverity.SURFACE
    overall_action: RecommendedAction = RecommendedAction.MONITOR
    requires_immediate_review: bool = False
    governance_tier: int = 2
    safety_disclaimer: str = (
        "AI corrosion assessment is advisory (Tier 2). "
        "Critical findings require immediate qualified inspector review."
    )


# ══════════════════════════════════════════════════════════════
#  2) THERMAL ANALYSIS
# ══════════════════════════════════════════════════════════════

class ThermalAnalysisInput(BaseModel):
    """Input for thermal/IR image analysis."""
    asset_id: Optional[UUID] = None
    image_data: Optional[str] = None
    image_url: Optional[str] = None
    photo_metadata: Optional[PhotoMetadata] = None
    ambient_temperature: Optional[float] = None
    equipment_type: Optional[str] = None    # "motor", "switchgear", etc.
    emissivity: float = 0.95

class ThermalAnomaly(BaseModel):
    """Single thermal anomaly detection."""
    anomaly_type: ThermalAnomalyType
    severity: ThermalSeverity
    temperature_measured: float             # °F
    temperature_reference: float            # °F (baseline/ambient)
    temperature_differential: float         # °F
    alarm_threshold: float                  # °F
    location_description: Optional[str] = None
    confidence: float = 0.0

class ThermalAnalysisOutput(BaseModel):
    """Output from thermal analysis."""
    asset_id: Optional[UUID] = None
    analysis_type: AnalysisType = AnalysisType.THERMAL
    anomalies: List[ThermalAnomaly] = []
    max_temperature: float = 0.0
    max_differential: float = 0.0
    overall_severity: ThermalSeverity = ThermalSeverity.NORMAL
    requires_immediate_review: bool = False
    governance_tier: int = 2
    safety_disclaimer: str = (
        "AI thermal assessment is advisory (Tier 2). "
        "Critical thermal findings require immediate review."
    )


# ══════════════════════════════════════════════════════════════
#  3) CONDITION ASSESSMENT
# ══════════════════════════════════════════════════════════════

class ConditionAnalysisInput(BaseModel):
    """Input for general condition assessment."""
    asset_id: Optional[UUID] = None
    image_data: Optional[str] = None
    image_url: Optional[str] = None
    photo_metadata: Optional[PhotoMetadata] = None
    equipment_type: Optional[str] = None

class ConditionFinding(BaseModel):
    """Single condition finding."""
    item: ConditionItem
    detected: bool = False
    severity: str = "normal"    # normal / minor / moderate / severe
    score: int = 5              # 1-5 (5 = best)
    description: Optional[str] = None
    confidence: float = 0.0

class ConditionAnalysisOutput(BaseModel):
    """Output from condition assessment."""
    asset_id: Optional[UUID] = None
    analysis_type: AnalysisType = AnalysisType.CONDITION
    findings: List[ConditionFinding] = []
    overall_condition_score: float = 5.0    # 1-5
    housekeeping_score: int = 5             # 1-5
    items_requiring_action: int = 0
    governance_tier: int = 2
    safety_disclaimer: str = (
        "AI condition assessment is advisory (Tier 2). "
        "All findings require qualified technician verification."
    )


# ══════════════════════════════════════════════════════════════
#  4) AUTO-TAGGING
# ══════════════════════════════════════════════════════════════

class TaggingInput(BaseModel):
    """Input for auto-tagging analysis."""
    image_data: Optional[str] = None
    image_url: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    nfc_data: Optional[str] = None

class TaggingOutput(BaseModel):
    """Output from auto-tagging."""
    asset_id: Optional[UUID] = None
    matched_asset_name: Optional[str] = None
    tagging_method: TaggingMethod = TaggingMethod.MANUAL
    confidence: float = 0.0
    barcode_value: Optional[str] = None
    gps_match_distance_m: Optional[float] = None
    kg_node_id: Optional[str] = None        # Knowledge Graph node
    governance_tier: int = 2


# ══════════════════════════════════════════════════════════════
#  5) DRONE INTEGRATION
# ══════════════════════════════════════════════════════════════

class DroneSurveyInput(BaseModel):
    """Input for drone survey processing."""
    survey_id: Optional[UUID] = None
    asset_id: Optional[UUID] = None
    images: List[Dict[str, Any]] = []       # List of image metadata
    flight_date: datetime = Field(default_factory=datetime.utcnow)
    pilot_name: Optional[str] = None
    area_description: Optional[str] = None

class DroneAnomaly(BaseModel):
    """Anomaly detected in drone survey."""
    anomaly_id: Optional[UUID] = None
    image_index: int = 0
    anomaly_type: str = ""                  # "corrosion", "crack", etc.
    severity: str = "low"
    location_description: Optional[str] = None
    confidence: float = 0.0
    requires_followup: bool = False

class DroneSurveyOutput(BaseModel):
    """Output from drone survey processing."""
    survey_id: UUID
    asset_id: Optional[UUID] = None
    status: DroneFlightStatus = DroneFlightStatus.ANALYZED
    total_images: int = 0
    images_analyzed: int = 0
    anomalies: List[DroneAnomaly] = []
    anomaly_count: int = 0
    composite_generated: bool = False
    coverage_percent: float = 0.0
    governance_tier: int = 2
    safety_disclaimer: str = (
        "Drone survey AI analysis is advisory (Tier 2). "
        "All flagged anomalies require ground-level inspection."
    )


# ══════════════════════════════════════════════════════════════
#  6) HISTORICAL COMPARISON
# ══════════════════════════════════════════════════════════════

class ComparisonInput(BaseModel):
    """Input for historical image comparison."""
    asset_id: Optional[UUID] = None
    baseline_image_data: Optional[str] = None
    baseline_image_url: Optional[str] = None
    baseline_date: Optional[datetime] = None
    current_image_data: Optional[str] = None
    current_image_url: Optional[str] = None
    current_date: Optional[datetime] = None

class DegradationMetric(BaseModel):
    """Quantified degradation between two images."""
    metric_name: str                        # "corrosion_area_change"
    baseline_value: float
    current_value: float
    change_absolute: float
    change_percent: float
    trend: str = "stable"                   # improving / stable / degrading
    rbi_calibration_factor: Optional[float] = None

class ComparisonOutput(BaseModel):
    """Output from historical comparison."""
    asset_id: Optional[UUID] = None
    analysis_type: AnalysisType = AnalysisType.COMPARISON
    baseline_date: Optional[datetime] = None
    current_date: Optional[datetime] = None
    elapsed_days: int = 0
    degradation_metrics: List[DegradationMetric] = []
    overall_trend: str = "stable"           # improving / stable / degrading
    degradation_rate_per_year: Optional[float] = None
    rbi_calibration_data: Optional[Dict[str, Any]] = None
    governance_tier: int = 2
    safety_disclaimer: str = (
        "AI image comparison is advisory (Tier 2). "
        "Degradation quantification requires engineering validation."
    )


# ══════════════════════════════════════════════════════════════
#  ANALYSIS REQUEST (unified)
# ══════════════════════════════════════════════════════════════

class VisionAnalysisRequest(BaseModel):
    """Unified analysis request for /vision/analyze."""
    analysis_type: AnalysisType
    asset_id: Optional[UUID] = None
    image_data: Optional[str] = None        # base64
    image_url: Optional[str] = None
    photo_metadata: Optional[PhotoMetadata] = None
    # Type-specific parameters
    equipment_material: Optional[str] = None
    environment: Optional[str] = None
    equipment_type: Optional[str] = None
    ambient_temperature: Optional[float] = None
    emissivity: float = 0.95


class AssetPhotoRecord(BaseModel):
    """Photo record in asset history."""
    photo_id: UUID
    asset_id: UUID
    captured_at: datetime
    analysis_type: AnalysisType
    analysis_summary: Optional[str] = None
    severity: Optional[str] = None
    thumbnail_url: Optional[str] = None


class AssetPhotoHistory(BaseModel):
    """Photo timeline for an asset."""
    asset_id: UUID
    total_photos: int = 0
    photos: List[AssetPhotoRecord] = []
    trend_summary: Optional[str] = None
