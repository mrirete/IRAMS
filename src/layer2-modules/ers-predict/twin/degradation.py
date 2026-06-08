"""
ERS Predict — Degradation Models
════════════════════════════════
Physics-informed degradation curves per failure mechanism:
  - Fatigue accumulation (Miner's rule)
  - Corrosion rate (linear / power law)
  - Bearing wear (ISO 281 L10 life)
  - Insulation degradation (Arrhenius model)
  - Erosion (velocity-dependent)
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

from ..schemas import DegradationMechanism, DegradationModelConfig


class DegradationModelEngine:
    """
    Computes cumulative damage / remaining life for each
    physics-informed degradation mechanism.

    Each model accepts OEM baseline parameters and calibrates
    against actual operating data.
    """

    def compute(
        self,
        mechanism: DegradationMechanism,
        parameters: Dict[str, float],
        operating_data: Dict[str, float],
    ) -> DegradationModelConfig:
        """
        Compute degradation state for a given mechanism.

        Args:
            mechanism: The degradation mechanism type.
            parameters: Model-specific parameters.
            operating_data: Current operating conditions.

        Returns:
            DegradationModelConfig with current damage percentage.
        """
        dispatch = {
            DegradationMechanism.FATIGUE_ACCUMULATION: self._fatigue_miners_rule,
            DegradationMechanism.CORROSION_RATE: self._corrosion,
            DegradationMechanism.BEARING_WEAR: self._bearing_l10,
            DegradationMechanism.INSULATION_DEGRADATION: self._insulation_arrhenius,
            DegradationMechanism.EROSION: self._erosion,
        }

        compute_fn = dispatch.get(mechanism, self._default)
        damage_pct, model_type = compute_fn(parameters, operating_data)

        return DegradationModelConfig(
            mechanism=mechanism,
            model_type=model_type,
            parameters=parameters,
            current_damage_pct=round(min(damage_pct, 100.0), 4),
        )

    # ── Miner's Rule (Fatigue) ──

    @staticmethod
    def _fatigue_miners_rule(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """
        Miner's linear damage accumulation rule.

        D = Σ(n_i / N_i)
        Where:
            n_i = actual cycles at stress level i
            N_i = fatigue life at stress level i (from S-N curve)

        Failure when D ≥ 1.0
        """
        # Parameters: SN_curve_exponent, design_cycles, actual_cycles,
        #             stress_ratio (actual/rated)
        design_cycles = params.get("design_cycles", 1e7)
        actual_cycles = operating.get("actual_cycles", 0)
        stress_ratio = operating.get("stress_ratio", 1.0)
        sn_exponent = params.get("sn_exponent", 3.0)

        # Adjusted cycles at actual stress
        if stress_ratio > 1.0:
            equivalent_cycles = actual_cycles * (stress_ratio ** sn_exponent)
        else:
            equivalent_cycles = actual_cycles

        damage_ratio = equivalent_cycles / max(design_cycles, 1.0)
        damage_pct = damage_ratio * 100.0

        return damage_pct, "miners_rule"

    # ── Corrosion ──

    @staticmethod
    def _corrosion(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """
        Corrosion degradation — linear or power law.

        Linear: loss = rate × time
        Power law: loss = A × t^n

        Failure when remaining_thickness < min_required_thickness
        """
        model = params.get("corrosion_model", 0)  # 0=linear, 1=power_law
        rate = params.get("corrosion_rate_mmpy", 0.1)  # mm/year
        initial_thickness = params.get("initial_thickness_mm", 10.0)
        min_thickness = params.get("min_thickness_mm", 3.0)
        years_in_service = operating.get("years_in_service", 0)
        power_exponent = params.get("power_exponent", 1.0)

        if model == 0:
            # Linear
            wall_loss = rate * years_in_service
        else:
            # Power law
            wall_loss = rate * (years_in_service ** power_exponent)

        remaining = max(initial_thickness - wall_loss, 0.0)
        usable_range = initial_thickness - min_thickness

        if usable_range <= 0:
            damage_pct = 100.0
        else:
            damage_pct = ((initial_thickness - remaining) / usable_range) * 100.0

        model_name = "linear" if model == 0 else "power_law"
        return min(damage_pct, 100.0), model_name

    # ── Bearing Wear (ISO 281 L10) ──

    @staticmethod
    def _bearing_l10(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """
        ISO 281 L10 bearing life calculation.

        L10 = (C/P)^p × 10^6 / (60 × n)  [hours]
        Where:
            C = dynamic load capacity (kN)
            P = equivalent dynamic load (kN)
            p = 3 for ball bearings, 10/3 for roller
            n = rotational speed (RPM)
        """
        c_kn = params.get("dynamic_capacity_kn", 50.0)
        p_kn = operating.get("equivalent_load_kn", 20.0)
        rpm = operating.get("speed_rpm", 3600)
        running_hours = operating.get("running_hours", 0)
        p_exp = params.get("life_exponent", 3.0)  # 3 for ball, 10/3 for roller

        if p_kn <= 0 or rpm <= 0:
            return 0.0, "l10_life"

        # L10 life in hours
        l10_revolutions = (c_kn / p_kn) ** p_exp * 1e6
        l10_hours = l10_revolutions / (60 * rpm)

        damage_pct = (running_hours / max(l10_hours, 1.0)) * 100.0

        return min(damage_pct, 100.0), "l10_life"

    # ── Insulation (Arrhenius) ──

    @staticmethod
    def _insulation_arrhenius(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """
        Arrhenius model for temperature-accelerated insulation aging.

        Life = L_ref × exp(Ea/kB × (1/T - 1/T_ref))
        Where:
            L_ref = reference life at T_ref (hours)
            Ea = activation energy (eV)
            kB = Boltzmann constant (8.617e-5 eV/K)
            T = actual operating temperature (K)
            T_ref = reference temperature (K)
        """
        l_ref_hours = params.get("reference_life_hours", 100000)
        t_ref_c = params.get("reference_temp_c", 105)  # class A insulation
        ea_ev = params.get("activation_energy_ev", 1.0)
        t_actual_c = operating.get("winding_temp_c", 90)
        running_hours = operating.get("running_hours", 0)

        kb = 8.617e-5  # Boltzmann constant (eV/K)
        t_ref_k = t_ref_c + 273.15
        t_actual_k = t_actual_c + 273.15

        # Acceleration factor
        if t_actual_k > 0 and t_ref_k > 0:
            accel_factor = math.exp(
                ea_ev / kb * (1 / t_ref_k - 1 / t_actual_k)
            )
        else:
            accel_factor = 1.0

        effective_life = l_ref_hours * accel_factor
        damage_pct = (running_hours / max(effective_life, 1.0)) * 100.0

        return min(damage_pct, 100.0), "arrhenius"

    # ── Erosion ──

    @staticmethod
    def _erosion(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """
        Velocity-dependent erosion model.

        Erosion rate ∝ V^n  (typically n=2 to 3)
        """
        design_velocity = params.get("design_velocity_ms", 10.0)
        actual_velocity = operating.get("actual_velocity_ms", 10.0)
        velocity_exponent = params.get("velocity_exponent", 2.5)
        initial_thickness = params.get("initial_thickness_mm", 10.0)
        min_thickness = params.get("min_thickness_mm", 3.0)
        base_rate_mmpy = params.get("base_erosion_rate_mmpy", 0.05)
        years_in_service = operating.get("years_in_service", 0)

        # Velocity ratio acceleration
        if design_velocity > 0:
            velocity_ratio = actual_velocity / design_velocity
        else:
            velocity_ratio = 1.0

        actual_rate = base_rate_mmpy * (velocity_ratio ** velocity_exponent)
        wall_loss = actual_rate * years_in_service

        usable_range = initial_thickness - min_thickness
        if usable_range <= 0:
            return 100.0, "velocity_erosion"

        damage_pct = (wall_loss / usable_range) * 100.0

        return min(damage_pct, 100.0), "velocity_erosion"

    @staticmethod
    def _default(
        params: Dict[str, float],
        operating: Dict[str, float],
    ) -> tuple[float, str]:
        """Fallback: linear age-based degradation."""
        design_life = params.get("design_life_hours", 40000)
        running_hours = operating.get("running_hours", 0)
        damage_pct = (running_hours / max(design_life, 1.0)) * 100.0
        return min(damage_pct, 100.0), "linear_age"
