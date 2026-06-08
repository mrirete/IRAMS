"""
Integrity Operating Window (IOW) Monitor
═════════════════════════════════════════
Compare process values against IOW limits, detect breaches,
track cumulative exceedance duration.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime
from typing import List, Dict, Optional
from uuid import UUID

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    IOWCheckInput, IOWCheckOutput, IOWRead, IOWType,
    IOWExceedanceRead
)


class IOWMonitorEngine:
    """
    Integrity Operating Window monitor.

    - Compare real-time values against IOW limits
    - Critical IOW breach → immediate alert event
    - Standard IOW breach → log + schedule action
    - Track cumulative exceedance duration per IOW
    """

    def __init__(self):
        # In-memory exceedance tracking: {iow_id: cumulative_minutes}
        self._cumulative_exceedances: Dict[UUID, float] = {}
        # Active breaches (currently open): {iow_id: start_time}
        self._active_breaches: Dict[UUID, datetime] = {}

    def check_value(
        self,
        inp: IOWCheckInput,
        iow: IOWRead,
    ) -> IOWCheckOutput:
        """Check a single value against an IOW's limits."""

        in_range = True
        deviation = 0.0
        breach_type = None
        action_required = "none"

        # Check low limit
        if iow.low_limit is not None and inp.current_value < iow.low_limit:
            in_range = False
            deviation = iow.low_limit - inp.current_value
            breach_type = "low"

        # Check high limit
        if iow.high_limit is not None and inp.current_value > iow.high_limit:
            in_range = False
            deviation = inp.current_value - iow.high_limit
            breach_type = "high"

        # Update cumulative exceedance tracking
        cumulative = self._cumulative_exceedances.get(inp.iow_id, 0.0)

        if not in_range:
            # Start tracking if new breach
            if inp.iow_id not in self._active_breaches:
                self._active_breaches[inp.iow_id] = inp.timestamp

            # Determine action based on IOW type
            if iow.iow_type == IOWType.CRITICAL:
                action_required = "immediate_alert"
            elif iow.iow_type == IOWType.STANDARD:
                action_required = "log_and_schedule"
            else:
                action_required = "log_only"
        else:
            # If was breaching and now back in range, calculate duration
            if inp.iow_id in self._active_breaches:
                start = self._active_breaches.pop(inp.iow_id)
                duration_min = (inp.timestamp - start).total_seconds() / 60.0
                cumulative += duration_min
                self._cumulative_exceedances[inp.iow_id] = cumulative

        return IOWCheckOutput(
            iow_id=inp.iow_id,
            parameter_name=iow.parameter_name,
            iow_type=iow.iow_type,
            current_value=inp.current_value,
            low_limit=iow.low_limit,
            high_limit=iow.high_limit,
            in_range=in_range,
            deviation=round(deviation, 4),
            breach_type=breach_type,
            action_required=action_required,
            cumulative_exceedance_min=round(cumulative, 2),
        )

    def check_batch(
        self,
        checks: List[IOWCheckInput],
        iow_map: Dict[UUID, IOWRead],
    ) -> List[IOWCheckOutput]:
        """Check multiple values against their IOWs."""
        results = []
        for check in checks:
            iow = iow_map.get(check.iow_id)
            if iow:
                results.append(self.check_value(check, iow))
        return results

    def get_cumulative_exceedance(self, iow_id: UUID) -> float:
        """Get cumulative exceedance time in minutes for an IOW."""
        return self._cumulative_exceedances.get(iow_id, 0.0)

    def get_active_breaches(self) -> Dict[UUID, datetime]:
        """Get currently active (open) breaches."""
        return dict(self._active_breaches)

    def reset_tracking(self) -> None:
        """Reset all in-memory tracking state."""
        self._cumulative_exceedances.clear()
        self._active_breaches.clear()
