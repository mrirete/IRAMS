"""
Inspection Interval Calculator — API 510 / API 570 / API 653
═════════════════════════════════════════════════════════════
Deterministic interval calculation per code rules.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime, timedelta
from typing import List, Optional

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    InspectionIntervalInput, InspectionIntervalOutput, GoverningCode
)

# ── Code Maximum Intervals (years) ────────────────────────────
# Source: API 510 §6, API 570 §6, API 653 §6

CODE_MAX_INTERVALS = {
    GoverningCode.API_510: {
        "internal": 10.0,
        "external": 5.0,
        "on_stream": 10.0,
    },
    GoverningCode.API_570: {
        "internal": 10.0,   # full inspection
        "external": 5.0,
        "thickness": 5.0,   # thickness monitoring
    },
    GoverningCode.API_653: {
        "internal": 10.0,
        "external": 5.0,    # monthly visual + 5yr detailed
        "floor": 10.0,
    },
    GoverningCode.ASME_B31_3: {
        "internal": 10.0,
        "external": 5.0,
    },
}


class InspectionIntervalEngine:
    """
    Deterministic inspection interval calculator per API 510/570/653.

    Logic:
      remaining_life = (t_current - t_retirement) / corrosion_rate
      next_inspection = last_inspection + min(code_max, remaining_life / 2)

    Special cases:
      - New equipment with no readings → use code max interval
      - Equipment on RBI-extended intervals → still capped at code max
      - Zero corrosion rate → use code max interval
    """

    def calculate_interval(
        self, inp: InspectionIntervalInput
    ) -> InspectionIntervalOutput:
        """Calculate next inspection interval."""
        warnings: List[str] = []

        # 1) Select conservative corrosion rate (max of short/long)
        cr_short = max(0.0, inp.corrosion_rate_short)
        cr_long = max(0.0, inp.corrosion_rate_long)
        cr_used = max(cr_short, cr_long)

        # 2) Code maximum interval
        code_intervals = CODE_MAX_INTERVALS.get(
            inp.governing_code,
            {"internal": 10.0, "external": 5.0}
        )
        code_max = code_intervals.get("internal", 10.0)

        # 3) Handle new equipment (no readings or is_new_equipment flag)
        if inp.is_new_equipment or cr_used <= 0.0:
            if inp.is_new_equipment:
                warnings.append(
                    "New equipment — no corrosion history. Using code maximum interval."
                )
            elif cr_used <= 0.0:
                warnings.append(
                    "Corrosion rate is zero or negative. Using code maximum interval."
                )

            next_due = None
            if inp.last_inspection_date:
                next_due = inp.last_inspection_date + timedelta(
                    days=code_max * 365.25
                )

            return InspectionIntervalOutput(
                equipment_id=inp.equipment_id,
                governing_code=inp.governing_code,
                corrosion_rate_used=0.0,
                remaining_life_years=999.0,  # effectively infinite
                code_max_interval_years=code_max,
                calculated_interval_years=code_max,
                next_inspection_due=next_due,
                warnings=warnings,
            )

        # 4) Calculate remaining life
        thickness_margin = inp.current_thickness - inp.retirement_thickness
        if thickness_margin <= 0:
            warnings.append(
                "CRITICAL: Current thickness is at or below retirement thickness!"
            )
            remaining_life = 0.0
        else:
            remaining_life = thickness_margin / cr_used

        # 5) Calculate interval: min(code_max, remaining_life / 2)
        half_life = remaining_life / 2.0
        calculated_interval = min(code_max, half_life)

        # 6) Handle RBI-extended intervals
        if inp.rbi_extended and inp.rbi_extended_interval_years:
            rbi_interval = inp.rbi_extended_interval_years
            # RBI can extend but never exceed code max
            if rbi_interval > code_max:
                warnings.append(
                    f"RBI interval ({rbi_interval:.1f} yr) exceeds code max "
                    f"({code_max:.1f} yr). Capped at code max."
                )
                rbi_interval = code_max
            # RBI interval should not exceed remaining life / 2
            if rbi_interval > half_life:
                warnings.append(
                    f"RBI interval ({rbi_interval:.1f} yr) exceeds half "
                    f"remaining life ({half_life:.1f} yr). Using half-life."
                )
                calculated_interval = half_life
            else:
                calculated_interval = rbi_interval

        # 7) Additional warnings
        if remaining_life < 2.0:
            warnings.append(
                f"WARNING: Remaining life is less than 2 years ({remaining_life:.2f} yr). "
                f"Immediate engineering review required."
            )
        if cr_short > 2.0 * cr_long and cr_long > 0:
            warnings.append(
                f"Accelerating corrosion detected: short-term rate "
                f"({cr_short:.4f} in/yr) > 2× long-term ({cr_long:.4f} in/yr)."
            )

        # 8) Calculate next due date
        next_due = None
        if inp.last_inspection_date:
            next_due = inp.last_inspection_date + timedelta(
                days=calculated_interval * 365.25
            )

        # 9) Ensure interval is non-negative
        calculated_interval = max(0.0, calculated_interval)

        return InspectionIntervalOutput(
            equipment_id=inp.equipment_id,
            governing_code=inp.governing_code,
            corrosion_rate_used=cr_used,
            remaining_life_years=remaining_life,
            code_max_interval_years=code_max,
            calculated_interval_years=calculated_interval,
            next_inspection_due=next_due,
            warnings=warnings,
        )
