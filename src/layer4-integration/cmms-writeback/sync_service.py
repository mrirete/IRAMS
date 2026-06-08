"""CMMS Sync Service for bi-directional field mapping and write-back."""
import logging
from typing import Dict, Any, List

from layer4_integration.schemas import CMMSWritebackPayload, CMMSMapping

logger = logging.getLogger(__name__)

class CMMSSyncService:
    def __init__(self, mappings: List[CMMSMapping]):
        self.mappings = mappings
        self._mapping_dict = {m.internal_field: m for m in mappings}

    def _transform_payload(self, internal_data: Dict[str, Any]) -> Dict[str, Any]:
        cmms_payload = {}
        for internal_key, value in internal_data.items():
            if internal_key in self._mapping_dict:
                mapping = self._mapping_dict[internal_key]
                # In real scenario: apply mapping.transform_logic if present
                cmms_payload[mapping.cmms_field] = value
            else:
                # pass through or ignore
                logger.debug(f"Unmapped field {internal_key} ignored.")
        return cmms_payload

    def sync_to_cmms(self, payload: CMMSWritebackPayload) -> bool:
        """
        Sync approved changes back to SAP/Maximo.
        Requires Human-in-the-Loop Tier 3 governance signature inside the payload.
        """
        logger.info(f"Initiating Tier 3 write-back for WO: {payload.work_order_id} by {payload.tier_3_approved_by}")
        
        target_payload = self._transform_payload(payload.payload_data)
        
        if payload.target_system.upper() == "SAP":
            # Call SAP OData or BAPI client
            logger.info(f"Syncing to SAP with mapped payload: {target_payload}")
            return True
        elif payload.target_system.upper() == "MAXIMO":
            # Call Maximo JSON/REST API client
            logger.info(f"Syncing to Maximo with mapped payload: {target_payload}")
            return True
        else:
            logger.error(f"Unknown target system: {payload.target_system}")
            return False
