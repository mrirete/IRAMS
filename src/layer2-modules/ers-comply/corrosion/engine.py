"""
Corrosion Rate Calculator
═════════════════════════
Short-term and long-term corrosion rate calculation with
acceleration detection and UT measurement uncertainty.

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime
from typing import List, Optional

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    CorrosionRateInput, CorrosionRateOutput, CorrosionRateType,
    ThicknessReadingCreate
)


class CorrosionRateEngine:
    """
    Corrosion rate calculator.

    Short-term: (prev_reading - current_reading) / time_between
    Long-term: (original_thickness - current_reading) / service_years
    Flag when short_term > 2× long_term (accelerating mechanism).
    Handle measurement uncertainty (±0.005 inch for UT).
    """

    def calculate_rates(self, inp: CorrosionRateInput) -> CorrosionRateOutput:
        """Calculate short-term and long-term corrosion rates."""
        warnings: List[str] = []

        # Sort readings by date (oldest first)
        sorted_readings = sorted(inp.readings, key=lambda r: r.reading_date)

        if len(sorted_readings) < 1:
            return CorrosionRateOutput(
                cml_id=inp.cml_id,
                short_term_rate=0.0,
                long_term_rate=0.0,
                max_observed_rate=0.0,
                remaining_life_years=999.0,
                acceleration_flag=False,
                acceleration_ratio=0.0,
                measurement_uncertainty=inp.ut_uncertainty,
                rate_type=CorrosionRateType.GENERAL,
                warnings=["Insufficient readings to calculate corrosion rate."],
            )

        latest = sorted_readings[-1]

        # ── Short-term rate ──
        short_term = 0.0
        if len(sorted_readings) >= 2:
            prev = sorted_readings[-2]
            dt_years = self._years_between(prev.reading_date, latest.reading_date)
            if dt_years > 0:
                thickness_loss = prev.measured_thickness - latest.measured_thickness
                short_term = max(0.0, thickness_loss / dt_years)
            else:
                warnings.append("Last two readings have same date — short-term rate = 0.")
        else:
            warnings.append("Only one reading available — short-term rate defaults to 0.")

        # ── Long-term rate ──
        long_term = 0.0
        if inp.installation_date:
            service_years = self._years_between(
                inp.installation_date, latest.reading_date
            )
            if service_years > 0:
                thickness_loss = inp.nominal_thickness - latest.measured_thickness
                long_term = max(0.0, thickness_loss / service_years)
            else:
                warnings.append("Service time is zero or negative — long-term rate = 0.")
        elif len(sorted_readings) >= 2:
            # Fallback: use earliest reading as baseline
            earliest = sorted_readings[0]
            dt_years = self._years_between(
                earliest.reading_date, latest.reading_date
            )
            if dt_years > 0:
                thickness_loss = earliest.measured_thickness - latest.measured_thickness
                long_term = max(0.0, thickness_loss / dt_years)
            warnings.append(
                "No installation date — long-term rate calculated from earliest reading."
            )
        else:
            warnings.append("Cannot determine long-term rate with single reading and no install date.")

        # ── Conservative rate (max of short/long) ──
        max_rate = max(short_term, long_term)

        # ── Remaining life ──
        if max_rate > 0:
            # Use a conservative retirement thickness (assume 0 if not captured)
            remaining_life = max(
                0.0, latest.measured_thickness / max_rate
            )
        else:
            remaining_life = 999.0

        # ── Acceleration flag ──
        acceleration_flag = False
        acceleration_ratio = 0.0
        if long_term > 0:
            acceleration_ratio = short_term / long_term
            if short_term > 2.0 * long_term:
                acceleration_flag = True
                warnings.append(
                    f"ACCELERATING CORROSION: Short-term rate ({short_term:.4f} in/yr) "
                    f"is {acceleration_ratio:.1f}× the long-term rate ({long_term:.4f} in/yr). "
                    f"Investigate for active damage mechanism."
                )

        # ── Measurement uncertainty check ──
        if len(sorted_readings) >= 2:
            prev = sorted_readings[-2]
            thickness_diff = abs(
                prev.measured_thickness - latest.measured_thickness
            )
            if thickness_diff < 2 * inp.ut_uncertainty:
                warnings.append(
                    f"Thickness change ({thickness_diff:.4f} in) is within "
                    f"2× measurement uncertainty (±{inp.ut_uncertainty:.4f} in). "
                    f"Rate may not be statistically significant."
                )

        # ── Classify rate type ──
        rate_type = CorrosionRateType.GENERAL
        # Heuristic: if short-term is very high relative to area, it's localized
        if short_term > 0.020:  # >20 mpy is aggressive
            rate_type = CorrosionRateType.LOCALIZED
        if acceleration_flag:
            rate_type = CorrosionRateType.LOCALIZED

        return CorrosionRateOutput(
            cml_id=inp.cml_id,
            short_term_rate=round(short_term, 6),
            long_term_rate=round(long_term, 6),
            max_observed_rate=round(max_rate, 6),
            remaining_life_years=round(remaining_life, 2),
            acceleration_flag=acceleration_flag,
            acceleration_ratio=round(acceleration_ratio, 2),
            measurement_uncertainty=inp.ut_uncertainty,
            rate_type=rate_type,
            warnings=warnings,
        )

    @staticmethod
    def _years_between(d1: datetime, d2: datetime) -> float:
        """Calculate fractional years between two datetimes."""
        delta = d2 - d1
        return delta.total_seconds() / (365.25 * 24 * 3600)
