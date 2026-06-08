"""
Fitness-for-Service Engine — API 579 Part 4/5/6
════════════════════════════════════════════════
Level 1: Screening assessment (general / local / pitting metal loss)
Level 2: CTP-based detailed assessment
Level 3: Workflow management only (FEA package tracking)

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
import math
from typing import List, Dict, Any, Optional

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    FFSLevel1Input, FFSLevel1Output,
    FFSLevel2Input, FFSLevel2Output,
    FFSPart, FFSStatus
)


class FFSEngine:
    """
    API 579-1/ASME FFS-1 Fitness-for-Service engine.

    Level 1 (Parts 4, 5, 6):
      1. Calculate t_min per ASME VIII Div 1
      2. Calculate t_am (average) and t_mm (minimum) from readings
      3. Acceptance checks per API 579
      4. Calculate RSF and remaining life

    Level 2:
      CTP-based RSF from detailed thickness grids.

    Level 3:
      Workflow tracking only.
    """

    RSF_ALLOWABLE = 0.9  # per API 579-1 Table 4.4

    # ─── Level 1 ──────────────────────────────────────────────

    def assess_level_1(self, inp: FFSLevel1Input) -> FFSLevel1Output:
        """Run API 579 Level 1 assessment."""

        # 1) t_min per ASME VIII Div 1 (cylindrical shell)
        t_min = self._calc_t_min(
            pressure=inp.design_pressure,
            radius=inp.inside_diameter / 2.0 if inp.inside_diameter > 0 else 0.0,
            allowable_stress=inp.allowable_stress,
            efficiency=inp.weld_joint_efficiency,
        )

        # 2) t_am and t_mm from readings
        readings = inp.thickness_readings
        if not readings:
            return self._empty_result(inp, t_min, "No thickness readings provided.")

        t_am = sum(readings) / len(readings)
        t_mm = min(readings)
        t_nom = inp.nominal_thickness
        fca = inp.future_corrosion_allowance

        # 3) Apply Part-specific logic
        if inp.api_579_part == FFSPart.PART_5:
            return self._level_1_local(inp, t_min, t_am, t_mm, t_nom, fca)
        elif inp.api_579_part == FFSPart.PART_6:
            return self._level_1_pitting(inp, t_min, t_am, t_mm, t_nom, fca)
        else:
            return self._level_1_general(inp, t_min, t_am, t_mm, t_nom, fca)

    def _level_1_general(
        self, inp: FFSLevel1Input,
        t_min: float, t_am: float, t_mm: float,
        t_nom: float, fca: float
    ) -> FFSLevel1Output:
        """Part 4 — General Metal Loss."""

        # Check 1: t_am >= FCA + t_min
        avg_check = t_am >= (fca + t_min)

        # Check 2: t_mm >= max(0.5 * t_nom, FCA + t_min - 0.05)
        min_threshold = max(0.5 * t_nom, fca + t_min - 0.05)
        min_check = t_mm >= min_threshold

        overall = avg_check and min_check

        # RSF
        rsf = t_am / t_min if t_min > 0 else 999.0

        # Remaining life
        remaining_life = self._calc_remaining_life(t_am, t_min, fca, inp.corrosion_rate)

        # MAWP derated
        mawp = self._calc_mawp_derated(
            t_am - fca, inp.allowable_stress,
            inp.inside_diameter / 2.0 if inp.inside_diameter > 0 else 0.0,
            inp.weld_joint_efficiency
        )

        # Status and recommendation
        status, action = self._determine_status(overall, rsf, remaining_life)

        return FFSLevel1Output(
            equipment_id=inp.equipment_id,
            api_579_part=inp.api_579_part,
            t_min=round(t_min, 4),
            t_am=round(t_am, 4),
            t_mm=round(t_mm, 4),
            t_nom=t_nom,
            average_check_pass=avg_check,
            minimum_check_pass=min_check,
            overall_pass=overall,
            rsf=round(rsf, 3),
            remaining_life_years=round(remaining_life, 2),
            mawp_derated=round(mawp, 1) if mawp else None,
            status=status,
            recommended_action=action,
        )

    def _level_1_local(
        self, inp: FFSLevel1Input,
        t_min: float, t_am: float, t_mm: float,
        t_nom: float, fca: float
    ) -> FFSLevel1Output:
        """Part 5 — Local Metal Loss (simplified Level 1)."""

        # For local metal loss, t_mm is the critical measurement
        # Acceptance: t_mm - FCA >= RSF_allowable * t_min
        t_mm_future = t_mm - fca
        avg_check = t_am >= (fca + t_min)
        local_rsf = t_mm_future / t_min if t_min > 0 else 999.0
        min_check = local_rsf >= self.RSF_ALLOWABLE

        overall = avg_check and min_check
        rsf = local_rsf

        remaining_life = self._calc_remaining_life(t_mm, t_min, fca, inp.corrosion_rate)
        mawp = self._calc_mawp_derated(
            t_mm - fca, inp.allowable_stress,
            inp.inside_diameter / 2.0 if inp.inside_diameter > 0 else 0.0,
            inp.weld_joint_efficiency
        )

        status, action = self._determine_status(overall, rsf, remaining_life)

        return FFSLevel1Output(
            equipment_id=inp.equipment_id,
            api_579_part=inp.api_579_part,
            t_min=round(t_min, 4),
            t_am=round(t_am, 4),
            t_mm=round(t_mm, 4),
            t_nom=t_nom,
            average_check_pass=avg_check,
            minimum_check_pass=min_check,
            overall_pass=overall,
            rsf=round(rsf, 3),
            remaining_life_years=round(remaining_life, 2),
            mawp_derated=round(mawp, 1) if mawp else None,
            status=status,
            recommended_action=action,
        )

    def _level_1_pitting(
        self, inp: FFSLevel1Input,
        t_min: float, t_am: float, t_mm: float,
        t_nom: float, fca: float
    ) -> FFSLevel1Output:
        """Part 6 — Pitting Damage (simplified Level 1)."""

        # For pitting, check remaining wall after accounting for pit depth
        # Uniform pit depth assumption: t_mm represents deepest pit
        pit_depth = t_nom - t_mm
        remaining_wall = t_nom - pit_depth - fca

        avg_check = t_am >= (fca + t_min)

        # RSF for pitting uses a corrected remaining wall
        rsf = remaining_wall / t_min if t_min > 0 else 999.0
        min_check = rsf >= self.RSF_ALLOWABLE

        overall = avg_check and min_check

        remaining_life = self._calc_remaining_life(t_mm, t_min, fca, inp.corrosion_rate)

        status, action = self._determine_status(overall, rsf, remaining_life)

        return FFSLevel1Output(
            equipment_id=inp.equipment_id,
            api_579_part=inp.api_579_part,
            t_min=round(t_min, 4),
            t_am=round(t_am, 4),
            t_mm=round(t_mm, 4),
            t_nom=t_nom,
            average_check_pass=avg_check,
            minimum_check_pass=min_check,
            overall_pass=overall,
            rsf=round(rsf, 3),
            remaining_life_years=round(remaining_life, 2),
            mawp_derated=None,
            status=status,
            recommended_action=action,
        )

    # ─── Level 2 ──────────────────────────────────────────────

    def assess_level_2(self, inp: FFSLevel2Input) -> FFSLevel2Output:
        """
        Run API 579 Level 2 CTP-based assessment.

        Analyzes thickness grids to find critical thickness profiles
        in both circumferential and longitudinal directions.
        """
        t_min = self._calc_t_min(
            pressure=inp.design_pressure,
            radius=inp.inside_diameter / 2.0 if inp.inside_diameter > 0 else 0.0,
            allowable_stress=inp.allowable_stress,
            efficiency=inp.weld_joint_efficiency,
        )

        grid = inp.thickness_grid
        if not grid or not grid[0]:
            return FFSLevel2Output(
                equipment_id=inp.equipment_id,
                api_579_part=inp.api_579_part,
                t_min=round(t_min, 4),
                critical_thickness_profiles=[],
                rsf_circ=1.0,
                rsf_long=1.0,
                rsf_overall=1.0,
                overall_pass=True,
                remaining_life_years=999.0,
                status=FFSStatus.PASSED,
                recommended_action="No grid data provided.",
            )

        fca = inp.future_corrosion_allowance
        n_rows = len(grid)
        n_cols = len(grid[0]) if grid else 0

        # ── Circumferential profiles (along each row) ──
        circ_profiles = []
        circ_rsfs = []
        for i, row in enumerate(grid):
            avg_t = sum(row) / len(row) if row else 0
            min_t = min(row) if row else 0
            rsf = (avg_t - fca) / t_min if t_min > 0 else 999.0
            circ_rsfs.append(rsf)
            circ_profiles.append({
                "direction": "circumferential",
                "profile_index": i,
                "avg_thickness": round(avg_t, 4),
                "min_thickness": round(min_t, 4),
                "rsf": round(rsf, 3),
                "pass": rsf >= self.RSF_ALLOWABLE,
            })

        # ── Longitudinal profiles (along each column) ──
        long_profiles = []
        long_rsfs = []
        for j in range(n_cols):
            col_vals = [grid[i][j] for i in range(n_rows) if j < len(grid[i])]
            if not col_vals:
                continue
            avg_t = sum(col_vals) / len(col_vals)
            min_t = min(col_vals)
            rsf = (avg_t - fca) / t_min if t_min > 0 else 999.0
            long_rsfs.append(rsf)
            long_profiles.append({
                "direction": "longitudinal",
                "profile_index": j,
                "avg_thickness": round(avg_t, 4),
                "min_thickness": round(min_t, 4),
                "rsf": round(rsf, 3),
                "pass": rsf >= self.RSF_ALLOWABLE,
            })

        rsf_circ = min(circ_rsfs) if circ_rsfs else 1.0
        rsf_long = min(long_rsfs) if long_rsfs else 1.0
        rsf_overall = min(rsf_circ, rsf_long)
        overall_pass = rsf_overall >= self.RSF_ALLOWABLE

        # Remaining life from worst average thickness
        all_avgs = [p["avg_thickness"] for p in circ_profiles + long_profiles]
        worst_avg = min(all_avgs) if all_avgs else inp.nominal_thickness
        remaining_life = self._calc_remaining_life(
            worst_avg, t_min, fca, inp.corrosion_rate
        )

        status, action = self._determine_status(overall_pass, rsf_overall, remaining_life)

        return FFSLevel2Output(
            equipment_id=inp.equipment_id,
            api_579_part=inp.api_579_part,
            t_min=round(t_min, 4),
            critical_thickness_profiles=circ_profiles + long_profiles,
            rsf_circ=round(rsf_circ, 3),
            rsf_long=round(rsf_long, 3),
            rsf_overall=round(rsf_overall, 3),
            overall_pass=overall_pass,
            remaining_life_years=round(remaining_life, 2),
            status=status,
            recommended_action=action,
        )

    # ─── Helper Methods ───────────────────────────────────────

    @staticmethod
    def _calc_t_min(
        pressure: float, radius: float,
        allowable_stress: float, efficiency: float
    ) -> float:
        """
        Minimum required thickness per ASME VIII Div 1 UG-27.

        t_min = (P * R) / (S * E - 0.6 * P)

        Where:
          P = design pressure (psig)
          R = inside radius (inches)
          S = allowable stress (psi)
          E = weld joint efficiency
        """
        if radius <= 0 or allowable_stress <= 0:
            # Fallback for piping or missing data
            return 0.0

        denominator = (allowable_stress * efficiency) - (0.6 * pressure)
        if denominator <= 0:
            return 999.0  # design is invalid

        return (pressure * radius) / denominator

    @staticmethod
    def _calc_remaining_life(
        current_t: float, t_min: float, fca: float, rate: float
    ) -> float:
        """Calculate remaining life in years."""
        if rate <= 0:
            return 999.0
        usable = current_t - fca - t_min
        if usable <= 0:
            return 0.0
        return usable / rate

    @staticmethod
    def _calc_mawp_derated(
        effective_t: float, allowable_stress: float,
        radius: float, efficiency: float
    ) -> Optional[float]:
        """Calculate derated MAWP from effective thickness."""
        if radius <= 0 or effective_t <= 0:
            return None
        return (allowable_stress * efficiency * effective_t) / (radius + 0.6 * effective_t)

    @staticmethod
    def _determine_status(
        overall_pass: bool, rsf: float, remaining_life: float
    ) -> tuple:
        """Determine FFS status and recommended action."""
        if overall_pass and remaining_life > 5:
            return FFSStatus.PASSED, "Equipment acceptable for continued service."
        elif overall_pass and remaining_life > 2:
            return (
                FFSStatus.MONITORING,
                f"Acceptable, but remaining life is {remaining_life:.1f} years. "
                f"Increase monitoring frequency."
            )
        elif overall_pass:
            return (
                FFSStatus.MONITORING,
                f"Marginally acceptable. Remaining life {remaining_life:.1f} years. "
                f"Plan for repair/replacement."
            )
        elif rsf >= 0.8:
            return (
                FFSStatus.REMEDIATION_REQUIRED,
                "Level 1 failed but RSF is close to allowable. "
                "Consider Level 2/3 assessment or remediation."
            )
        else:
            return (
                FFSStatus.FAILED,
                "Level 1 FAILED. Equipment requires immediate engineering "
                "review, repair, re-rate, or retirement."
            )

    def _empty_result(
        self, inp: FFSLevel1Input, t_min: float, message: str
    ) -> FFSLevel1Output:
        """Return empty result when data is missing."""
        return FFSLevel1Output(
            equipment_id=inp.equipment_id,
            api_579_part=inp.api_579_part,
            t_min=round(t_min, 4),
            t_am=0.0,
            t_mm=0.0,
            t_nom=inp.nominal_thickness,
            average_check_pass=False,
            minimum_check_pass=False,
            overall_pass=False,
            rsf=0.0,
            remaining_life_years=0.0,
            status=FFSStatus.FAILED,
            recommended_action=message,
        )
