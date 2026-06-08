"""
Auto-Tagging Engine
═══════════════════
Links inspection photos to asset IDs via barcode/QR/NFC/GPS.
Attaches to asset record + Knowledge Graph.

ALL outputs are Tier 2 (advisory).
"""
import math
from typing import Any, Optional, Dict, List
from uuid import UUID, uuid4

from ers_vision.schemas import (
    TaggingInput, TaggingOutput, TaggingMethod,
)


class AutoTaggingEngine:
    """
    Auto-tags photos to equipment records using
    barcode, QR code, NFC, or GPS proximity matching.
    """

    def __init__(self):
        # In-memory asset registry for GPS matching (production → DB)
        self._asset_locations: Dict[UUID, Dict[str, Any]] = {}

    def register_asset_location(
        self, asset_id: UUID, name: str, lat: float, lon: float, **kwargs
    ) -> None:
        """Register an asset's GPS location for proximity matching."""
        self._asset_locations[asset_id] = {
            "name": name, "lat": lat, "lon": lon, **kwargs,
        }

    def tag(
        self,
        inp: TaggingInput,
        asset_registry: Optional[Dict[str, UUID]] = None,
    ) -> TaggingOutput:
        """
        Auto-tag a photo to an asset.

        Tries barcode/QR → NFC → GPS in priority order.
        """
        # 1) Barcode / QR code
        if inp.image_data:
            barcode_result = self._detect_barcode(inp.image_data, asset_registry)
            if barcode_result:
                return barcode_result

        # 2) NFC data
        if inp.nfc_data:
            nfc_result = self._match_nfc(inp.nfc_data, asset_registry)
            if nfc_result:
                return nfc_result

        # 3) GPS proximity
        if inp.gps_lat is not None and inp.gps_lon is not None:
            gps_result = self._match_gps(inp.gps_lat, inp.gps_lon)
            if gps_result:
                return gps_result

        # No match
        return TaggingOutput(
            tagging_method=TaggingMethod.MANUAL,
            confidence=0.0,
        )

    def _detect_barcode(
        self, image_data: str, registry: Optional[Dict[str, UUID]]
    ) -> Optional[TaggingOutput]:
        """
        Detect barcode/QR in image data.
        In production, uses computer vision. Deterministic: checks if
        image_data contains an asset tag pattern.
        """
        if not registry:
            return None

        # Simplified: check if image_data encodes a known tag
        for tag, asset_id in registry.items():
            if tag in image_data:
                return TaggingOutput(
                    asset_id=asset_id,
                    matched_asset_name=tag,
                    tagging_method=TaggingMethod.BARCODE,
                    confidence=0.95,
                    barcode_value=tag,
                )
        return None

    def _match_nfc(
        self, nfc_data: str, registry: Optional[Dict[str, UUID]]
    ) -> Optional[TaggingOutput]:
        """Match NFC data to asset registry."""
        if registry and nfc_data in registry:
            return TaggingOutput(
                asset_id=registry[nfc_data],
                matched_asset_name=nfc_data,
                tagging_method=TaggingMethod.NFC,
                confidence=0.98,
            )
        return None

    def _match_gps(
        self, lat: float, lon: float, max_distance_m: float = 50.0
    ) -> Optional[TaggingOutput]:
        """Match GPS coordinates to nearest registered asset."""
        best_match = None
        best_distance = float("inf")

        for asset_id, loc in self._asset_locations.items():
            dist = self._haversine(lat, lon, loc["lat"], loc["lon"])
            if dist < best_distance and dist <= max_distance_m:
                best_distance = dist
                best_match = (asset_id, loc["name"])

        if best_match:
            # Confidence decreases with distance
            confidence = max(0.5, 1.0 - (best_distance / max_distance_m) * 0.5)
            return TaggingOutput(
                asset_id=best_match[0],
                matched_asset_name=best_match[1],
                tagging_method=TaggingMethod.GPS,
                confidence=round(confidence, 2),
                gps_match_distance_m=round(best_distance, 1),
            )
        return None

    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Haversine distance in meters."""
        R = 6371000  # Earth radius in meters
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = (
            math.sin(dphi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        )
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
